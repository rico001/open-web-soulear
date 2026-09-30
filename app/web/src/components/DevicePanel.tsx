import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";

export function DevicePanel({ details }: { details: Record<string, string> }) {
  const entries = Object.entries(details);
  if (entries.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        Keine Geräteangaben – Kamera nicht verbunden.
      </Typography>
    );
  }
  return (
    <Box component="dl" sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 2, m: 0 }}>
      {entries.map(([k, v]) => (
        <div key={k}>
          <Typography component="dt" variant="caption" color="text.secondary">
            {k}
          </Typography>
          <Typography component="dd" variant="body2" sx={{ m: 0, overflowWrap: "anywhere" }}>
            {v}
          </Typography>
        </div>
      ))}
    </Box>
  );
}
