import type { ServerResponse } from "node:http";
import type { CameraDriver } from "../camera/types.js";

const BOUNDARY = "soulearframe";

/**
 * Schickt die Frames des Treibers als multipart/x-mixed-replace – das zeigt
 * jeder Browser direkt in einem <img>. Ist der Client zu langsam, werden
 * Frames verworfen statt gepuffert, damit das Bild nicht nachläuft.
 */
export function pipeMjpeg(driver: CameraDriver, res: ServerResponse): void {
  res.writeHead(200, {
    "Content-Type": `multipart/x-mixed-replace; boundary=${BOUNDARY}`,
    "Cache-Control": "no-store, no-cache, must-revalidate",
    Pragma: "no-cache",
    Connection: "close",
  });

  let busy = false;
  const send = (jpeg: Buffer) => {
    if (busy || res.destroyed) return;
    res.write(`--${BOUNDARY}\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpeg.length}\r\n\r\n`);
    const ok = res.write(jpeg);
    res.write("\r\n");
    if (!ok) {
      busy = true;
      res.once("drain", () => (busy = false));
    }
  };

  const latest = driver.latestFrame();
  if (latest) send(latest);
  driver.on("frame", send);
  res.on("close", () => driver.off("frame", send));
}
