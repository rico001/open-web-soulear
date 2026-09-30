import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import Alert from "@mui/material/Alert";
import AppBar from "@mui/material/AppBar";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardActions from "@mui/material/CardActions";
import CardContent from "@mui/material/CardContent";
import CardHeader from "@mui/material/CardHeader";
import Chip from "@mui/material/Chip";
import Container from "@mui/material/Container";
import Grid from "@mui/material/Grid";
import IconButton from "@mui/material/IconButton";
import ImageList from "@mui/material/ImageList";
import ImageListItem from "@mui/material/ImageListItem";
import ImageListItemBar from "@mui/material/ImageListItemBar";
import Snackbar from "@mui/material/Snackbar";
import Stack from "@mui/material/Stack";
import Toolbar from "@mui/material/Toolbar";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import Battery0BarIcon from "@mui/icons-material/Battery0Bar";
import Battery1BarIcon from "@mui/icons-material/Battery1Bar";
import Battery2BarIcon from "@mui/icons-material/Battery2Bar";
import Battery3BarIcon from "@mui/icons-material/Battery3Bar";
import Battery4BarIcon from "@mui/icons-material/Battery4Bar";
import Battery5BarIcon from "@mui/icons-material/Battery5Bar";
import Battery6BarIcon from "@mui/icons-material/Battery6Bar";
import BatteryAlertIcon from "@mui/icons-material/BatteryAlert";
import BatteryChargingFullIcon from "@mui/icons-material/BatteryChargingFull";
import BatteryFullIcon from "@mui/icons-material/BatteryFull";
import DeleteOutlinedIcon from "@mui/icons-material/DeleteOutlined";
import DownloadIcon from "@mui/icons-material/Download";
import FlashlightOffIcon from "@mui/icons-material/FlashlightOff";
import FlashlightOnIcon from "@mui/icons-material/FlashlightOn";
import VideocamIcon from "@mui/icons-material/Videocam";
import LinkIcon from "@mui/icons-material/Link";
import LinkOffIcon from "@mui/icons-material/LinkOff";
import MemoryIcon from "@mui/icons-material/Memory";
import PhotoCameraIcon from "@mui/icons-material/PhotoCamera";
import PhotoLibraryOutlinedIcon from "@mui/icons-material/PhotoLibraryOutlined";
import RefreshIcon from "@mui/icons-material/Refresh";
import SpeedIcon from "@mui/icons-material/Speed";
import VideocamOffIcon from "@mui/icons-material/VideocamOff";
import { api, type CameraStatus, type Photo } from "./api";
import { SensorPanel, useRotation, useSensors, useStabilizeSettings } from "./sensors";

export function App() {
  const [status, setStatus] = useState<CameraStatus | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [stabilize, setStabilize] = useStabilizeSettings();
  const sensorsActive = !!status?.connected && !!status.capabilities.sensors;
  const { reading, rate } = useSensors(sensorsActive);
  const rotation = useRotation(reading, stabilize);

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await api.status());
    } catch {
      setStatus(null);
    }
  }, []);

  const refreshPhotos = useCallback(async () => {
    try {
      setPhotos(await api.photos());
    } catch (e) {
      setMessage((e as Error).message);
    }
  }, []);

  useEffect(() => {
    refreshStatus();
    refreshPhotos();
    const t = setInterval(refreshStatus, 2000);
    return () => clearInterval(t);
  }, [refreshStatus, refreshPhotos]);

  const run = async (fn: () => Promise<unknown>) => {
    try {
      setMessage(null);
      await fn();
    } catch (e) {
      setMessage((e as Error).message);
    }
  };

  const takePhoto = () =>
    run(async () => {
      const photo = await api.takePhoto();
      setPhotos((ps) => [photo, ...ps]);
      setToast("Foto gespeichert");
    });

  const error = message ?? status?.error ?? null;
  const connected = !!status?.connected;

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.default" }}>
      <TopBar status={status} />

      <Container maxWidth="lg" sx={{ py: 3 }}>
        <Grid container spacing={3}>
          <Grid size={{ xs: 12, md: 7 }}>
            <Stack spacing={3}>
              <Card>
                <LiveView connected={connected} rotation={rotation} />
                <CardActions sx={{ px: 2, py: 1.5, gap: 1, flexWrap: "wrap" }}>
                  <Button variant="contained" size="large" startIcon={<PhotoCameraIcon />} disabled={!connected} onClick={takePhoto}>
                    Foto aufnehmen
                  </Button>
                  {status?.capabilities.led && (
                    <Button
                      variant={status.led ? "contained" : "outlined"}
                      color={status.led ? "warning" : "inherit"}
                      startIcon={status.led ? <FlashlightOnIcon /> : <FlashlightOffIcon />}
                      disabled={!connected}
                      aria-pressed={!!status.led}
                      onClick={() => run(async () => setStatus(await api.setLed(status.led ? 0 : 100)))}
                    >
                      LED {status.led ? "an" : "aus"}
                    </Button>
                  )}
                  <Box sx={{ flexGrow: 1 }} />
                  <Tooltip title="Neu verbinden">
                    <IconButton aria-label="Neu verbinden" onClick={() => run(async () => setStatus(await api.reconnect()))}>
                      <RefreshIcon />
                    </IconButton>
                  </Tooltip>
                </CardActions>
                {error && (
                  <Alert severity="error" sx={{ mx: 2, mb: 2 }} onClose={message ? () => setMessage(null) : undefined}>
                    {error}
                  </Alert>
                )}
              </Card>

              {status && Object.keys(status.details).length > 0 && <DeviceCard details={status.details} />}
            </Stack>
          </Grid>

          <Grid size={{ xs: 12, md: 5 }}>
            <Stack spacing={3}>
              {sensorsActive && <SensorPanel reading={reading} rate={rate} settings={stabilize} onChange={setStabilize} />}
              <PhotosCard
                photos={photos}
                onDelete={(name) =>
                  run(async () => {
                    await api.deletePhoto(name);
                    setPhotos((ps) => ps.filter((x) => x.name !== name));
                  })
                }
              />
            </Stack>
          </Grid>
        </Grid>
      </Container>

      <Snackbar
        open={!!toast}
        autoHideDuration={2500}
        onClose={() => setToast(null)}
        message={toast}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      />
    </Box>
  );
}

function TopBar({ status }: { status: CameraStatus | null }) {
  return (
    <AppBar position="sticky" color="inherit" elevation={0} sx={{ borderBottom: 1, borderColor: "divider" }}>
      <Toolbar sx={{ gap: 2, flexWrap: "wrap", py: 1 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexGrow: 1 }}>
          <VideocamIcon color="primary" />
          <Typography variant="h6" component="h1">
            Soulear lokal
          </Typography>
        </Stack>
        {!status ? (
          <Chip color="error" icon={<LinkOffIcon />} label="Server nicht erreichbar" />
        ) : (
          <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", rowGap: 1 }}>
            <Chip
              color={status.connected ? "success" : "error"}
              variant="outlined"
              icon={status.connected ? <LinkIcon /> : <LinkOffIcon />}
              label={status.connected ? "verbunden" : "getrennt"}
            />
            {status.connected && <Chip variant="outlined" icon={<SpeedIcon />} label={`${status.fps} fps`} />}
            {status.capabilities.battery && status.battery !== null && (
              <Chip
                variant="outlined"
                color={status.battery < 15 ? "warning" : "default"}
                icon={batteryIcon(status.battery, status.details.Laden === "ja")}
                label={`${status.battery} %`}
              />
            )}
            <Chip variant="outlined" size="small" label={status.driver} sx={{ alignSelf: "center" }} />
          </Stack>
        )}
      </Toolbar>
    </AppBar>
  );
}

function batteryIcon(level: number, charging: boolean): ReactElement {
  if (charging) return <BatteryChargingFullIcon />;
  if (level >= 95) return <BatteryFullIcon />;
  if (level < 10) return <BatteryAlertIcon />;
  const bars = [Battery0BarIcon, Battery1BarIcon, Battery2BarIcon, Battery3BarIcon, Battery4BarIcon, Battery5BarIcon, Battery6BarIcon];
  const Icon = bars[Math.min(6, Math.floor(level / (100 / 7)))]!;
  return <Icon />;
}

/**
 * MJPEG-Stream im <img>; bei Abbruch nach kurzer Pause neu verbinden.
 * Mit `rotation` (Stabilisierung) wird das Bild rund zugeschnitten und gedreht.
 */
function LiveView({ connected, rotation }: { connected: boolean; rotation: number | null }) {
  const [nonce, setNonce] = useState(() => Date.now());
  const retry = useRef<number | undefined>(undefined);
  const round = rotation !== null;

  useEffect(() => {
    if (connected) setNonce(Date.now());
  }, [connected]);
  useEffect(() => () => window.clearTimeout(retry.current), []);

  return (
    <Box sx={{ bgcolor: "#000", display: "grid", placeItems: "center", p: round ? 2 : 0 }}>
      <Box
        sx={{
          width: "100%",
          aspectRatio: round ? "1" : "4 / 3",
          maxWidth: round ? "min(100%, 70vh)" : "none",
          borderRadius: round ? "50%" : 0,
          overflow: "hidden",
          display: "grid",
          placeItems: "center",
        }}
      >
        {connected ? (
          <Box
            component="img"
            src={api.streamUrl(nonce)}
            alt="Livebild"
            onError={() => {
              window.clearTimeout(retry.current);
              retry.current = window.setTimeout(() => setNonce(Date.now()), 2000);
            }}
            sx={{
              width: "100%",
              height: "100%",
              objectFit: round ? "cover" : "contain",
              transform: round ? `rotate(${rotation}deg)` : "none",
              transition: "transform 120ms linear",
            }}
          />
        ) : (
          <Stack spacing={1} sx={{ alignItems: "center", color: "grey.500" }}>
            <VideocamOffIcon fontSize="large" />
            <Typography variant="body2">Kein Livebild</Typography>
          </Stack>
        )}
      </Box>
    </Box>
  );
}

function DeviceCard({ details }: { details: Record<string, string> }) {
  return (
    <Card>
      <CardHeader avatar={<MemoryIcon color="primary" />} title="Gerät" slotProps={{ title: { variant: "subtitle1", fontWeight: 650 } }} />
      <CardContent sx={{ pt: 0 }}>
        <Grid container spacing={2}>
          {Object.entries(details).map(([k, v]) => (
            <Grid key={k} size={{ xs: 6, sm: 4 }}>
              <Typography variant="caption" color="text.secondary" component="div">
                {k}
              </Typography>
              <Typography variant="body2" sx={{ overflowWrap: "anywhere" }}>
                {v}
              </Typography>
            </Grid>
          ))}
        </Grid>
      </CardContent>
    </Card>
  );
}

function PhotosCard({ photos, onDelete }: { photos: Photo[]; onDelete: (name: string) => void }) {
  return (
    <Card>
      <CardHeader
        avatar={<PhotoLibraryOutlinedIcon color="primary" />}
        title={`Fotos (${photos.length})`}
        slotProps={{ title: { variant: "subtitle1", fontWeight: 650 } }}
      />
      <CardContent sx={{ pt: 0 }}>
        {photos.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            Noch keine Fotos. Mit „Foto aufnehmen“ wird das aktuelle Bild gespeichert.
          </Typography>
        ) : (
          <ImageList cols={2} gap={8} sx={{ m: 0 }}>
            {photos.map((p) => (
              <ImageListItem key={p.name} sx={{ borderRadius: 2, overflow: "hidden" }}>
                <a href={api.photoUrl(p.name)} target="_blank" rel="noreferrer">
                  <img
                    src={api.photoUrl(p.name)}
                    alt={p.name}
                    loading="lazy"
                    style={{ width: "100%", aspectRatio: "4 / 3", objectFit: "cover", display: "block" }}
                  />
                </a>
                <ImageListItemBar
                  title={new Date(p.createdAt).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "medium" })}
                  actionIcon={
                    <Stack direction="row">
                      <Tooltip title="Herunterladen">
                        <IconButton
                          component="a"
                          href={api.photoUrl(p.name)}
                          download={p.name}
                          size="small"
                          sx={{ color: "white" }}
                          aria-label="Herunterladen"
                        >
                          <DownloadIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Löschen">
                        <IconButton size="small" sx={{ color: "white" }} aria-label="Löschen" onClick={() => onDelete(p.name)}>
                          <DeleteOutlinedIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </Stack>
                  }
                  sx={{ "& .MuiImageListItemBar-title": { fontSize: "0.75rem" } }}
                />
              </ImageListItem>
            ))}
          </ImageList>
        )}
      </CardContent>
    </Card>
  );
}
