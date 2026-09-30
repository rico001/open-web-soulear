import type { ReactElement } from "react";
import AppBar from "@mui/material/AppBar";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Toolbar from "@mui/material/Toolbar";
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
import LinkIcon from "@mui/icons-material/Link";
import LinkOffIcon from "@mui/icons-material/LinkOff";
import SpeedIcon from "@mui/icons-material/Speed";
import VideocamIcon from "@mui/icons-material/Videocam";
import type { CameraStatus } from "../api";

export function TopBar({ status }: { status: CameraStatus | null }) {
  return (
    <AppBar position="static" color="inherit" elevation={0} sx={{ borderBottom: 1, borderColor: "divider" }}>
      <Toolbar variant="dense" sx={{ gap: 1.5, minHeight: { xs: 52, md: 56 }, px: { xs: 1.5, md: 2 } }}>
        <VideocamIcon color="primary" />
        <Typography variant="h6" component="h1" noWrap sx={{ flexGrow: 1, fontSize: { xs: "1.05rem", md: "1.2rem" } }}>
          Soulear lokal
        </Typography>

        {!status ? (
          <Chip size="small" color="error" icon={<LinkOffIcon />} label="Server nicht erreichbar" />
        ) : (
          <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
            <Chip
              size="small"
              color={status.connected ? "success" : "error"}
              variant="outlined"
              icon={status.connected ? <LinkIcon /> : <LinkOffIcon />}
              label={status.connected ? "verbunden" : "getrennt"}
              sx={{ "& .MuiChip-label": { display: { xs: "none", sm: "block" } }, "& .MuiChip-icon": { mx: { xs: 0.75, sm: 0 } } }}
            />
            {status.connected && (
              <Chip
                size="small"
                variant="outlined"
                icon={<SpeedIcon />}
                label={`${status.fps} fps`}
                sx={{ display: { xs: "none", sm: "inline-flex" } }}
              />
            )}
            {status.capabilities.battery && status.battery !== null && (
              <Chip
                size="small"
                variant="outlined"
                color={status.battery < 15 ? "warning" : "default"}
                icon={batteryIcon(status.battery, status.details.Laden === "ja")}
                label={`${status.battery} %`}
              />
            )}
            <Chip size="small" variant="outlined" label={status.driver} sx={{ display: { xs: "none", md: "inline-flex" } }} />
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
