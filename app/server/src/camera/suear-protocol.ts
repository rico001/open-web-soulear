/**
 * UDP-Protokoll der i4season-„Suear“-Kamerafamilie (libWifiCamera.so).
 *
 * Quellen: Sean Pesce, Suear-Web-Viewer (GPL-2.0,
 * https://github.com/SeanPesce/Suear-Web-Viewer) für Nachrichten- und
 * Chunk-Aufbau; gegengeprüft an der Disassemblierung von libWifiCamera.so
 * aus Soulear 1.0.120 (Magic, Ports 10005/10006, SetLed-Nutzlast,
 * OpenVideo mit Port-Nutzlast). Alle Felder little-endian.
 */

export const MAGIC = 0xffeeffee;
export const HEADER_SIZE = 12;
export const CHUNK_HEADER_SIZE = 16;
export const CHUNK_DATA_SIZE = 1456;

export const MsgType = {
  GetDeviceInfo: 0x01,
  GetLicense: 0x02,
  OpenVideo: 0x04,
  SetLed: 0x0a,
  CameraCommand: 0x0c,
} as const;

export interface Message {
  id: number;
  type: number;
  errCode: number;
  data: Buffer;
}

/**
 * Header (12 Byte): magic u32 | id u16 | type u16 | unk u8 (=1 in Anfragen)
 * | errCode u8 | length u16 – danach `length` Byte Nutzlast.
 */
export function encodeMessage(id: number, type: number, data: Buffer = Buffer.alloc(0)): Buffer {
  const h = Buffer.alloc(HEADER_SIZE);
  h.writeUInt32LE(MAGIC, 0);
  h.writeUInt16LE(id & 0xffff, 4);
  h.writeUInt16LE(type, 6);
  h.writeUInt8(1, 8);
  h.writeUInt8(0, 9);
  h.writeUInt16LE(data.length, 10);
  return Buffer.concat([h, data]);
}

export function decodeMessage(buf: Buffer): Message | null {
  if (buf.length < HEADER_SIZE || buf.readUInt32LE(0) !== MAGIC) return null;
  const length = buf.readUInt16LE(10);
  return {
    id: buf.readUInt16LE(4),
    type: buf.readUInt16LE(6),
    errCode: buf.readUInt8(9),
    data: buf.subarray(HEADER_SIZE, HEADER_SIZE + length),
  };
}

export interface DeviceInfo {
  vendor: string;
  product: string;
  firmware: string;
  ssid: string;
  battery: number;
  charging: boolean;
}

const cstr = (b: Buffer, off: number, len: number) => {
  const s = b.subarray(off, off + len);
  const end = s.indexOf(0);
  return s.subarray(0, end < 0 ? len : end).toString("latin1");
};

/** Antwort auf GetDeviceInfo (128 Byte, gepackt). */
export function parseDeviceInfo(d: Buffer): DeviceInfo | null {
  if (d.length < 124) return null;
  const power = d.readUInt16LE(119);
  return {
    vendor: cstr(d, 1, 32),
    product: cstr(d, 33, 32),
    firmware: cstr(d, 65, 16),
    ssid: cstr(d, 81, 32),
    battery: power >> 9,
    charging: ((power >> 8) & 1) === 1,
  };
}

/**
 * LED-Befehl (Typ 0x0a) – derselbe Typ zum Setzen und Lesen:
 * Setzen: [0x10 | LED-Nr., an/aus, Helligkeit 0–100]
 * Lesen:  [LED-Nr., 0, 0] → Antwort-Nutzlast [?, an/aus, Helligkeit]
 * (libWifiCamera.so: LedStatusSet/LedStatusGet)
 */
export function ledPayload(level: number, led = 1): Buffer {
  const v = Math.max(0, Math.min(100, Math.round(level)));
  return Buffer.from([0x10 | (led & 0x0f), v > 0 ? 1 : 0, v]);
}

export function ledQueryPayload(led = 1): Buffer {
  return Buffer.from([led & 0x0f, 0, 0]);
}

/** Antwort auf die LED-Abfrage → Helligkeit 0–100 (0 = aus), null wenn unlesbar. */
export function parseLedStatus(d: Buffer): number | null {
  if (d.length < 3) return null;
  const on = d[1] !== 0;
  return on ? Math.min(100, d[2] || 100) : 0;
}

export interface Chunk {
  /** Laufender 8-Bit-Zähler über alle Chunks (nicht pro Frame). */
  chunkIndex: number;
  frameIndex: number;
  isLast: boolean;
  /** Nur im letzten Chunk eines Frames gesetzt. */
  totalChunks: number;
  width: number;
  height: number;
  /** Beschleunigungssensor, roh (int16, Byte 6–11 des Chunk-Headers). */
  accel: [number, number, number];
  /** Unbekannte Header-Bytes 0 und 5 – Kandidaten für Tasten/Flags. */
  flags: [number, number];
  data: Buffer;
}

/**
 * Ein UDP-Datagramm des Bildkanals kann mehrere Chunks enthalten:
 * jeweils 16 Byte Header + bis zu 1456 Byte JPEG-Daten.
 * Header: unk u8 | chunkIndex u8 | frameIndex u8 | isLast u8 | total u8 |
 *         unk u8 | accel int16[3] | width u16 | height u16
 * (accel: bei Sean Pesce „position“; libWifiCamera.so liest an dieser Stelle
 * drei int16 als x/y/z – sensor_get_xyz.)
 */
export function parseChunks(buf: Buffer): Chunk[] {
  const chunks: Chunk[] = [];
  let off = 0;
  while (off + CHUNK_HEADER_SIZE <= buf.length) {
    const h = buf.subarray(off, off + CHUNK_HEADER_SIZE);
    off += CHUNK_HEADER_SIZE;
    const data = buf.subarray(off, Math.min(off + CHUNK_DATA_SIZE, buf.length));
    off += data.length;
    chunks.push({
      chunkIndex: h[1]!,
      frameIndex: h[2]!,
      isLast: h[3] === 1,
      totalChunks: h[4]!,
      width: h.readUInt16LE(12),
      height: h.readUInt16LE(14),
      accel: [h.readInt16LE(6), h.readInt16LE(8), h.readInt16LE(10)],
      flags: [h[0]!, h[5]!],
      data,
    });
  }
  return chunks;
}

export interface SensorReading {
  /** Geglättete Rohwerte des Beschleunigungssensors. */
  x: number;
  y: number;
  z: number;
  /** Drehung um die Längsachse der Kamera, 0–360° (wie libWifiCamera: atan(y/z)). */
  roll: number;
  /** Neigung der Längsachse gegen die Waagerechte, −90…90° (atan(x/√(y²+z²))). */
  pitch: number;
  /** Rohwerte der unbekannten Header-Bytes 0 und 5. */
  flags: [number, number];
  /** false, wenn alle Werte 0 sind (kein Sensor). */
  available: boolean;
}

/**
 * Glättung wie in libWifiCamera.so (sensor_get_xyz): Mittelwert der letzten
 * 10 Werte ohne Minimum und Maximum, je Achse.
 */
export class SensorSmoother {
  private readonly hist: [number[], number[], number[]] = [[], [], []];

  push(accel: [number, number, number], flags: [number, number]): SensorReading {
    const avg = accel.map((v, i) => {
      const h = this.hist[i]!;
      h.push(v);
      if (h.length > 10) h.shift();
      if (h.length < 3) return v;
      const sorted = [...h].sort((a, b) => a - b).slice(1, -1);
      return sorted.reduce((a, b) => a + b, 0) / sorted.length;
    }) as [number, number, number];
    const [x, y, z] = avg;
    const deg = 180 / Math.PI;
    const roll = (Math.atan2(y, z) * deg + 360) % 360;
    const pitch = Math.atan2(x, Math.hypot(y, z)) * deg;
    return {
      x: Math.round(x),
      y: Math.round(y),
      z: Math.round(z),
      roll: Math.round(roll * 10) / 10,
      pitch: Math.round(pitch * 10) / 10,
      flags,
      available: accel.some((v) => v !== 0),
    };
  }

  reset(): void {
    this.hist.forEach((h) => (h.length = 0));
  }
}

interface PendingFrame {
  chunks: Map<number, Buffer>;
  lastIndex: number | null;
  total: number;
  width: number;
  height: number;
  accel: [number, number, number];
  flags: [number, number];
  createdAt: number;
}

export interface AssembledFrame {
  jpeg: Buffer;
  width: number;
  height: number;
  accel: [number, number, number];
  flags: [number, number];
}

/**
 * Setzt Chunks zu JPEG-Frames zusammen. Robust gegen Umordnung: die Position
 * eines Chunks ergibt sich erst aus dem letzten Chunk (Index und Gesamtzahl),
 * nicht aus dem zuerst empfangenen.
 */
export class FrameAssembler {
  private pending = new Map<number, PendingFrame>();
  dropped = 0;

  constructor(private readonly maxPending = 8) {}

  /** Gibt fertige Frames zurück (meist 0 oder 1). */
  push(c: Chunk): AssembledFrame[] {
    let f = this.pending.get(c.frameIndex);
    if (!f) {
      if (this.pending.size >= this.maxPending) {
        // Ältesten unvollständigen Frame verwerfen.
        const oldest = [...this.pending.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt)[0]!;
        this.pending.delete(oldest[0]);
        this.dropped++;
      }
      f = {
        chunks: new Map(), lastIndex: null, total: 0, width: c.width, height: c.height,
        accel: c.accel, flags: c.flags, createdAt: Date.now(),
      };
      this.pending.set(c.frameIndex, f);
    }
    f.chunks.set(c.chunkIndex, c.data);
    if (c.isLast) {
      f.lastIndex = c.chunkIndex;
      f.total = c.totalChunks;
    }
    if (f.lastIndex === null || f.total === 0 || f.chunks.size < f.total) return [];

    const first = (f.lastIndex - (f.total - 1) + 256) & 0xff;
    const parts: Buffer[] = [];
    for (let i = 0; i < f.total; i++) {
      const part = f.chunks.get((first + i) & 0xff);
      if (!part) return []; // Lücke – evtl. kommt der Chunk noch
      parts.push(part);
    }
    this.pending.delete(c.frameIndex);
    // Ältere, noch offene Frames sind jetzt veraltet.
    for (const [idx, p] of this.pending) {
      if (p.createdAt < f.createdAt) {
        this.pending.delete(idx);
        this.dropped++;
      }
    }
    const jpeg = Buffer.concat(parts);
    if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) {
      this.dropped++;
      return [];
    }
    return [{ jpeg, width: f.width, height: f.height, accel: f.accel, flags: f.flags }];
  }

  reset(): void {
    this.pending.clear();
  }
}
