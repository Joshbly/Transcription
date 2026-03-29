import OpenAI, { toFile } from "openai";
import { join } from "path";
import { tmpdir } from "os";
import { unlink } from "fs/promises";

const openai = new OpenAI();

const NATIVE = new Set([
	"mp4",
	"m4a",
	"mp3",
	"wav",
	"webm",
	"mpeg",
	"mpga",
	"ogg",
]);
const REMUXABLE = new Set(["mov"]);
const MAX_BYTES = 25_000_000;

export type Transcript = { text: string; source: string };

type MediaAsset = { blob: Blob; name: string; format: string };

// Temp file scope — cleaned up automatically when the function exits
class Scope implements AsyncDisposable {
	#paths: string[] = [];

	alloc(ext: string) {
		const p = join(tmpdir(), `t9n_${crypto.randomUUID()}.${ext}`);
		this.#paths.push(p);
		return p;
	}

	async [Symbol.asyncDispose]() {
		await Promise.allSettled(this.#paths.map((p) => unlink(p)));
	}
}

async function ffmpeg(src: string, dst: string, args: string[]) {
	const proc = Bun.spawn(["ffmpeg", "-y", "-i", src, ...args, dst], {
		stdout: "ignore",
		stderr: "pipe",
	});
	if ((await proc.exited) !== 0) {
		const stderr = await new Response(proc.stderr).text();
		throw new Error(stderr.trimEnd().split("\n").pop());
	}
}

function ingest(file: File): MediaAsset {
	const format = file.name.split(".").pop()?.toLowerCase() ?? "";
	if (!NATIVE.has(format) && !REMUXABLE.has(format)) {
		throw new Error(`Unsupported format: .${format}`);
	}
	return { blob: file, name: file.name, format };
}

// .mov → .mp4 — same MPEG-4 family, container swap only, no re-encode
async function normalize(asset: MediaAsset, scope: Scope): Promise<MediaAsset> {
	if (!REMUXABLE.has(asset.format)) return asset;

	const src = scope.alloc(asset.format);
	const dst = scope.alloc("mp4");
	await Bun.write(src, asset.blob);
	await ffmpeg(src, dst, ["-c", "copy"]);

	const name = asset.name.replace(/\.\w+$/, ".mp4");
	return {
		blob: new File([await Bun.file(dst).arrayBuffer()], name),
		name,
		format: "mp4",
	};
}

// Strip video track, compress audio — fits most files under the API limit
async function constrain(asset: MediaAsset, scope: Scope): Promise<MediaAsset> {
	if (asset.blob.size <= MAX_BYTES) return asset;

	const src = scope.alloc(asset.format);
	const dst = scope.alloc("m4a");
	await Bun.write(src, asset.blob);
	await ffmpeg(src, dst, ["-vn", "-acodec", "aac", "-b:a", "128k"]);

	const compressed = Bun.file(dst);
	if (compressed.size > MAX_BYTES) {
		throw new Error(`Still ${(compressed.size / 1e6) | 0}MB after compression`);
	}
	return {
		blob: new File([await compressed.arrayBuffer()], "audio.m4a"),
		name: "audio.m4a",
		format: "m4a",
	};
}

async function submit(asset: MediaAsset): Promise<string> {
	const result = await openai.audio.transcriptions.create({
		file: await toFile(asset.blob, asset.name),
		model: "gpt-4o-transcribe",
		response_format: "text",
	});
	return result as unknown as string;
}

export async function transcribe(file: File): Promise<Transcript> {
	await using scope = new Scope();
	let asset = ingest(file);
	asset = await normalize(asset, scope);
	asset = await constrain(asset, scope);
	const text = await submit(asset);
	return { text, source: file.name };
}
