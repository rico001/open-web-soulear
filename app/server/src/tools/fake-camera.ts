/**
 * Simulierte Suear/Soulear-Kamera zum Testen des Treibers ohne Hardware.
 * Beantwortet GetDeviceInfo, SetLed und OpenVideo und streamt danach
 * JPEG-Chunks (Bilder vom Mock-Treiber) an den Client.
 *
 *   npm run fake-camera -- [--loss 0.02] [--shuffle] [--plain-only] [--fixed-port 22789]
 *   DRIVER=soulear CAMERA_IP=127.0.0.1 npm run dev
 *
 * --loss        Anteil verworfener Chunks
 * --shuffle     Chunks innerhalb eines Frames teilweise vertauschen
 * --plain-only  OpenVideo mit Nutzlast ignorieren (alte Firmware)
 * --fixed-port  Port-Nutzlast ignorieren und immer an diesen Port senden
 *
 * Achtung: Die Simulation beruht auf denselben Annahmen wie der Treiber –
 * sie beweist nicht, dass die echte Kamera genauso antwortet.
 */
import dgram from "node:dgram";
import { MockDriver } from "../camera/mock.js";
import { CHUNK_DATA_SIZE, decodeMessage, HEADER_SIZE, MAGIC, MsgType } from "../camera/suear-protocol.js";

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const HOST = opt("host") ?? "127.0.0.1";
const LOSS = Number(opt("loss") ?? 0);
const SHUFFLE = args.includes("--shuffle");
const PLAIN_ONLY = args.includes("--plain-only");
const FIXED_PORT = opt("fixed-port") ? Number(opt("fixed-port")) : null;
const WIDTH = 640;
const HEIGHT = 480;

const cmd = dgram.createSocket("udp4");
const video = dgram.createSocket("udp4");
const mock = new MockDriver(15);
let target: { address: string; port: number } | null = null;
let led = 0;
let ledOn = false;
let chunkCounter = 0;
let frameCounter = 0;
let battery = 87;
let accel: [number, number, number] = [0, 0, 1000];
mock.on("sensor", (s) => (accel = [s.x, s.y, s.z]));

function reply(sock: dgram.Socket, to: dgram.RemoteInfo, id: number, type: number, data: Buffer = Buffer.alloc(0), err = 0) {
  const h = Buffer.alloc(HEADER_SIZE);
  h.writeUInt32LE(MAGIC, 0);
  h.writeUInt16LE(id, 4);
  h.writeUInt16LE(type, 6);
  h.writeUInt8(0, 8);
  h.writeUInt8(err, 9);
  h.writeUInt16LE(data.length, 10);
  sock.send(Buffer.concat([h, data]), to.port, to.address);
}

function deviceInfo(): Buffer {
  const d = Buffer.alloc(128);
  d.write("FAKE", 1, "latin1");
  d.write("SUEAR-SIM", 33, "latin1");
  d.write("1.0.0-sim", 65, "latin1");
  d.write("SUEAR_SIM", 81, "latin1");
  d.writeUInt16LE((battery << 9) | (0 << 8), 119);
  return d;
}

cmd.on("message", (buf, rinfo) => {
  const msg = decodeMessage(buf);
  if (!msg) return;
  if (msg.type === MsgType.GetDeviceInfo) {
    reply(cmd, rinfo, msg.id, msg.type, deviceInfo());
  } else if (msg.type === MsgType.SetLed && msg.data.length === 3 && msg.data[0]! & 0x10) {
    ledOn = msg.data[1] !== 0;
    led = msg.data[2]!;
    void mock.setLed(ledOn ? led : 0);
    console.log(`SetLed: LED ${msg.data[0]! & 0x0f}, ${ledOn ? "an" : "aus"}, ${led} %`);
    reply(cmd, rinfo, msg.id, msg.type);
  } else if (msg.type === MsgType.SetLed && msg.data.length === 3) {
    reply(cmd, rinfo, msg.id, msg.type, Buffer.from([msg.data[0]!, ledOn ? 1 : 0, led]));
  } else {
    console.log(`Unbekannter Befehl Typ ${msg.type}`);
    reply(cmd, rinfo, msg.id, msg.type, Buffer.alloc(0), 1);
  }
});

video.on("message", (buf, rinfo) => {
  const msg = decodeMessage(buf);
  if (!msg || msg.type !== MsgType.OpenVideo) return;
  if (PLAIN_ONLY && msg.data.length > 0) {
    console.log("OpenVideo mit Nutzlast ignoriert (--plain-only)");
    return; // alte Firmware: keine Antwort, kein Strom
  }
  const port = FIXED_PORT ?? (msg.data.length >= 2 ? msg.data.readUInt16LE(0) : 22785);
  target = { address: rinfo.address, port };
  console.log(`OpenVideo (${msg.data.length} Byte Nutzlast) → streame an ${rinfo.address}:${port}`);
  reply(video, rinfo, msg.id, msg.type);
});

mock.on("frame", (jpeg) => {
  if (!target) return;
  const frame = frameCounter++ & 0xff;
  const parts: Buffer[] = [];
  const total = Math.ceil(jpeg.length / CHUNK_DATA_SIZE);
  for (let i = 0; i < total; i++) {
    const h = Buffer.alloc(16);
    h[0] = 1;
    h[1] = chunkCounter++ & 0xff;
    h[2] = frame;
    h[3] = i === total - 1 ? 1 : 0;
    h[4] = i === total - 1 ? total : 0;
    h.writeInt16LE(accel[0], 6);
    h.writeInt16LE(accel[1], 8);
    h.writeInt16LE(accel[2], 10);
    h.writeUInt16LE(WIDTH, 12);
    h.writeUInt16LE(HEIGHT, 14);
    parts.push(Buffer.concat([h, jpeg.subarray(i * CHUNK_DATA_SIZE, (i + 1) * CHUNK_DATA_SIZE)]));
  }
  if (SHUFFLE) {
    for (let i = 0; i + 1 < parts.length; i += 3) [parts[i], parts[i + 1]] = [parts[i + 1]!, parts[i]!];
  }
  // Manchmal zwei Chunks in einem Datagramm, wie bei der echten Kamera beobachtet.
  for (let i = 0; i < parts.length; i++) {
    if (Math.random() < LOSS) continue;
    const packAll = i + 1 < parts.length && parts[i]!.length === 16 + CHUNK_DATA_SIZE && Math.random() < 0.3;
    const dgramBuf = packAll ? Buffer.concat([parts[i]!, parts[++i]!]) : parts[i]!;
    video.send(dgramBuf, target.port, target.address);
  }
});

setInterval(() => (battery = battery > 5 ? battery - 1 : 100), 30000);

cmd.bind(10005, HOST, () =>
  video.bind(10006, HOST, async () => {
    await mock.connect();
    console.log(`Fake-Kamera auf ${HOST}: Befehle :10005, OpenVideo :10006`);
  }),
);
