import { useEffect, useRef, useState } from "react";
import { api, type SensorReading } from "./api";

/**
 * useState, der sich den Wert pro Browser merkt – reine Bequemlichkeit:
 * Ohne Speicher (privates Fenster, blockiert) läuft alles mit dem Standardwert.
 */
export function useStoredState<T>(key: string, initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return initial;
      const parsed = JSON.parse(raw) as T;
      return typeof initial === "object" && initial !== null ? { ...initial, ...parsed } : parsed;
    } catch {
      return initial;
    }
  });
  const update = (v: T) => {
    setValue(v);
    try {
      localStorage.setItem(key, JSON.stringify(v));
    } catch {
      /* ohne Speicher weiter */
    }
  };
  return [value, update];
}

export interface StabilizeSettings {
  enabled: boolean;
  /** Drehrichtung umkehren, falls das Bild gegen die Bewegung dreht. */
  invert: boolean;
  /** Fester Versatz in Grad. Standard 270° – am Soulear-Gerät ermittelt. */
  offset: number;
}

/** v2: Standard-Versatz auf 270° geändert – alte gespeicherte 180° nicht übernehmen. */
export function useStabilizeSettings() {
  return useStoredState<StabilizeSettings>("soulear.stabilize.v2", { enabled: false, invert: false, offset: 270 });
}

/** Sensorwerte per Server-Sent Events; `rate` = Aktualisierungen pro Sekunde. */
export function useSensors(active: boolean): { reading: SensorReading | null; rate: number | null } {
  const [reading, setReading] = useState<SensorReading | null>(null);
  /** null, bis die erste Messung (nach 2 s) vorliegt. */
  const [rate, setRate] = useState<number | null>(null);
  const count = useRef(0);

  useEffect(() => {
    if (!active) {
      setReading(null);
      setRate(null);
      return;
    }
    const es = new EventSource(api.sensorsUrl);
    es.onmessage = (e) => {
      count.current++;
      setReading(JSON.parse(e.data) as SensorReading);
    };
    const t = window.setInterval(() => {
      setRate(count.current / 2);
      count.current = 0;
    }, 2000);
    return () => {
      es.close();
      window.clearInterval(t);
    };
  }, [active]);

  return { reading, rate };
}

/**
 * Drehwinkel fürs Livebild. Läuft stetig weiter statt von 359° auf 0° zu
 * springen, damit die CSS-Transition nicht einmal rückwärts herumdreht.
 */
export function useRotation(reading: SensorReading | null, s: StabilizeSettings): number | null {
  const last = useRef<number | null>(null);
  if (!s.enabled || !reading?.available) {
    last.current = null;
    return null;
  }
  const target = (s.invert ? -reading.roll : reading.roll) + s.offset;
  if (last.current === null) {
    last.current = target;
  } else {
    const delta = ((((target - last.current) % 360) + 540) % 360) - 180;
    last.current += delta;
  }
  return last.current;
}
