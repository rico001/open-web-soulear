import { useEffect, useRef, useState } from "react";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import CardHeader from "@mui/material/CardHeader";
import Chip from "@mui/material/Chip";
import Collapse from "@mui/material/Collapse";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import FormControlLabel from "@mui/material/FormControlLabel";
import Grid from "@mui/material/Grid";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import ExploreIcon from "@mui/icons-material/Explore";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import { api, type SensorReading } from "./api";

export interface StabilizeSettings {
  enabled: boolean;
  /** Drehrichtung umkehren, falls das Bild gegen die Bewegung dreht. */
  invert: boolean;
  /** Fester Versatz in Grad. Standard 270° – am Soulear-Gerät ermittelt. */
  offset: number;
}

const DEFAULT_SETTINGS: StabilizeSettings = { enabled: false, invert: false, offset: 270 };
/** v2: Standard-Versatz auf 270° geändert – alte gespeicherte 180° nicht übernehmen. */
const STORAGE_KEY = "soulear.stabilize.v2";

/** Einstellungen pro Browser merken – reine Bequemlichkeit, darf fehlschlagen. */
export function useStabilizeSettings(): [StabilizeSettings, (s: StabilizeSettings) => void] {
  const [settings, setSettings] = useState<StabilizeSettings>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS;
    } catch {
      return DEFAULT_SETTINGS;
    }
  });
  const update = (s: StabilizeSettings) => {
    setSettings(s);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    } catch {
      /* ohne Speicher weiter */
    }
  };
  return [settings, update];
}

/** Sensorwerte per Server-Sent Events; `rate` = Aktualisierungen pro Sekunde. */
export function useSensors(active: boolean): { reading: SensorReading | null; rate: number } {
  const [reading, setReading] = useState<SensorReading | null>(null);
  const [rate, setRate] = useState(0);
  const count = useRef(0);

  useEffect(() => {
    if (!active) {
      setReading(null);
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

const hex = (n: number) => `0x${n.toString(16).padStart(2, "0")}`;

export function SensorPanel({
  reading,
  rate,
  settings,
  onChange,
}: {
  reading: SensorReading | null;
  rate: number;
  settings: StabilizeSettings;
  onChange: (s: StabilizeSettings) => void;
}) {
  const available = !!reading?.available;
  const [showHelp, setShowHelp] = useState(false);
  return (
    <Card>
      <CardHeader
        avatar={<ExploreIcon color="primary" />}
        title="Lage & Sensoren"
        slotProps={{ title: { variant: "subtitle1", fontWeight: 650 } }}
        action={
          <Stack direction="row" spacing={0.5} sx={{ alignItems: "center", mt: 0.5, mr: 0.5 }}>
            {reading && <Chip size="small" variant="outlined" label={`${rate.toFixed(0)} Hz`} />}
            <Tooltip title={showHelp ? "Hinweis ausblenden" : "Hinweis anzeigen"}>
              <IconButton
                size="small"
                aria-label="Hinweis zu Lage & Sensoren"
                aria-expanded={showHelp}
                color={showHelp ? "primary" : "default"}
                onClick={() => setShowHelp((v) => !v)}
              >
                <InfoOutlinedIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Stack>
        }
      />
      <CardContent sx={{ pt: 0 }}>
        <Stack spacing={1}>
          <FormControlLabel
            control={
              <Switch
                checked={settings.enabled}
                disabled={!available}
                onChange={(e) => onChange({ ...settings, enabled: e.target.checked })}
              />
            }
            label="Bild stabilisieren"
          />
          <Stack direction="row" spacing={2} sx={{ alignItems: "center", flexWrap: "wrap", rowGap: 1 }}>
            <FormControlLabel
              control={
                <Switch
                  size="small"
                  checked={settings.invert}
                  disabled={!settings.enabled}
                  onChange={(e) => onChange({ ...settings, invert: e.target.checked })}
                />
              }
              label={<Typography variant="body2">Richtung umkehren</Typography>}
            />
            <TextField
              select
              size="small"
              label="Versatz"
              value={settings.offset}
              disabled={!settings.enabled}
              onChange={(e) => onChange({ ...settings, offset: Number(e.target.value) })}
              sx={{ minWidth: 110 }}
            >
              {[0, 90, 180, 270].map((o) => (
                <MenuItem key={o} value={o}>
                  {o}°
                </MenuItem>
              ))}
            </TextField>
          </Stack>
        </Stack>

        {!reading ? (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
            Warte auf Sensordaten …
          </Typography>
        ) : !available ? (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
            Die Kamera liefert keine Lagewerte (alle 0).
          </Typography>
        ) : (
          <Stack direction="row" spacing={2.5} sx={{ mt: 2, alignItems: "center" }}>
            <Dial roll={reading.roll} pitch={reading.pitch} />
            <Grid container spacing={1.5} sx={{ flex: 1 }}>
              <Value label="Drehung" value={`${reading.roll.toFixed(1)}°`} big />
              <Value label="Neigung" value={`${reading.pitch.toFixed(1)}°`} big />
              <Value label="Roh x / y / z" value={`${reading.x} / ${reading.y} / ${reading.z}`} mono />
              <Value label="Header-Byte 0 / 5" value={`${hex(reading.flags[0])} / ${hex(reading.flags[1])}`} mono />
            </Grid>
          </Stack>
        )}

        <Collapse in={showHelp}>
          <Typography variant="caption" component="p" color="text.secondary" sx={{ mt: 2, mb: 0 }}>
            Stabilisieren dreht das Livebild gegen die Drehung der Kamera. Dreht es in die falsche Richtung, „Richtung
            umkehren“ einschalten; steht es schief, den Versatz ändern. Header-Byte 0/5 sind noch unbekannt – ändert
            sich eines beim Drücken der Kamerataste, ist das die Taste.
          </Typography>
        </Collapse>
      </CardContent>
    </Card>
  );
}

function Value({ label, value, big, mono }: { label: string; value: string; big?: boolean; mono?: boolean }) {
  return (
    <Grid size={6}>
      <Typography variant="caption" color="text.secondary" component="div">
        {label}
      </Typography>
      <Typography
        variant={big ? "h6" : "body2"}
        sx={{ fontFamily: mono ? "ui-monospace, SFMono-Regular, Menlo, monospace" : undefined, fontVariantNumeric: "tabular-nums" }}
      >
        {value}
      </Typography>
    </Grid>
  );
}

/** Lageanzeige: Zeiger = Drehung (0° oben, im Uhrzeigersinn), Punkt = Neigung. */
function Dial({ roll, pitch }: { roll: number; pitch: number }) {
  const rad = ((roll - 90) * Math.PI) / 180;
  const nx = 50 + Math.cos(rad) * 34;
  const ny = 50 + Math.sin(rad) * 34;
  const py = 50 - (Math.max(-90, Math.min(90, pitch)) / 90) * 34;
  return (
    <Box
      component="svg"
      viewBox="0 0 100 100"
      role="img"
      aria-label={`Drehung ${roll.toFixed(0)}°, Neigung ${pitch.toFixed(0)}°`}
      sx={{ width: 104, height: 104, flex: "0 0 104px" }}
    >
      <circle cx="50" cy="50" r="44" fill="var(--mui-palette-background-default)" stroke="var(--mui-palette-divider)" strokeWidth="2" />
      <line x1="16" y1="50" x2="84" y2="50" stroke="var(--mui-palette-divider)" strokeWidth="1" strokeDasharray="2 3" />
      <line x1="50" y1="6" x2="50" y2="14" stroke="var(--mui-palette-text-secondary)" strokeWidth="2" />
      <line x1="50" y1="50" x2={nx} y2={ny} stroke="var(--mui-palette-primary-main)" strokeWidth="3.5" strokeLinecap="round" />
      <circle cx="50" cy="50" r="3" fill="var(--mui-palette-primary-main)" />
      <circle cx="50" cy={py} r="4.5" fill="var(--mui-palette-text-secondary)" opacity="0.8" />
    </Box>
  );
}
