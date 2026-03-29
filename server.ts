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
	} catch (e: any) {
		return c.json({ error: e.message }, 422);
	}
});

app.get("/*", serveStatic({ root: "./public" }));

export default { port: 3000, fetch: app.fetch };
