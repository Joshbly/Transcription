import OpenAI from "openai";
import { join } from "path";
import { tmpdir } from "os";
import { unlink } from "fs/promises";

const openai = new OpenAI();

type Format =
	| "mp4"
	| "m4a"
	| "mp3"
	| "wav"
	| "webm"
	| "mpeg"
	| "mpga"
	| "ogg"
	| "mov";

const ACCEPTED = new Set<string>([
	"mp4",
	"m4a",
	"mp3",
	"wav",
	"webm",
	"mpeg",
	"mpga",
	"ogg",
	"mov",
]);
const REMUXABLE = new Set<string>(["mov"]);
const MAX_BYTES = 25_000_000;

export type Transcript = { text: string; source: string };

type MediaAsset = { file: File; name: string; format: Format };

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
		const lines = (await new Response(proc.stderr).text())
			.trimEnd()
			.split("\n")
			.filter(Boolean);
		throw new Error(
			lines.findLast((l) => l !== "Conversion failed!") ?? "ffmpeg failed",
		);
	}
}

async function convert(
	blob: Blob,
	scope: Scope,
	inExt: string,
	outExt: string,
	args: string[],
): Promise<Blob> {
	const src = scope.alloc(inExt);
	const dst = scope.alloc(outExt);
	await Bun.write(src, blob);
	await ffmpeg(src, dst, args);
	return new Blob([await Bun.file(dst).arrayBuffer()]);
}

function ingest(file: File): MediaAsset {
	const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
	if (!ACCEPTED.has(ext)) throw new Error(`Unsupported format: .${ext}`);
	return { file, name: file.name, format: ext as Format };
}

// .mov → .mp4 — same MPEG-4 family, container swap only, no re-encode
async function normalize(asset: MediaAsset, scope: Scope): Promise<MediaAsset> {
	if (!REMUXABLE.has(asset.format)) return asset;
	const blob = await convert(asset.file, scope, asset.format, "mp4", [
		"-c",
		"copy",
	]);
	const name = asset.name.replace(/\.\w+$/, ".mp4");
	return { file: new File([blob], name), name, format: "mp4" };
}

// Strip video track, compress audio — fits most files under the API limit
async function constrain(asset: MediaAsset, scope: Scope): Promise<MediaAsset> {
	if (asset.file.size <= MAX_BYTES) return asset;
	const blob = await convert(asset.file, scope, asset.format, "m4a", [
		"-vn",
		"-acodec",
		"aac",
		"-b:a",
		"128k",
	]);
	if (blob.size > MAX_BYTES) {
		throw new Error(`Still ${(blob.size / 1e6) | 0}MB after compression`);
	}
	return {
		file: new File([blob], "audio.m4a"),
		name: "audio.m4a",
		format: "m4a",
	};
}

async function submit(asset: MediaAsset): Promise<string> {
	return openai.audio.transcriptions.create({
		file: asset.file,
		model: "gpt-4o-transcribe",
		response_format: "text" as const,
	});
}

export async function transcribe(file: File): Promise<Transcript> {
	await using scope = new Scope();
	let asset = ingest(file);
	asset = await normalize(asset, scope);
	asset = await constrain(asset, scope);
	const text = await submit(asset);
	return { text, source: file.name };
}
