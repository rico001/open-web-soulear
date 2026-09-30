/**
 * Minimaler pcap/pcapng-Leser ohne Abhängigkeiten. Reicht für Mitschnitte von
 * PCAPdroid, tcpdump und Wireshark: IPv4/IPv6 mit UDP/TCP über Ethernet,
 * Raw-IP, Linux-SLL/SLL2 und BSD-Loopback.
 */

export interface RawPacket {
  /** Zeitstempel in Millisekunden. */
  ts: number;
  linktype: number;
  data: Buffer;
}

export interface Packet {
  index: number;
  ts: number;
  proto: "udp" | "tcp";
  src: string;
  dst: string;
  sport: number;
  dport: number;
  /** Nur TCP. */
  seq?: number;
  flags?: number;
  payload: Buffer;
}

export function readCapture(buf: Buffer): RawPacket[] {
  const magic = buf.readUInt32BE(0);
  if (magic === 0x0a0d0d0a) return readPcapng(buf);
  return readPcap(buf);
}

function readPcap(buf: Buffer): RawPacket[] {
  const m = buf.readUInt32LE(0);
  let le: boolean;
  let nano: boolean;
  if (m === 0xa1b2c3d4 || m === 0xa1b23c4d) {
    le = true;
    nano = m === 0xa1b23c4d;
  } else {
    const mb = buf.readUInt32BE(0);
    if (mb !== 0xa1b2c3d4 && mb !== 0xa1b23c4d) throw new Error("Keine pcap/pcapng-Datei");
    le = false;
    nano = mb === 0xa1b23c4d;
  }
  const u32 = (o: number) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
  const linktype = u32(20) & 0x0fffffff;
  const out: RawPacket[] = [];
  let off = 24;
  while (off + 16 <= buf.length) {
    const sec = u32(off);
    const frac = u32(off + 4);
    const incl = u32(off + 8);
    off += 16;
    if (off + incl > buf.length) break;
    out.push({ ts: sec * 1000 + (nano ? frac / 1e6 : frac / 1e3), linktype, data: buf.subarray(off, off + incl) });
    off += incl;
  }
  return out;
}

function readPcapng(buf: Buffer): RawPacket[] {
  const out: RawPacket[] = [];
  let le = true;
  let ifaces: { linktype: number; tsDiv: number }[] = [];
  let off = 0;
  while (off + 12 <= buf.length) {
    const typeLE = buf.readUInt32LE(off);
    if (typeLE === 0x0a0d0d0a) {
      // Section Header Block: Byte-Order-Magic bestimmt die Endianness.
      le = buf.readUInt32LE(off + 8) === 0x1a2b3c4d;
      ifaces = [];
    }
    const u32 = (o: number) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
    const u16 = (o: number) => (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o));
    const type = u32(off);
    const len = u32(off + 4);
    if (len < 12 || off + len > buf.length) break;
    const body = off + 8;

    if (type === 1) {
      // Interface Description Block – Optionen nach if_tsresol durchsuchen.
      let tsDiv = 1e3; // Standard: Mikrosekunden -> ms
      let o = body + 8;
      while (o + 4 <= off + len - 4) {
        const code = u16(o);
        const olen = u16(o + 2);
        if (code === 0) break;
        if (code === 9 && olen >= 1) {
          const r = buf[o + 4]!;
          const units = r & 0x80 ? 2 ** (r & 0x7f) : 10 ** r;
          tsDiv = units / 1e3;
        }
        o += 4 + Math.ceil(olen / 4) * 4;
      }
      ifaces.push({ linktype: u16(body), tsDiv });
    } else if (type === 6) {
      // Enhanced Packet Block
      const iface = ifaces[u32(body)] ?? { linktype: 1, tsDiv: 1e3 };
      const ts = (u32(body + 4) * 2 ** 32 + u32(body + 8)) / iface.tsDiv;
      const incl = u32(body + 12);
      out.push({ ts, linktype: iface.linktype, data: buf.subarray(body + 20, body + 20 + incl) });
    } else if (type === 3) {
      // Simple Packet Block (ohne Zeitstempel)
      const iface = ifaces[0] ?? { linktype: 1, tsDiv: 1e3 };
      const incl = Math.min(u32(body), len - 16);
      out.push({ ts: 0, linktype: iface.linktype, data: buf.subarray(body + 4, body + 4 + incl) });
    }
    off += len;
  }
  return out;
}

/** Liefert die IP-Schicht eines Frames, abhängig vom Linktyp. */
function ipLayer(p: RawPacket): Buffer | null {
  const d = p.data;
  switch (p.linktype) {
    case 1: {
      // Ethernet, ggf. mit VLAN-Tag(s)
      let o = 12;
      let et = d.readUInt16BE(o);
      while (et === 0x8100 || et === 0x88a8) {
        o += 4;
        et = d.readUInt16BE(o);
      }
      return et === 0x0800 || et === 0x86dd ? d.subarray(o + 2) : null;
    }
    case 101:
    case 228:
    case 229:
    case 12:
    case 14:
      return d;
    case 113: {
      const et = d.readUInt16BE(14);
      return et === 0x0800 || et === 0x86dd ? d.subarray(16) : null;
    }
    case 276: {
      const et = d.readUInt16BE(0);
      return et === 0x0800 || et === 0x86dd ? d.subarray(20) : null;
    }
    case 0: {
      const fam = d.readUInt32LE(0);
      return fam === 2 || fam === 24 || fam === 28 || fam === 30 ? d.subarray(4) : null;
    }
    default:
      return null;
  }
}

function ipv6ToString(b: Buffer): string {
  const parts: string[] = [];
  for (let i = 0; i < 16; i += 2) parts.push(b.readUInt16BE(i).toString(16));
  return parts.join(":").replace(/(^|:)0(:0)+(:|$)/, "::");
}

export function decode(raws: RawPacket[]): { packets: Packet[]; skipped: number } {
  const packets: Packet[] = [];
  let skipped = 0;
  raws.forEach((raw, index) => {
    try {
      const ip = ipLayer(raw);
      if (!ip || ip.length < 20) return void skipped++;
      let proto: number;
      let src: string;
      let dst: string;
      let l4: Buffer;
      if (ip[0]! >> 4 === 4) {
        const ihl = (ip[0]! & 0x0f) * 4;
        const total = ip.readUInt16BE(2);
        const fragOffset = ip.readUInt16BE(6) & 0x1fff;
        if (fragOffset !== 0) return void skipped++; // Folgefragmente ignorieren
        proto = ip[9]!;
        src = `${ip[12]}.${ip[13]}.${ip[14]}.${ip[15]}`;
        dst = `${ip[16]}.${ip[17]}.${ip[18]}.${ip[19]}`;
        l4 = ip.subarray(ihl, total > 0 ? Math.min(total, ip.length) : ip.length);
      } else if (ip[0]! >> 4 === 6) {
        proto = ip[6]!;
        src = ipv6ToString(ip.subarray(8, 24));
        dst = ipv6ToString(ip.subarray(24, 40));
        l4 = ip.subarray(40, 40 + ip.readUInt16BE(4));
      } else {
        return void skipped++;
      }
      if (proto === 17 && l4.length >= 8) {
        const len = l4.readUInt16BE(4);
        packets.push({
          index, ts: raw.ts, proto: "udp", src, dst,
          sport: l4.readUInt16BE(0), dport: l4.readUInt16BE(2),
          payload: l4.subarray(8, len >= 8 ? Math.min(len, l4.length) : l4.length),
        });
      } else if (proto === 6 && l4.length >= 20) {
        const hlen = (l4[12]! >> 4) * 4;
        packets.push({
          index, ts: raw.ts, proto: "tcp", src, dst,
          sport: l4.readUInt16BE(0), dport: l4.readUInt16BE(2),
          seq: l4.readUInt32BE(4), flags: l4[13]!,
          payload: l4.subarray(hlen),
        });
      } else {
        skipped++;
      }
    } catch {
      skipped++;
    }
  });
  return { packets, skipped };
}

export function flowKey(p: Packet): string {
  return `${p.proto} ${p.src}:${p.sport} > ${p.dst}:${p.dport}`;
}
