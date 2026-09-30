export interface CameraStatus {
  driver: string;
  connected: boolean;
  fps: number;
  frameCount: number;
  lastFrameAt: number | null;
  battery: number | null;
  led: number | null;
  error: string | null;
  capabilities: { led: boolean; battery: boolean; sensors: boolean };
  details: Record<string, string>;
}

export interface SensorReading {
  x: number;
  y: number;
  z: number;
  /** 0–360° */
  roll: number;
  /** −90…90° */
  pitch: number;
  flags: [number, number];
  available: boolean;
}

export interface Photo {
  name: string;
  size: number;
  createdAt: number;
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error ?? data?.message ?? `HTTP ${res.status}`);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

export const api = {
  status: () => request<CameraStatus>("GET", "/api/status"),
  reconnect: () => request<CameraStatus>("POST", "/api/connect"),
  setLed: (level: number) => request<CameraStatus>("POST", "/api/led", { level }),
  photos: () => request<Photo[]>("GET", "/api/photos"),
  takePhoto: () => request<Photo>("POST", "/api/photos"),
  deletePhoto: (name: string) => request<void>("DELETE", `/api/photos/${encodeURIComponent(name)}`),
  photoUrl: (name: string) => `/api/photos/${encodeURIComponent(name)}`,
  streamUrl: (nonce: number) => `/api/stream.mjpeg?n=${nonce}`,
  sensorsUrl: "/api/sensors",
};
