import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
/** app/ – funktioniert aus src/ (tsx) und dist/ (node) gleichermaßen. */
const appRoot = path.resolve(here, "..", "..");

function env(name: string, fallback: string): string {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
}

export type DriverName = "mock" | "replay" | "soulear";

const driver = env("DRIVER", "soulear");
if (!["mock", "replay", "soulear"].includes(driver)) {
  throw new Error(`Unbekannter DRIVER "${driver}" (erlaubt: mock, replay, soulear)`);
}

export const config = {
  host: env("HOST", "127.0.0.1"),
  port: Number(env("PORT", "3000")),
  driver: driver as DriverName,
  /** Zielordner für Fotos. */
  mediaDir: path.resolve(env("MEDIA_DIR", path.join(appRoot, "media"))),
  /** Gebautes Frontend, wird statisch ausgeliefert (falls vorhanden). */
  webDist: path.join(appRoot, "web", "dist"),

  /** replay: Ordner mit JPEG-Frames (z. B. aus `npm run pcap -- extract-jpeg`). */
  replayDir: path.resolve(env("REPLAY_DIR", path.join(appRoot, "captures", "frames"))),
  replayFps: Number(env("REPLAY_FPS", "15")),

  /** soulear: Kamera im Kamera-WLAN (Ports laut Suear-Protokoll, siehe suear-protocol.ts). */
  cameraIp: env("CAMERA_IP", "192.168.1.1"),
  cameraCmdPort: Number(env("CAMERA_CMD_PORT", "10005")),
  cameraVideoPort: Number(env("CAMERA_VIDEO_PORT", "10006")),
  /** Lokale UDP-Ports für den Bildstrom, der erste wird der Kamera mitgeteilt. */
  streamPorts: env("STREAM_PORTS", "22785,22789").split(",").map((p) => Number(p.trim())),
};
