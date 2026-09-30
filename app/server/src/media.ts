import fs from "node:fs/promises";
import path from "node:path";

export interface Photo {
  name: string;
  size: number;
  createdAt: number;
}

/** Nur selbst erzeugte Dateinamen zulassen – schützt vor Pfad-Tricks. */
const NAME_RE = /^\d{8}-\d{6}-\d{3}\.jpg$/;

export class MediaStore {
  constructor(private readonly dir: string) {}

  async init(): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
  }

  isValidName(name: string): boolean {
    return NAME_RE.test(name);
  }

  filePath(name: string): string {
    if (!this.isValidName(name)) throw new Error("Ungültiger Dateiname");
    return path.join(this.dir, name);
  }

  async savePhoto(jpeg: Buffer): Promise<Photo> {
    const now = new Date();
    const p = (n: number, l = 2) => String(n).padStart(l, "0");
    const name =
      `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-` +
      `${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}-${p(now.getMilliseconds(), 3)}.jpg`;
    await fs.writeFile(path.join(this.dir, name), jpeg);
    return { name, size: jpeg.length, createdAt: now.getTime() };
  }

  async list(): Promise<Photo[]> {
    const names = (await fs.readdir(this.dir)).filter((n) => this.isValidName(n));
    const photos = await Promise.all(
      names.map(async (name) => {
        const st = await fs.stat(path.join(this.dir, name));
        return { name, size: st.size, createdAt: st.mtimeMs };
      }),
    );
    return photos.sort((a, b) => b.createdAt - a.createdAt);
  }

  async remove(name: string): Promise<void> {
    await fs.unlink(this.filePath(name));
  }
}
