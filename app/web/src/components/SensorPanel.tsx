import Box from "@mui/material/Box";
import FormControlLabel from "@mui/material/FormControlLabel";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import type { SensorReading } from "../api";
import type { StabilizeSettings } from "../hooks";

const hex = (n: number) => `0x${n.toString(16).padStart(2, "0")}`;

export function SensorPanel({
  reading,
  rate,
  settings,
  onChange,
}: {
  reading: SensorReading | null;
  rate: number | null;
  settings: StabilizeSettings;
  onChange: (s: StabilizeSettings) => void;
}) {
  const available = !!reading?.available;

  return (
    <Stack spacing={2}>
      {!reading ? (
        <Typography variant="body2" color="text.secondary">
          Warte auf Sensordaten …
        </Typography>
      ) : !available ? (
        <Typography variant="body2" color="text.secondary">
          Die Kamera liefert keine Lagewerte (alle 0).
        </Typography>
      ) : (
        <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
          <Dial roll={reading.roll} pitch={reading.pitch} />
          <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1.5, flex: 1, minWidth: 0 }}>
            <Value label="Drehung" value={`${reading.roll.toFixed(1)}°`} big />
            <Value label="Neigung" value={`${reading.pitch.toFixed(1)}°`} big />
            <Value label="Roh x / y / z" value={`${reading.x} / ${reading.y} / ${reading.z}`} mono span />
            <Value label="Header-Byte 0 / 5" value={`${hex(reading.flags[0])} / ${hex(reading.flags[1])}`} mono />
            <Value label="Aktualisierung" value={rate === null ? "…" : `${rate.toFixed(0)} Hz`} />
          </Box>
        </Stack>
      )}

      <Box>
        <Typography variant="overline" color="text.secondary">
          Stabilisierung
        </Typography>
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
                  checked={settings.invert}
                  disabled={!settings.enabled}
                  onChange={(e) => onChange({ ...settings, invert: e.target.checked })}
                />
              }
              label="Richtung umkehren"
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
      </Box>

    </Stack>
  );
}

function Value({ label, value, big, mono, span }: { label: string; value: string; big?: boolean; mono?: boolean; span?: boolean }) {
  return (
    <Box sx={{ gridColumn: span ? "1 / -1" : undefined, minWidth: 0 }}>
      <Typography variant="caption" color="text.secondary" component="div">
        {label}
      </Typography>
      <Typography
        variant={big ? "h6" : "body2"}
        noWrap
        sx={{ fontFamily: mono ? "ui-monospace, SFMono-Regular, Menlo, monospace" : undefined, fontVariantNumeric: "tabular-nums" }}
      >
        {value}
      </Typography>
    </Box>
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
      sx={{ width: 96, height: 96, flex: "0 0 96px" }}
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
