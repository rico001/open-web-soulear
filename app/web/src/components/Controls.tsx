import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import FlashlightOffIcon from "@mui/icons-material/FlashlightOff";
import FlashlightOnIcon from "@mui/icons-material/FlashlightOn";
import PhotoCameraIcon from "@mui/icons-material/PhotoCamera";
import RefreshIcon from "@mui/icons-material/Refresh";
import ScreenRotationIcon from "@mui/icons-material/ScreenRotation";

interface Props {
  connected: boolean;
  /** null = Treiber hat keine LED. */
  led: number | null;
  /** null = keine Lagewerte verfügbar. */
  stabilize: boolean | null;
  onPhoto: () => void;
  onToggleLed: () => void;
  onToggleStabilize: () => void;
  onReconnect: () => void;
}

/** Bedienleiste unter dem Livebild. Mobil: große Knöpfe im Raster, Desktop: eine Zeile. */
export function Controls({ connected, led, stabilize, onPhoto, onToggleLed, onToggleStabilize, onReconnect }: Props) {
  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: { xs: "1fr 1fr auto", sm: "auto auto auto 1fr auto" },
        gap: 1,
        p: { xs: 1, md: 1.5 },
        alignItems: "center",
        borderTop: 1,
        borderColor: "divider",
      }}
    >
      <Button
        variant="contained"
        size="large"
        startIcon={<PhotoCameraIcon />}
        disabled={!connected}
        onClick={onPhoto}
        sx={{ gridColumn: { xs: "1 / -1", sm: "auto" } }}
      >
        Foto aufnehmen
      </Button>
      {led !== null && (
        <Button
          variant={led ? "contained" : "outlined"}
          color={led ? "warning" : "inherit"}
          startIcon={led ? <FlashlightOnIcon /> : <FlashlightOffIcon />}
          disabled={!connected}
          aria-pressed={!!led}
          onClick={onToggleLed}
        >
          LED {led ? "an" : "aus"}
        </Button>
      )}
      {stabilize !== null && (
        <Button
          variant={stabilize ? "contained" : "outlined"}
          color={stabilize ? "primary" : "inherit"}
          startIcon={<ScreenRotationIcon />}
          aria-pressed={stabilize}
          onClick={onToggleStabilize}
        >
          Stabilisieren
        </Button>
      )}
      <Box sx={{ display: { xs: "none", sm: "block" } }} />
      <Tooltip title="Neu verbinden">
        <IconButton aria-label="Neu verbinden" onClick={onReconnect} sx={{ justifySelf: "end" }}>
          <RefreshIcon />
        </IconButton>
      </Tooltip>
    </Box>
  );
}
