import { createTheme } from "@mui/material/styles";

/** Hell/Dunkel folgt dem System (`prefers-color-scheme`). */
export const theme = createTheme({
  cssVariables: { colorSchemeSelector: "media" },
  colorSchemes: {
    light: {
      palette: {
        primary: { main: "#c2410c" },
        background: { default: "#f5f4f1", paper: "#ffffff" },
      },
    },
    dark: {
      palette: {
        primary: { main: "#fb923c" },
        background: { default: "#121110", paper: "#1c1b19" },
      },
    },
  },
  shape: { borderRadius: 12 },
  typography: {
    fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    h6: { fontWeight: 650 },
    button: { textTransform: "none", fontWeight: 600 },
  },
  components: {
    MuiCard: { defaultProps: { variant: "outlined" } },
  },
});
