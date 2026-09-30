import { useEffect, useRef, useState } from "react";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import VideocamOffIcon from "@mui/icons-material/VideocamOff";
import { api } from "../api";

/**
 * Livebild (MJPEG im <img>), füllt den verfügbaren Platz. Bei Abbruch nach
 * kurzer Pause neu verbinden. Mit `rotation` (Stabilisierung) wird das Bild
 * rund zugeschnitten und gedreht – der Kreis ist so groß wie die kürzere
 * Seite der Fläche (Container-Query-Einheit `cqmin`).
 */
export function LiveView({ connected, rotation }: { connected: boolean; rotation: number | null }) {
  const [nonce, setNonce] = useState(() => Date.now());
  const retry = useRef<number | undefined>(undefined);
  const round = rotation !== null;

  useEffect(() => {
    if (connected) setNonce(Date.now());
  }, [connected]);
  useEffect(() => () => window.clearTimeout(retry.current), []);

  const img = connected && (
    <Box
      component="img"
      src={api.streamUrl(nonce)}
      alt="Livebild"
      onError={() => {
        window.clearTimeout(retry.current);
        retry.current = window.setTimeout(() => setNonce(Date.now()), 2000);
      }}
      sx={{
        display: "block",
        width: "100%",
        height: "100%",
        objectFit: round ? "cover" : "contain",
        transform: round ? `rotate(${rotation}deg)` : "none",
        transition: "transform 120ms linear",
      }}
    />
  );

  return (
    <Box
      sx={{
        position: "relative",
        bgcolor: "#000",
        containerType: "size",
        // Desktop: füllt die Höhe der Spalte. Mobil: feste Proportion, max. 60 % der Bildschirmhöhe.
        flex: { md: 1 },
        minHeight: { md: 0 },
        width: "100%",
        aspectRatio: { xs: round ? "1" : "4 / 3", md: "auto" },
        maxHeight: { xs: "60dvh", md: "none" },
        overflow: "hidden",
      }}
    >
      {/* absolut positioniert: die Bildgröße darf die Fläche nicht aufspannen */}
      <Box sx={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>
        {!connected ? (
          <Stack spacing={1} sx={{ alignItems: "center", color: "grey.500" }}>
            <VideocamOffIcon fontSize="large" />
            <Typography variant="body2">Kein Livebild</Typography>
          </Stack>
        ) : round ? (
          <Box sx={{ width: "calc(100cqmin - 16px)", height: "calc(100cqmin - 16px)", borderRadius: "50%", overflow: "hidden" }}>
            {img}
          </Box>
        ) : (
          <Box sx={{ position: "absolute", inset: 0 }}>{img}</Box>
        )}
      </Box>
    </Box>
  );
}
