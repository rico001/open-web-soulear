import { useCallback, useEffect, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Snackbar from "@mui/material/Snackbar";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import ExploreOutlinedIcon from "@mui/icons-material/ExploreOutlined";
import MemoryIcon from "@mui/icons-material/Memory";
import PhotoLibraryOutlinedIcon from "@mui/icons-material/PhotoLibraryOutlined";
import { api, type CameraStatus, type Photo } from "./api";
import { Controls } from "./components/Controls";
import { DevicePanel } from "./components/DevicePanel";
import { LiveView } from "./components/LiveView";
import { PhotosPanel } from "./components/PhotosPanel";
import { SensorPanel } from "./components/SensorPanel";
import { TopBar } from "./components/TopBar";
import { useRotation, useSensors, useStabilizeSettings, useStoredState } from "./hooks";

type TabId = "sensors" | "photos" | "device";

/**
 * Layout: Desktop (ab md) nutzt genau die Fensterhöhe – links das Livebild,
 * das den freien Platz füllt, rechts eine Seitenleiste mit Tabs, die bei
 * Bedarf in sich scrollt. Mobil steht alles untereinander.
 */
export function App() {
  const [status, setStatus] = useState<CameraStatus | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [tab, setTab] = useStoredState<TabId>("soulear.tab", "sensors");
  const [stabilize, setStabilize] = useStabilizeSettings();

  const connected = !!status?.connected;
  const sensorsActive = connected && !!status?.capabilities.sensors;
  const { reading, rate } = useSensors(sensorsActive);
  const rotation = useRotation(reading, stabilize);
  const activeTab: TabId = tab === "sensors" && !sensorsActive ? "photos" : tab;

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await api.status());
    } catch {
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    refreshStatus();
    api.photos().then(setPhotos, (e: Error) => setMessage(e.message));
    const t = setInterval(refreshStatus, 2000);
    return () => clearInterval(t);
  }, [refreshStatus]);

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

  const deletePhoto = (name: string) =>
    run(async () => {
      await api.deletePhoto(name);
      setPhotos((ps) => ps.filter((x) => x.name !== name));
    });

  const error = message ?? status?.error ?? null;

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        height: { md: "100dvh" },
        minHeight: "100dvh",
        bgcolor: "background.default",
      }}
    >
      <TopBar status={status} />

      <Box
        component="main"
        sx={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: { xs: "column", md: "row" },
          gap: { xs: 1.5, md: 2 },
          p: { xs: 1.5, md: 2 },
        }}
      >
        {/* Livebild + Bedienung */}
        <Paper
          variant="outlined"
          sx={{ flex: { md: 1 }, minWidth: 0, minHeight: { md: 0 }, display: "flex", flexDirection: "column", overflow: "hidden" }}
        >
          <LiveView connected={connected} rotation={rotation} />
          {error && (
            <Alert severity="error" square sx={{ borderRadius: 0 }} onClose={message ? () => setMessage(null) : undefined}>
              {error}
            </Alert>
          )}
          <Controls
            connected={connected}
            led={status?.capabilities.led ? (status.led ?? 0) : null}
            stabilize={reading?.available ? stabilize.enabled : null}
            onPhoto={takePhoto}
            onToggleLed={() => run(async () => setStatus(await api.setLed(status?.led ? 0 : 100)))}
            onToggleStabilize={() => setStabilize({ ...stabilize, enabled: !stabilize.enabled })}
            onReconnect={() => run(async () => setStatus(await api.reconnect()))}
          />
        </Paper>

        {/* Seitenleiste */}
        <Paper
          variant="outlined"
          sx={{
            width: { md: 380, lg: 440 },
            flexShrink: 0,
            display: "flex",
            flexDirection: "column",
            minHeight: { md: 0 },
            overflow: "hidden",
          }}
        >
          <Tabs
            value={activeTab}
            onChange={(_, v: TabId) => setTab(v)}
            variant="fullWidth"
            sx={{
              borderBottom: 1,
              borderColor: "divider",
              minHeight: 48,
              "& .MuiTab-root": { minWidth: 0, px: { xs: 1, sm: 2 }, whiteSpace: "nowrap" },
            }}
          >
            {sensorsActive && <Tab value="sensors" icon={<ExploreOutlinedIcon />} iconPosition="start" label="Lage" sx={{ minHeight: 48 }} />}
            <Tab value="photos" icon={<PhotoLibraryOutlinedIcon />} iconPosition="start" label={`Fotos (${photos.length})`} sx={{ minHeight: 48 }} />
            <Tab value="device" icon={<MemoryIcon />} iconPosition="start" label="Gerät" sx={{ minHeight: 48 }} />
          </Tabs>
          <Box sx={{ flex: 1, minHeight: 0, overflowY: { md: "auto" }, p: 2 }}>
            {activeTab === "sensors" && <SensorPanel reading={reading} rate={rate} settings={stabilize} onChange={setStabilize} />}
            {activeTab === "photos" && <PhotosPanel photos={photos} onDelete={deletePhoto} />}
            {activeTab === "device" && <DevicePanel details={status?.details ?? {}} />}
          </Box>
        </Paper>
      </Box>

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
