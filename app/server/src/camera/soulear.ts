import dgram from "node:dgram";
import {
  decodeMessage,
  encodeMessage,
  FrameAssembler,
  ledPayload,
  ledQueryPayload,
  MsgType,
  parseLedStatus,
  parseChunks,
  parseDeviceInfo,
  SensorSmoother,
  type Message,
} from "./suear-protocol.js";
import { CameraDriver } from "./types.js";

export interface SoulearOptions {
  ip: string;
  /** Befehle (GetDeviceInfo, SetLed, …). */
  cmdPort: number;
  /** OpenVideo. */
  videoPort: number;
  /** Lokale Ports, auf denen die Kamera die Bild-Chunks anliefert. */
  streamPorts: number[];
  log: (msg: string) => void;
}

/** Ohne Bilddaten so lange warten, bevor OpenVideo erneut gesendet wird. */
const STALL_MS = 6000;
const INFO_INTERVAL_MS = 10000;
const INFO_LOST = "Kamera antwortet nicht mehr auf Statusabfragen";

/**
 * Treiber für Soulear/Suear-Kameras (UDP, siehe suear-protocol.ts).
 *
 * Ablauf: GetDeviceInfo (Erreichbarkeit + Akku) → Bild-Ports öffnen →
 * OpenVideo → Chunks empfangen und zu JPEGs zusammensetzen. Bleiben Daten
 * aus, wird OpenVideo wiederholt – zuerst mit dem eigenen Empfangsport als
 * Nutzlast (wie libWifiCamera.so aus Soulear), dann ohne (wie ältere
 * Suear-Firmware, die fest an 22785/22789 sendet).
 */
export class SoulearDriver extends CameraDriver {
  readonly name = "soulear";
  readonly capabilities = { led: true, battery: true, sensors: true };

  private cmdSock: dgram.Socket | null = null;
  private streamSocks: dgram.Socket[] = [];
  private msgId = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly assembler = new FrameAssembler();
  private readonly smoother = new SensorSmoother();
  private openMode: "port" | "plain" = "port";
  private lastDataAt = 0;
  private everReceived = false;
  /** `error` stammt vom Stall-Watchdog und wird bei neuen Daten gelöscht. */
  private stallError = false;
  private restartPending = false;
  private watchdog: NodeJS.Timeout | null = null;
  private infoTimer: NodeJS.Timeout | null = null;
  private infoFailures = 0;
  private ledLogged = false;

  constructor(private readonly opts: SoulearOptions) {
    super();
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    this.error = null;
    this.everReceived = false;
    try {
      this.cmdSock = await bindUdp(0);

      const info = await this.updateInfo().catch(() => {
        throw new Error(
          `Kamera antwortet nicht (${this.opts.ip}:${this.opts.cmdPort}). Ist dieses Gerät im WLAN der Kamera?`,
        );
      });
      this.opts.log(`Kamera: ${info}`);

      await this.openStreamSockets();
      this.connected = true;
      await this.openVideo();

      // Wie die Original-App: nach dem Verbinden Licht an.
      await this.setLed(100).catch((e) => this.opts.log(`LED einschalten fehlgeschlagen: ${(e as Error).message}`));

      this.watchdog = setInterval(() => this.checkStall(), 1000);
      this.infoTimer = setInterval(() => this.pollInfo(), INFO_INTERVAL_MS);
    } catch (err) {
      await this.teardown();
      this.error = (err as Error).message;
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    await this.teardown();
  }

  override async setLed(level: number): Promise<void> {
    const res = await this.request(this.opts.cmdPort, MsgType.SetLed, ledPayload(level));
    if (res.errCode !== 0) throw new Error(`SetLed: Fehlercode ${res.errCode}`);
    this.led = Math.max(0, Math.min(100, Math.round(level)));
    // Anzeige nach dem tatsächlichen Zustand der Kamera richten.
    await this.readLed().catch(() => undefined);
  }

  /** Liest den LED-Zustand von der Kamera; bei unlesbarer Antwort bleibt der alte Wert. */
  private async readLed(): Promise<void> {
    const res = await this.request(this.opts.cmdPort, MsgType.SetLed, ledQueryPayload());
    const level = parseLedStatus(res.data);
    if (!this.ledLogged) {
      this.ledLogged = true;
      this.opts.log(`LED-Abfrage: Antwort ${res.data.toString("hex") || "(leer)"} → ${level ?? "unlesbar"}`);
    }
    if (level !== null) this.led = level;
  }

  // --- intern ---------------------------------------------------------------

  private async teardown(): Promise<void> {
    if (this.watchdog) clearInterval(this.watchdog);
    if (this.infoTimer) clearInterval(this.infoTimer);
    this.watchdog = this.infoTimer = null;
    for (const s of [this.cmdSock, ...this.streamSocks]) s?.close();
    this.cmdSock = null;
    this.streamSocks = [];
    this.assembler.reset();
    this.smoother.reset();
    this.connected = false;
  }

  private async updateInfo(): Promise<string> {
    const res = await this.request(this.opts.cmdPort, MsgType.GetDeviceInfo);
    const info = parseDeviceInfo(res.data);
    if (!info) throw new Error(`GetDeviceInfo: unerwartete Antwort (${res.data.length} Byte)`);
    this.battery = Math.min(100, info.battery);
    this.details = {
      ...this.details,
      Hersteller: info.vendor,
      Modell: info.product,
      Firmware: info.firmware,
      SSID: info.ssid,
      Laden: info.charging ? "ja" : "nein",
    };
    return `${info.vendor} ${info.product} ${info.firmware}, Akku ${info.battery} %`;
  }

  private async pollInfo(): Promise<void> {
    try {
      await this.updateInfo();
      await this.readLed().catch(() => undefined);
      this.infoFailures = 0;
      if (this.error === INFO_LOST) this.error = null;
    } catch {
      if (++this.infoFailures >= 3) this.error = INFO_LOST;
    }
  }

  private async openStreamSockets(): Promise<void> {
    const results = await Promise.allSettled(this.opts.streamPorts.map((p) => bindUdp(p)));
    results.forEach((r, i) => {
      const port = this.opts.streamPorts[i]!;
      if (r.status === "rejected") {
        this.opts.log(`Bild-Port ${port} nicht nutzbar: ${(r.reason as Error).message}`);
        return;
      }
      r.value.on("message", (buf, rinfo) => this.onStreamData(buf, rinfo, port));
      this.streamSocks.push(r.value);
    });
    if (this.streamSocks.length === 0) throw new Error(`Keiner der Bild-Ports ${this.opts.streamPorts.join("/")} ist frei`);
  }

  private async openVideo(): Promise<void> {
    try {
      await this.sendOpenVideo();
    } catch (err) {
      // Ältere Firmware kennt die Port-Nutzlast evtl. nicht → ohne versuchen.
      // Hat der Port-Modus schon Bilder geliefert, ist es nur ein Ausfall.
      if (this.openMode !== "port" || this.everReceived) throw err;
      this.opts.log(`OpenVideo mit Port fehlgeschlagen (${(err as Error).message}) – versuche ohne Nutzlast`);
      this.openMode = "plain";
      await this.sendOpenVideo();
    }
  }

  private async sendOpenVideo(): Promise<void> {
    let payload = Buffer.alloc(0);
    if (this.openMode === "port") {
      payload = Buffer.alloc(2);
      payload.writeUInt16LE(this.opts.streamPorts[0]!, 0);
    }
    const res = await this.request(this.opts.videoPort, MsgType.OpenVideo, payload);
    if (res.errCode !== 0) throw new Error(`OpenVideo (${this.openMode}): Fehlercode ${res.errCode}`);
    this.lastDataAt = Date.now();
    this.opts.log(`OpenVideo gesendet (Modus ${this.openMode})`);
  }

  private checkStall(): void {
    if (!this.connected || this.restartPending || Date.now() - this.lastDataAt < STALL_MS) return;
    if (!this.everReceived && this.openMode === "port") this.openMode = "plain";
    this.error = this.everReceived
      ? "Bildstrom unterbrochen – starte neu"
      : "Keine Bilddaten von der Kamera – versuche anderen Startmodus";
    this.stallError = true;
    this.opts.log(this.error);
    this.lastDataAt = Date.now(); // nicht bei jedem Tick erneut versuchen
    this.restartPending = true;
    this.openVideo()
      .catch((e) => this.opts.log(`OpenVideo fehlgeschlagen: ${(e as Error).message}`))
      .finally(() => (this.restartPending = false));
  }

  private onStreamData(buf: Buffer, rinfo: dgram.RemoteInfo, port: number): void {
    if (rinfo.address !== this.opts.ip) return;
    this.lastDataAt = Date.now();
    if (!this.everReceived) {
      this.everReceived = true;
      this.details = { ...this.details, Empfangsport: String(port), Startmodus: this.openMode };
      this.opts.log(`Erste Bilddaten auf Port ${port} (Startmodus ${this.openMode})`);
    }
    if (this.stallError) {
      this.stallError = false;
      this.error = null;
    }

    for (const chunk of parseChunks(buf)) {
      for (const frame of this.assembler.push(chunk)) {
        this.details.Auflösung = `${frame.width}×${frame.height}`;
        this.pushFrame(frame.jpeg);
        this.pushSensor(this.smoother.push(frame.accel, frame.flags));
      }
    }
  }

  /**
   * Anfrage/Antwort auf dem Befehls-Socket. Serialisiert – die Kamera
   * beantwortet eine Anfrage nach der anderen; Antworten werden über
   * Absenderport und Nachrichtentyp zugeordnet.
   */
  private request(port: number, type: number, data?: Buffer, timeoutMs = 1500, attempts = 3): Promise<Message> {
    const run = async (): Promise<Message> => {
      let lastErr: Error = new Error("keine Antwort");
      for (let i = 0; i < attempts; i++) {
        try {
          return await this.requestOnce(port, type, data, timeoutMs);
        } catch (e) {
          lastErr = e as Error;
        }
      }
      throw lastErr;
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => undefined);
    return p;
  }

  private requestOnce(port: number, type: number, data: Buffer | undefined, timeoutMs: number): Promise<Message> {
    const sock = this.cmdSock;
    if (!sock) return Promise.reject(new Error("nicht verbunden"));
    const packet = encodeMessage(this.msgId++, type, data);
    return new Promise((resolve, reject) => {
      const onMessage = (buf: Buffer, rinfo: dgram.RemoteInfo) => {
        if (rinfo.address !== this.opts.ip || rinfo.port !== port) return;
        const msg = decodeMessage(buf);
        if (!msg || msg.type !== type) return;
        cleanup();
        resolve(msg);
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Zeitüberschreitung (Typ ${type}, Port ${port})`));
      }, timeoutMs);
      const cleanup = () => {
        clearTimeout(timer);
        sock.off("message", onMessage);
      };
      sock.on("message", onMessage);
      sock.send(packet, port, this.opts.ip, (err) => {
        if (err) {
          cleanup();
          reject(err);
        }
      });
    });
  }
}

function bindUdp(port: number): Promise<dgram.Socket> {
  return new Promise((resolve, reject) => {
    const sock = dgram.createSocket({ type: "udp4", reuseAddr: false });
    sock.once("error", reject);
    sock.bind(port, () => {
      sock.off("error", reject);
      sock.on("error", () => undefined); // spätere ICMP-Fehler nicht als Absturz werten
      resolve(sock);
    });
  });
}
