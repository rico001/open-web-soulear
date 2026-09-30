import fs from "node:fs/promises";
import path from "node:path";
import { CameraDriver } from "./types.js";

/**
 * Spielt JPEG-Dateien aus einem Ordner in einer Schleife ab – z. B. Frames,
 * die `npm run pcap -- extract-jpeg` aus einem Mitschnitt gezogen hat. So lässt
 * sich die ganze Kette (Stream, Foto, UI) mit echten Kamerabildern testen.
 */
export class ReplayDriver extends CameraDriver {
  readonly name = "replay";
  readonly capabilities = { led: false, battery: false, sensors: false };

  private timer: NodeJS.Timeout | null = null;
  private frames: Buffer[] = [];
  private index = 0;

  constructor(
    private readonly dir: string,
    private readonly fps: number,
  ) {
    super();
  }

  async connect(): Promise<void> {
    if (this.timer) return;
    let files: string[];
    try {
      files = (await fs.readdir(this.dir))
        .filter((f) => /\.jpe?g$/i.test(f))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    } catch {
      files = [];
    }
    if (files.length === 0) {
      this.error = `Keine JPEG-Dateien in ${this.dir}`;
      throw new Error(this.error);
    }
    this.frames = await Promise.all(files.map((f) => fs.readFile(path.join(this.dir, f))));
    this.connected = true;
    this.error = null;
    this.timer = setInterval(() => {
      this.pushFrame(this.frames[this.index]!);
      this.index = (this.index + 1) % this.frames.length;
    }, 1000 / this.fps);
  }

  async disconnect(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.connected = false;
  }
}
