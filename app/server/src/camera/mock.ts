import jpeg from "jpeg-js";
import { SensorSmoother } from "./suear-protocol.js";
import { CameraDriver } from "./types.js";

const WIDTH = 640;
const HEIGHT = 480;

/**
 * Künstliche Kamera für die Frontend-Entwicklung ohne Hardware: ein runder
 * „Ohrkanal“ mit wandernder Lichtquelle, LED-Helligkeit wirkt aufs Bild.
 */
export class MockDriver extends CameraDriver {
  readonly name = "mock";
  readonly capabilities = { led: true, battery: true, sensors: true };

  private timer: NodeJS.Timeout | null = null;
  private tick = 0;
  private readonly rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  private readonly smoother = new SensorSmoother();

  constructor(private readonly fps = 15) {
    super();
    this.led = 80;
    this.battery = 100;
    this.details = { Modell: "Mock-Kamera", Auflösung: `${WIDTH}×${HEIGHT}` };
  }

  async connect(): Promise<void> {
    if (this.timer) return;
    this.connected = true;
    this.timer = setInterval(() => this.render(), 1000 / this.fps);
  }

  async disconnect(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.connected = false;
  }

  override async setLed(level: number): Promise<void> {
    this.led = Math.max(0, Math.min(100, Math.round(level)));
  }

  private render(): void {
    this.tick++;
    // Akku entlädt sich langsam, damit die Anzeige etwas zu tun hat.
    if (this.tick % (this.fps * 30) === 0 && this.battery! > 5) this.battery!--;

    const t = this.tick / this.fps;
    const cx = WIDTH / 2;
    const cy = HEIGHT / 2;
    const r = Math.min(WIDTH, HEIGHT) * 0.45;
    const lx = cx + Math.cos(t * 0.8) * r * 0.4;
    const ly = cy + Math.sin(t * 1.1) * r * 0.3;
    const gain = 0.2 + (this.led! / 100) * 0.8;

    // Simulierte Lage: Kamera dreht langsam hin und her. Beschleunigungswerte
    // so gewählt, dass atan2(y, z) den Rollwinkel ergibt (wie der Treiber rechnet).
    const roll = 90 * Math.sin(t * 0.4) + 30;
    const pitch = 20 * Math.sin(t * 0.25);
    const rad = Math.PI / 180;
    const g = 1000;
    const accel: [number, number, number] = [
      Math.round(g * Math.sin(pitch * rad)),
      Math.round(g * Math.cos(pitch * rad) * Math.sin(roll * rad)),
      Math.round(g * Math.cos(pitch * rad) * Math.cos(roll * rad)),
    ];
    // Markierung im Rohbild so platzieren, dass sie nach der Stabilisierung
    // (Drehung um roll + 180° im Uhrzeigersinn) oben steht.
    const markAngle = (-90 - (roll + 180)) * rad;
    const mx = cx + Math.cos(markAngle) * r * 0.75;
    const my = cy + Math.sin(markAngle) * r * 0.75;

    const px = this.rgba;
    for (let y = 0; y < HEIGHT; y++) {
      for (let x = 0; x < WIDTH; x++) {
        const i = (y * WIDTH + x) * 4;
        const d = Math.hypot(x - cx, y - cy) / r;
        if (d > 1) {
          px[i] = px[i + 1] = px[i + 2] = 0;
        } else if (Math.hypot(x - mx, y - my) < r * 0.08) {
          px[i] = 40;
          px[i + 1] = 200;
          px[i + 2] = 120;
        } else {
          const l = Math.max(0, 1 - Math.hypot(x - lx, y - ly) / (r * 0.9));
          const v = gain * (0.35 + 0.65 * l) * (1 - d * d * 0.6);
          px[i] = Math.min(255, 230 * v);
          px[i + 1] = Math.min(255, 140 * v);
          px[i + 2] = Math.min(255, 120 * v);
        }
        px[i + 3] = 255;
      }
    }
    const { data } = jpeg.encode({ data: px, width: WIDTH, height: HEIGHT }, 70);
    this.pushFrame(Buffer.from(data));
    this.pushSensor(this.smoother.push(accel, [1, 0]));
  }
}
