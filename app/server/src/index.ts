import fs from "node:fs";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { config } from "./config.js";
import { createDriver } from "./camera/index.js";
import { MediaStore } from "./media.js";
import { pipeMjpeg } from "./stream/mjpeg.js";

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });
const driver = createDriver((msg) => app.log.info(msg));
const media = new MediaStore(config.mediaDir);
await media.init();

async function connect(): Promise<void> {
  try {
    await driver.connect();
    app.log.info(`Kamera verbunden (Treiber: ${driver.name})`);
  } catch (err) {
    app.log.warn(`Kamera nicht verbunden: ${(err as Error).message}`);
  }
}

// --- Kamera ---------------------------------------------------------------

// Wird vom Frontend alle 2 s abgefragt – nicht ins Log schreiben.
app.get("/api/status", { logLevel: "warn" }, async () => driver.status());

app.post("/api/connect", async () => {
  await driver.disconnect();
  await connect();
  return driver.status();
});

app.post("/api/disconnect", async () => {
  await driver.disconnect();
  return driver.status();
});

app.post<{ Body: { level: number } }>(
  "/api/led",
  { schema: { body: { type: "object", required: ["level"], properties: { level: { type: "number", minimum: 0, maximum: 100 } } } } },
  async (req, reply) => {
    if (!driver.capabilities.led) return reply.code(400).send({ error: "LED wird von diesem Treiber nicht unterstützt" });
    await driver.setLed(req.body.level);
    return driver.status();
  },
);

app.get("/api/stream.mjpeg", (_req, reply) => {
  reply.hijack();
  pipeMjpeg(driver, reply.raw);
});

// Sensorwerte als Server-Sent Events, höchstens 10 pro Sekunde.
app.get("/api/sensors", { logLevel: "warn" }, (req, reply) => {
  reply.hijack();
  const res = reply.raw;
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-store",
    Connection: "keep-alive",
  });
  let last = 0;
  let pending: ReturnType<typeof setTimeout> | null = null;
  const send = () => {
    pending = null;
    last = Date.now();
    const s = driver.latestSensor();
    if (s) res.write(`data: ${JSON.stringify(s)}\n\n`);
  };
  const onSensor = () => {
    if (pending) return;
    const wait = Math.max(0, 100 - (Date.now() - last));
    pending = setTimeout(send, wait);
  };
  const keepalive = setInterval(() => res.write(": ping\n\n"), 15000);
  send();
  driver.on("sensor", onSensor);
  req.raw.on("close", () => {
    driver.off("sensor", onSensor);
    clearInterval(keepalive);
    if (pending) clearTimeout(pending);
  });
});

app.get("/api/snapshot.jpg", { logLevel: "warn" }, async (_req, reply) => {
  const frame = driver.latestFrame();
  if (!frame) return reply.code(503).send({ error: "Noch kein Bild" });
  return reply.header("Cache-Control", "no-store").type("image/jpeg").send(frame);
});

// --- Fotos ----------------------------------------------------------------

app.get("/api/photos", async () => media.list());

app.post("/api/photos", async (_req, reply) => {
  const frame = driver.latestFrame();
  if (!frame) return reply.code(503).send({ error: "Noch kein Bild" });
  return reply.code(201).send(await media.savePhoto(frame));
});

app.get<{ Params: { name: string } }>("/api/photos/:name", async (req, reply) => {
  if (!media.isValidName(req.params.name)) return reply.code(404).send();
  const stream = fs.createReadStream(media.filePath(req.params.name));
  stream.on("error", () => reply.code(404).send());
  return reply.type("image/jpeg").send(stream);
});

app.delete<{ Params: { name: string } }>("/api/photos/:name", async (req, reply) => {
  if (!media.isValidName(req.params.name)) return reply.code(404).send();
  try {
    await media.remove(req.params.name);
  } catch {
    return reply.code(404).send();
  }
  return reply.code(204).send();
});

// --- Frontend -------------------------------------------------------------

if (fs.existsSync(config.webDist)) {
  await app.register(fastifyStatic, { root: config.webDist });
  app.setNotFoundHandler((req, reply) =>
    req.url.startsWith("/api/") ? reply.code(404).send({ error: "Not found" }) : reply.sendFile("index.html"),
  );
}

// --- Start ----------------------------------------------------------------

await connect();
await app.listen({ host: config.host, port: config.port });

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    await driver.disconnect();
    await app.close();
    process.exit(0);
  });
}
