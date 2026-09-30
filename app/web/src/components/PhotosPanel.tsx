import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import DeleteOutlinedIcon from "@mui/icons-material/DeleteOutlined";
import DownloadIcon from "@mui/icons-material/Download";
import PhotoLibraryOutlinedIcon from "@mui/icons-material/PhotoLibraryOutlined";
import { api, type Photo } from "../api";

export function PhotosPanel({ photos, onDelete }: { photos: Photo[]; onDelete: (name: string) => void }) {
  if (photos.length === 0) {
    return (
      <Stack spacing={1} sx={{ alignItems: "center", textAlign: "center", color: "text.secondary", py: 4 }}>
        <PhotoLibraryOutlinedIcon fontSize="large" />
        <Typography variant="body2">Noch keine Fotos. „Foto aufnehmen“ speichert das aktuelle Bild.</Typography>
      </Stack>
    );
  }
  return (
    <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 1 }}>
      {photos.map((p) => (
        <Box
          key={p.name}
          sx={{ position: "relative", borderRadius: 2, overflow: "hidden", bgcolor: "#000", aspectRatio: "4 / 3" }}
        >
          <a href={api.photoUrl(p.name)} target="_blank" rel="noreferrer" aria-label={`Foto ${p.name} öffnen`}>
            <img
              src={api.photoUrl(p.name)}
              alt=""
              loading="lazy"
              style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
            />
          </a>
          <Stack
            direction="row"
            sx={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              alignItems: "center",
              pl: 1,
              color: "#fff",
              background: "linear-gradient(transparent, rgba(0,0,0,0.75))",
            }}
          >
            <Typography variant="caption" noWrap sx={{ flex: 1, minWidth: 0 }}>
              {new Date(p.createdAt).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })}
            </Typography>
            <Tooltip title="Herunterladen">
              <IconButton component="a" href={api.photoUrl(p.name)} download={p.name} size="small" sx={{ color: "inherit" }} aria-label="Herunterladen">
                <DownloadIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="Löschen">
              <IconButton size="small" sx={{ color: "inherit" }} aria-label="Löschen" onClick={() => onDelete(p.name)}>
                <DeleteOutlinedIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Stack>
        </Box>
      ))}
    </Box>
  );
}
