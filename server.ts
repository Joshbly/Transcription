import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { transcribe } from "./transcribe";

const app = new Hono();

app.post("/api/transcribe", async (c) => {
	const body = await c.req.parseBody();
	const file = body.file;
	if (!(file instanceof File))
		return c.json({ error: "No file provided" }, 400);
	try {
		return c.json(await transcribe(file));
	} catch (e) {
		const message = e instanceof Error ? e.message : "Transcription failed";
		return c.json({ error: message }, 422);
	}
});

app.get("/*", serveStatic({ root: "./public" }));

function serve(port: number): ReturnType<typeof Bun.serve> {
	try {
		return Bun.serve({
			port,
			fetch: app.fetch,
			maxRequestBodySize: 2 * 1024 * 1024 * 1024,
		});
	} catch (e) {
		if ((e as { code?: string }).code !== "EADDRINUSE") throw e;
		return serve(port + 1);
	}
}

const server = serve(3000);
console.log(`Started server: ${server.url}`);
