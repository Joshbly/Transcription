import OpenAI, { toFile } from "openai";
import { join } from "path";
import { tmpdir } from "os";
import { mkdtemp, readdir, rm } from "fs/promises";

const openai = new OpenAI();

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
	"mkv",
]);
// The API rejects .mov/.mkv, so those always get their audio pulled out
const PASSTHROUGH = new Set([
	"mp4",
	"m4a",
	"mp3",
	"wav",
	"webm",
	"mpeg",
	"mpga",
	"ogg",
]);
const MAX_BYTES = 25_000_000;
// gpt-4o-transcribe caps both input duration and output length; 5-min chunks stay well clear of both
const SEGMENT_SECONDS = 5 * 60;
const CONCURRENT_UPLOADS = 6;

export type Transcript = { text: string; source: string };

class Scope implements AsyncDisposable {
	#paths: string[] = [];

	track(p: string) {
		this.#paths.push(p);
		return p;
	}

	alloc(ext: string) {
		return this.track(join(tmpdir(), `t9n_${crypto.randomUUID()}.${ext}`));
	}

	async [Symbol.asyncDispose]() {
		await Promise.allSettled(
			this.#paths.map((p) => rm(p, { recursive: true, force: true })),
		);
	}
}

async function hasAudio(src: string): Promise<boolean> {
	const proc = Bun.spawn(
		[
			"ffprobe",
			"-v",
			"error",
			"-select_streams",
			"a",
			"-show_entries",
			"stream=codec_type",
			"-of",
			"csv=p=0",
			src,
		],
		{ stdout: "pipe", stderr: "ignore" },
	);
	const out = await new Response(proc.stdout).text();
	await proc.exited;
	return out.trim().length > 0;
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

// Drop video, mono 64k AAC — fine for speech, and a 5-min chunk lands around 2.5MB
async function extractAudio(src: string, scope: Scope): Promise<string[]> {
	const dir = scope.track(await mkdtemp(join(tmpdir(), "t9n_")));
	await ffmpeg(src, join(dir, "part_%03d.m4a"), [
		"-vn",
		"-ac",
		"1",
		"-c:a",
		"aac",
		"-b:a",
		"64k",
		"-f",
		"segment",
		"-segment_time",
		String(SEGMENT_SECONDS),
		"-reset_timestamps",
		"1",
	]);
	// The segmenter can leave a few-ms tail chunk that the API rejects as corrupt; ~8KB is 1s at 64k
	return (await readdir(dir))
		.sort()
		.map((part) => join(dir, part))
		.filter((part) => Bun.file(part).size > 8_000);
}

async function submit(path: string): Promise<string> {
	return openai.audio.transcriptions.create({
		file: await toFile(Bun.file(path), path.split("/").pop()),
		model: "gpt-4o-transcribe",
		response_format: "text" as const,
	});
}

export async function transcribe(
	upload: ReadableStream<Uint8Array>,
	name: string,
): Promise<Transcript> {
	const ext = name.split(".").pop()?.toLowerCase() ?? "";
	if (!ACCEPTED.has(ext)) throw new Error(`Unsupported format: .${ext}`);

	await using scope = new Scope();
	// Straight to disk — multi-GB videos can't be buffered in memory.
	// Not Bun.write(src, new Response(upload)): that hangs on request streams in Bun 1.3
	const src = scope.alloc(ext);
	const sink = Bun.file(src).writer();
	for await (const chunk of upload) await sink.write(chunk);
	await sink.end();

	if (!(await hasAudio(src)))
		throw new Error("No audio track found — nothing to transcribe");

	const parts =
		PASSTHROUGH.has(ext) && Bun.file(src).size <= MAX_BYTES
			? [src]
			: await extractAudio(src, scope);
	const texts: string[] = [];
	for (let i = 0; i < parts.length; i += CONCURRENT_UPLOADS)
		texts.push(
			...(await Promise.all(
				parts.slice(i, i + CONCURRENT_UPLOADS).map(submit),
			)),
		);
	return { text: texts.join("\n\n"), source: name };
}
