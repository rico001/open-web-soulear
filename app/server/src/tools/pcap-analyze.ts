/**
 * Auswertung von Mitschnitten (PCAPdroid, tcpdump, Wireshark) der Soulear-App.
 *
 *   npm run pcap -- summary      <datei>                   Flows im Überblick
 *   npm run pcap -- dump         <datei> <flow> [opts]     Hexdump + Header-Analyse
 *   npm run pcap -- hosts        <datei>                   DNS, TLS-SNI, HTTP-Requests
 *   npm run pcap -- extract-jpeg <datei> <flow> [opts]     JPEG-Frames herausziehen
 *
 * <flow> ist die Nummer aus `summary`.
 */
import fs from "node:fs";
import path from "node:path";
import jpeg from "jpeg-js";
import { config } from "../config.js";
import { decode, flowKey, readCapture, type Packet } from "./pcap.js";

interface Flow {
  key: string;
  packets: Packet[];
  bytes: number;
}

const SOI = Buffer.from([0xff, 0xd8, 0xff]);
const EOI = Buffer.from([0xff, 0xd9]);
const H264 = Buffer.from([0x00, 0x00, 0x00, 0x01]);

function usage(): never {
  console.log(`Aufruf:
  npm run pcap -- summary      <datei>
  npm run pcap -- dump         <datei> <flow> [--count 20] [--bytes 48]
  npm run pcap -- hosts        <datei>
  npm run pcap -- extract-jpeg <datei> <flow> [--out DIR] [--header N] [--sort OFF:u16|u32] [--all]`);
  process.exit(1);
}

function opt(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

function load(file: string): { flows: Flow[]; total: number; skipped: number } {
  const raws = readCapture(fs.readFileSync(file));
  const { packets, skipped } = decode(raws);
  const map = new Map<string, Flow>();
  for (const p of packets) {
    if (p.payload.length === 0) continue;
    const key = flowKey(p);
    let f = map.get(key);
    if (!f) map.set(key, (f = { key, packets: [], bytes: 0 }));
    f.packets.push(p);
    f.bytes += p.payload.length;
  }
  const flows = [...map.values()].sort((a, b) => b.bytes - a.bytes || a.key.localeCompare(b.key));
  return { flows, total: raws.length, skipped };
}

function pickFlow(flows: Flow[], arg: string | undefined): Flow {
  const n = Number(arg);
  const f = flows[n];
  if (arg === undefined || !Number.isInteger(n) || !f) {
    console.error(`Flow "${arg}" gibt es nicht (0–${flows.length - 1}, siehe summary).`);
    process.exit(1);
  }
  return f;
}

const hex = (b: Buffer) => [...b].map((x) => x.toString(16).padStart(2, "0")).join(" ");
/** Startcode 00 00 00 01 gefolgt von einem plausiblen NAL-Header (SPS/PPS/IDR/Slice). */
function hasH264Nal(b: Buffer): boolean {
  for (let o = b.indexOf(H264); o >= 0 && o + 4 < b.length; o = b.indexOf(H264, o + 1)) {
    const nal = b[o + 4]!;
    if ((nal & 0x80) === 0 && [1, 5, 7, 8].includes(nal & 0x1f)) return true;
  }
  return false;
}

const fmtBytes = (n: number) =>
  n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : n > 1e3 ? `${(n / 1e3).toFixed(1)} kB` : `${n} B`;

// --- summary --------------------------------------------------------------

function summary(file: string): void {
  const { flows, total, skipped } = load(file);
  console.log(`${total} Pakete, ${skipped} übersprungen (kein UDP/TCP oder Fragment), ${flows.length} Flows mit Nutzdaten\n`);
  flows.forEach((f, i) => {
    const lens = f.packets.map((p) => p.payload.length);
    const dur = (f.packets.at(-1)!.ts - f.packets[0]!.ts) / 1000;
    const soi = new Map<number, number>();
    let h264 = 0;
    for (const p of f.packets) {
      const o = p.payload.indexOf(SOI);
      if (o >= 0) soi.set(o, (soi.get(o) ?? 0) + 1);
      else if (hasH264Nal(p.payload)) h264++;
    }
    console.log(`[${i}] ${f.key}`);
    console.log(
      `     ${f.packets.length} Pakete, ${fmtBytes(f.bytes)}, ${dur.toFixed(1)} s, ` +
        `Nutzlast ${Math.min(...lens)}–${Math.max(...lens)} B (Ø ${Math.round(f.bytes / lens.length)})`,
    );
    if (soi.size) {
      const offs = [...soi.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
      console.log(`     JPEG-Start (FFD8FF) in ${[...soi.values()].reduce((a, b) => a + b)} Paketen, Offset(s): ${offs.map(([o, c]) => `${o}×${c}`).join(", ")}`);
    }
    if (h264) console.log(`     H.264-Startcode (mit NAL-Typ 1/5/7/8) in ${h264} Paketen`);
    const first = f.packets[0]!.payload;
    const printable = first.subarray(0, 60).toString("latin1").replace(/[^\x20-\x7e]/g, ".");
    console.log(`     erstes Paket: ${hex(first.subarray(0, 24))}${first.length > 24 ? " …" : ""}`);
    console.log(`                   "${printable}"\n`);
  });
}

// --- dump -----------------------------------------------------------------

function dump(file: string, args: string[]): void {
  const { flows } = load(file);
  const f = pickFlow(flows, args[0]);
  const count = Number(opt(args, "count") ?? 20);
  const width = Number(opt(args, "bytes") ?? 48);
  const t0 = f.packets[0]!.ts;

  console.log(`${f.key} – ${f.packets.length} Pakete\n`);
  for (const p of f.packets.slice(0, count)) {
    console.log(`#${String(p.index).padEnd(6)} +${((p.ts - t0) / 1000).toFixed(3)}s len=${String(p.payload.length).padEnd(5)} ${hex(p.payload.subarray(0, width))}`);
  }

  // Welche Byte-Positionen sind über alle Pakete konstant (.) bzw. variabel (x)?
  const n = Math.min(width, ...f.packets.map((p) => p.payload.length));
  let mask = "";
  for (let i = 0; i < n; i++) {
    const v = f.packets[0]!.payload[i];
    mask += f.packets.every((p) => p.payload[i] === v) ? ".. " : "xx ";
  }
  console.log(`\nkonstant(.)/variabel(x) über alle Pakete, erste ${n} Bytes:`);
  console.log(`${" ".repeat(33)}${mask}`);

  // Kandidaten für Zähler und Längenfelder im Header. Pro Byte-Bereich nur
  // den stärksten Treffer zeigen – sonst meldet jeder Zähler auch als u32/LE.
  const candidates: { from: number; to: number; score: number; text: string }[] = [];
  const ps = f.packets;
  for (let o = 0; o + 2 <= n; o++) {
    for (const [label, size, read] of [
      ["u16be", 2, (b: Buffer) => b.readUInt16BE(o)],
      ["u16le", 2, (b: Buffer) => b.readUInt16LE(o)],
      ["u32be", 4, (b: Buffer) => b.readUInt32BE(o)],
      ["u32le", 4, (b: Buffer) => b.readUInt32LE(o)],
    ] as const) {
      if (o + size > n || ps.length < 3) continue;
      const vals = ps.map((p) => read(p.payload));
      const steps = vals.slice(1).map((v, i) => v - vals[i]!);
      const inc = steps.filter((s) => s === 1).length / steps.length;
      // Kleiner Bonus für kürzere Felder und big-endian (Protokoll nutzt read_big_endian_16).
      const bias = (size === 2 ? 0.002 : 0) + (label.endsWith("be") ? 0.001 : 0);
      if (inc >= 0.8) {
        candidates.push({ from: o, to: o + size, score: inc + bias, text: `Offset ${o} ${label}: Zähler (+1 in ${Math.round(inc * 100)}%), ${vals[0]} → ${vals.at(-1)}` });
      }
      const diffs = new Set(ps.map((p, i) => p.payload.length - vals[i]!));
      if (diffs.size === 1 && new Set(vals).size > 1) {
        candidates.push({ from: o, to: o + size, score: 1.01 + bias, text: `Offset ${o} ${label}: Längenfeld (Nutzlast − ${[...diffs][0]})` });
      }
    }
  }
  const taken: typeof candidates = [];
  for (const c of candidates.sort((a, b) => b.score - a.score)) {
    if (!taken.some((t) => c.from < t.to && t.from < c.to)) taken.push(c);
  }
  const hints = taken.sort((a, b) => a.from - b.from).map((c) => c.text);
  if (hints.length) console.log(`\nHinweise (automatisch, nur Kandidaten):\n  ${hints.join("\n  ")}`);
}

// --- hosts ----------------------------------------------------------------

function dnsName(b: Buffer, off: number): string {
  const labels: string[] = [];
  let o = off;
  for (let guard = 0; guard < 64 && o < b.length; guard++) {
    const l = b[o]!;
    if (l === 0 || (l & 0xc0) === 0xc0) break;
    labels.push(b.subarray(o + 1, o + 1 + l).toString("latin1"));
    o += 1 + l;
  }
  return labels.join(".");
}

function tlsSni(b: Buffer): string | null {
  // TLS-Record Handshake (0x16), ClientHello (0x01)
  if (b.length < 43 || b[0] !== 0x16 || b[5] !== 0x01) return null;
  let o = 9 + 2 + 32; // Record-/Handshake-Header, Version, Random
  o += 1 + b[o]!; // Session-ID
  o += 2 + b.readUInt16BE(o); // Cipher Suites
  o += 1 + b[o]!; // Compression
  const end = Math.min(b.length, o + 2 + b.readUInt16BE(o));
  o += 2;
  while (o + 4 <= end) {
    const type = b.readUInt16BE(o);
    const len = b.readUInt16BE(o + 2);
    if (type === 0 && o + 9 <= end) return b.subarray(o + 9, o + 9 + b.readUInt16BE(o + 7)).toString("latin1");
    o += 4 + len;
  }
  return null;
}

function hosts(file: string): void {
  const { packets } = decode(readCapture(fs.readFileSync(file)));
  const seen = new Map<string, { count: number; first: number }>();
  const note = (line: string, ts: number) => {
    const e = seen.get(line);
    if (e) e.count++;
    else seen.set(line, { count: 1, first: ts });
  };
  const t0 = packets[0]?.ts ?? 0;
  for (const p of packets) {
    const b = p.payload;
    try {
      if (p.proto === "udp" && p.dport === 53 && b.length > 12 && !(b[2]! & 0x80)) {
        note(`DNS   ${dnsName(b, 12)}`, p.ts);
      } else if (p.proto === "tcp") {
        const sni = tlsSni(b);
        if (sni) note(`TLS   ${sni}  (${p.dst}:${p.dport})`, p.ts);
        const line = b.subarray(0, 200).toString("latin1").split("\r\n")[0]!;
        if (/^(GET|POST|PUT|DELETE|HEAD|OPTIONS|PATCH) \S+ HTTP\/1/.test(line)) {
          const host = /\r\nhost: *([^\r]+)/i.exec(b.subarray(0, 2000).toString("latin1"))?.[1] ?? p.dst;
          note(`HTTP  ${host}  ${line}`, p.ts);
        }
      }
    } catch {
      /* kaputtes Paket – ignorieren */
    }
  }
  if (seen.size === 0) return void console.log("Keine DNS-Anfragen, TLS-Verbindungen oder HTTP-Requests gefunden.");
  for (const [line, { count, first }] of [...seen.entries()].sort((a, b) => a[1].first - b[1].first)) {
    console.log(`+${((first - t0) / 1000).toFixed(1).padStart(7)}s  ${String(count).padStart(4)}×  ${line}`);
  }
}

// --- extract-jpeg ---------------------------------------------------------

function extractJpeg(file: string, args: string[]): void {
  const { flows } = load(file);
  const f = pickFlow(flows, args[0]);
  const out = opt(args, "out");
  const outDir = out ? path.resolve(cwd, out) : config.replayDir;
  const keepAll = args.includes("--all");
  let ps = [...f.packets];

  const sort = opt(args, "sort");
  if (sort) {
    const [o, t] = sort.split(":");
    const off = Number(o);
    ps.sort((a, b) =>
      t === "u32" ? a.payload.readUInt32BE(off) - b.payload.readUInt32BE(off) : a.payload.readUInt16BE(off) - b.payload.readUInt16BE(off),
    );
  }

  // Header-Länge: explizit oder = häufigster Offset des JPEG-Starts.
  let header = opt(args, "header") !== undefined ? Number(opt(args, "header")) : -1;
  if (header < 0) {
    const counts = new Map<number, number>();
    for (const p of ps) {
      const o = p.payload.indexOf(SOI);
      if (o >= 0) counts.set(o, (counts.get(o) ?? 0) + 1);
    }
    if (counts.size === 0) {
      console.error("Kein JPEG-Start (FFD8FF) in diesem Flow – anderes Format? Mit `dump` ansehen.");
      process.exit(1);
    }
    header = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0];
    console.log(`Header-Länge automatisch: ${header} Bytes (Offset des JPEG-Starts). Mit --header N überschreiben.`);
  }

  const stream = Buffer.concat(ps.map((p) => p.payload.subarray(header)));
  const starts: number[] = [];
  for (let o = stream.indexOf(SOI); o >= 0; o = stream.indexOf(SOI, o + 3)) starts.push(o);

  fs.mkdirSync(outDir, { recursive: true });
  let ok = 0;
  let bad = 0;
  starts.forEach((s, i) => {
    const chunk = stream.subarray(s, starts[i + 1] ?? stream.length);
    const e = chunk.lastIndexOf(EOI);
    const img = e >= 0 ? chunk.subarray(0, e + 2) : chunk;
    let valid = e >= 0;
    if (valid) {
      try {
        jpeg.decode(img, { maxMemoryUsageInMB: 256 });
      } catch {
        valid = false;
      }
    }
    if (valid) ok++;
    else bad++;
    if (valid || keepAll) {
      fs.writeFileSync(path.join(outDir, `frame-${String(i + 1).padStart(5, "0")}${valid ? "" : "-bad"}.jpg`), img);
    }
  });
  console.log(`${starts.length} JPEG-Kandidaten: ${ok} gültig, ${bad} defekt → ${outDir}`);
  if (bad > ok) {
    console.log("Viele defekte Frames: Header-Länge prüfen (dump), Pakete evtl. per --sort OFF:u16|u32 nach Sequenznummer ordnen.");
  }
}

// --- main -----------------------------------------------------------------

/** npm startet Workspace-Skripte in server/ – Pfade relativ zum Aufrufort auflösen. */
const cwd = process.env.INIT_CWD ?? process.cwd();
const [cmd, fileArg, ...rest] = process.argv.slice(2);
if (!cmd || !fileArg) usage();
const file = path.resolve(cwd, fileArg);
if (!fs.existsSync(file)) {
  console.error(`Datei nicht gefunden: ${file}`);
  process.exit(1);
}
switch (cmd) {
  case "summary":
    summary(file);
    break;
  case "dump":
    dump(file, rest);
    break;
  case "hosts":
    hosts(file);
    break;
  case "extract-jpeg":
    extractJpeg(file, rest);
    break;
  default:
    usage();
}
