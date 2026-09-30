import { config } from "../config.js";
import { MockDriver } from "./mock.js";
import { ReplayDriver } from "./replay.js";
import { SoulearDriver } from "./soulear.js";
import type { CameraDriver } from "./types.js";

export function createDriver(log: (msg: string) => void): CameraDriver {
  switch (config.driver) {
    case "mock":
      return new MockDriver();
    case "replay":
      return new ReplayDriver(config.replayDir, config.replayFps);
    case "soulear":
      return new SoulearDriver({
        ip: config.cameraIp,
        cmdPort: config.cameraCmdPort,
        videoPort: config.cameraVideoPort,
        streamPorts: config.streamPorts,
        log,
      });
  }
}
