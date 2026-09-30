# Soulear App-Analyse

Reverse-Engineering der Android-App **Soulear** (`com.i4season.bkCamera_soulear`,
v1.0.120, Hersteller i4season / simicloud) – Begleit-App zu einer
WLAN-/USB-Ohrkamera (Otoskop mit Ohrreiniger). Ziel: verstehen, wie die App mit
der Kamera und mit dem Hersteller-Backend spricht – und sie durch eine eigene,
cloudfreie Web-App ersetzen. Analyse der öffentlich verfügbaren App mit
**eigener** Hardware, zu Lern- und Interoperabilitätszwecken.

## Motivation

WLAN-Ohrkameras kosten um die 20 €, haben eine winzige Optik mit kurzem
Fokusabstand, eigene LED-Beleuchtung und einen Akku – damit taugen sie
erstaunlich gut als **Makro- bzw. Inspektionskamera für die Elektronik**:
Platinen, Lötstellen, SMD-Bauteile, Leiterbahnen oder Beschriftungen
winziger Chips aus nächster Nähe prüfen.

Die Hersteller-App ist dafür unpraktisch: Sie läuft nur auf dem Handy, zeigt
das Bild klein und kreisförmig beschnitten, will Standort- und
Bluetooth-Rechte und kann das Gerät laut Code an einen Server des Herstellers
melden.
Gewünscht war stattdessen:

- **Großes Livebild am Rechner** im Browser, während beide Hände an Lötkolben
  und Platine sind
- **Fotos per Klick** direkt auf dem Rechner – zum Dokumentieren von
  Lötstellen oder zum Vergleichen vorher/nachher
- **LED an/aus** gegen Reflexionen auf glänzendem Lötzinn
- **Bildstabilisierung per Lagesensor** (abschaltbar), damit das Bild beim
  Drehen der Kamera aufrecht bleibt
- **Ohne Cloud, ohne Konto, ohne Handy**

Daraus entstand die Frage, wie die Hersteller-App mit der Kamera spricht –
und am Ende eine eigene App, die mit der echten Kamera läuft.

## Analyse der Hersteller-App (Kurzfassung)

- **Native Android-App** (Kotlin/Java, AndroidX, OkHttp).
  jadx liefert gut lesbaren Quelltext.
- Die eigentliche Kamera-Kommunikation steckt in **nativen Libs** (JNI):
  `libWifiCamera.so` (WLAN-Kamera), `libOtgCameraLibUSB.so` (USB-OTG-Kamera),
  `libUStorageDeviceFS.so`, `libI4Tool.so` (Lizenz/Krypto, OpenSSL).
- Zwei getrennte Verkehrswege:
  1. **App ↔ Kamera** im WLAN der Kamera (`192.168.1.1`): binäres, unverschlüsseltes
     **UDP**-Protokoll – Befehle an Port 10005, Videostart an 10006, das Bild
     kommt als JPEG-Stücke (mit Lagesensor-Werten) zurück. Läuft über native
     Sockets → ignoriert den Android-Proxy.
  2. **App ↔ Cloud** (`yun.simicloud.com`, `lic.simicloud.com`): Lizenz-Report,
     Feedback, Update-Check – inkl. einer Sperrmöglichkeit der Kamera durch den
     Hersteller. HTTPS über OkHttp/HttpURLConnection → per mitmproxy mitlesbar.

Details: [docs/README-statische-analyse.md](docs/README-statische-analyse.md).

## Ergebnis: die eigene App „Soulear lokal“

Aus der Analyse entstanden: eine eigene, cloudfreie Web-App für die Kamera.
Sie spricht das analysierte Protokoll direkt, läuft auf einem Rechner im
WLAN der Kamera (Mac, Linux, Raspberry Pi) und wird im Browser bedient.
Details: [app/README.md](app/README.md).

![Soulear lokal mit der echten Kamera: stabilisiertes Livebild einer Beschriftung, daneben der Tab Lage mit Drehung, Neigung und Sensor-Rohwerten](docs/screenshot.png)

```
Kamera ──UDP──▶ Backend (Node.js/TypeScript) ──HTTP──▶ Frontend (React + MUI) im Browser
```

**Backend** ([app/server](app/server/src)) – Node.js, TypeScript, Fastify
- Kameratreiber für das UDP-Protokoll: Geräteinfo, Videostart, Bild-Chunks zu
  JPEGs zusammensetzen, LED setzen/lesen, Akku, Lagesensor; erholt sich selbst
  nach Verbindungsabbrüchen
- Livebild als MJPEG-Stream, Sensorwerte als Server-Sent Events, REST-API für
  Status, LED und Fotos; Fotos landen lokal auf dem Rechner
- Austauschbare Treiber: `soulear` (echte Kamera), `mock` (künstliches Bild zum
  Entwickeln), `replay` (Bilder aus einem Mitschnitt)
- Werkzeuge: simulierte Kamera zum Testen ohne Hardware, pcap-Analyse für
  Mitschnitte

**Frontend** ([app/web](app/web/src)) – React, TypeScript, MUI, Vite
- Livebild füllt am Desktop die ganze Fensterhöhe; Bedienleiste mit Foto,
  LED an/aus und Stabilisieren direkt darunter
- Seitenleiste mit Tabs: Lage, Fotos (Galerie mit Download/Löschen), Gerät –
  kein Scrollen der Seite nötig; am Handy alles untereinander mit großen Knöpfen
- Statusleiste: Verbindung, Bildrate, Akku (inkl. Ladezustand)
- Lage & Sensoren: Drehung/Neigung mit Lageanzeige, Rohwerte, abschaltbare
  Bildstabilisierung (Richtung und Versatz einstellbar)
- Geräteinfo (Hersteller, Modell, Firmware, Auflösung), Hell-/Dunkelmodus nach
  System, auch am Handy-Browser nutzbar

**Starten** (Node.js ≥ 22, Rechner mit dem Kamera-WLAN verbunden):

```bash
cd app
npm install
npm run dev                # http://localhost:5173
DRIVER=mock npm run dev    # ohne Kamera ausprobieren
```

## Getestete Hardware

| Gerät | Kennung laut Kamera | Ergebnis |
|---|---|---|
| [Hopefox Ohrenreiniger „1080P HD WiFi“ mit Kamera und 6 LEDs, schwarz](https://www.amazon.de/dp/B0CVX5CJPW) (App: Soulear) | Hersteller `YPC`, Modell `BK7231U-XRH-FBPRO`, Firmware `HKV41B` | funktioniert: Livebild, Fotos, LED an/aus, Akku, Lagesensor |

Trotz „1080P“ in der Produktbeschreibung liefert die Kamera im WLAN-Stream
640×480 Pixel (~17 fps). Andere Geräte, die mit der Soulear- oder Suear-App
laufen, nutzen oft dieselbe Technik und könnten ebenfalls funktionieren –
Erfahrungsberichte willkommen.

## Dokumente

| Dokument | Inhalt |
|----------|--------|
| **[docs/README-setup.md](docs/README-setup.md)** | Setup: APK entpacken/dekompilieren, Installation, Mitschnitt von Kamera- und Cloud-Verkehr. |
| **[docs/README-statische-analyse.md](docs/README-statische-analyse.md)** | Erkenntnisse aus dem dekompilierten Code: Architektur, Kameraprotokoll, Cloud-Aufrufe, offene Fragen. |
| **[app/README.md](app/README.md)** | Eigene Web-App (Node/TS-Backend + React/MUI) als Ersatz für die Hersteller-App: Bedienung, Protokoll, Tests ohne Hardware, pcap-Werkzeug. |
| **[tools/README.md](tools/README.md)** | Anleitung zu den Skripten. |

## Schnellstart

```bash
cd app && npm install && npm run dev     # eigene App, siehe oben

bash tools/decompile.sh                  # Analyse: XAPK entpacken + jadx/apktool -> apk/soulear/
```

## Ordnerstruktur

```
android-app-analyse/
├── README.md                          – dieses Dokument
├── LICENSE                            – GPL-2.0
├── docs/
│   ├── README-setup.md                – Analyse-Setup (Dekompilieren, Gerät, Mitschnitt)
│   ├── README-statische-analyse.md    – Erkenntnisse aus dem Code
│   └── screenshot.png                 – Screenshot der App
├── app/                               – eigene Web-App (server/ + web/), siehe app/README.md
├── tools/
│   ├── README.md                      – Anleitung zu den Skripten
│   ├── decompile.sh                   – XAPK entpacken, jadx + apktool
│   └── install-ca.sh                  – mitmproxy-CA als System-Cert (Emulator/Root)
└── apk/                               – nicht versioniert
    ├── com.i4season.bkCamera_soulear_1.0.120.xapk
    └── soulear/                       – Splits, jadx-out/, apktool-out/, native/
```

## Hinweise

- **Inoffiziell.** Dieses Projekt steht in keiner Verbindung zu i4season,
  simicloud, YPC, Hopefox oder den Anbietern von Soulear-/Suear-Geräten und wird von
  ihnen weder unterstützt noch geprüft. Marken- und Produktnamen gehören ihren
  jeweiligen Inhabern und dienen nur der Beschreibung der Kompatibilität.
- **Kein Medizinprodukt.** Die App zeigt lediglich das Kamerabild an. Sie ist
  nicht für Diagnose oder Behandlung gedacht und ersetzt keine ärztliche
  Untersuchung. Nutzung auf eigenes Risiko.
- **Zweck.** Analyse ausschließlich mit eigener Hardware, zur Interoperabilität
  (§ 69e UrhG / Art. 6 Richtlinie 2009/24/EG). Keine Angriffe auf die
  Infrastruktur des Herstellers, keine Nutzung fremder Geräte.
- **Nicht enthalten.** Die APK, dekompilierter Code und die nativen
  Bibliotheken des Herstellers sind urheberrechtlich geschützt und **nicht**
  Teil dieses Repositorys (`apk/` ist per `.gitignore` ausgeschlossen). Wer die
  Analyse nachvollziehen will, lädt die App selbst herunter
  ([docs/README-setup.md](docs/README-setup.md)).
- **Befunde zur Hersteller-App** beruhen auf statischer Analyse von Version
  1.0.120 und sind, wo nicht anders angegeben, nicht durch Mitschnitte belegt.

## Lizenz

[GPL-2.0](LICENSE). Das Kameraprotokoll stützt sich wesentlich auf Sean Pesces
[Suear-Web-Viewer](https://github.com/SeanPesce/Suear-Web-Viewer) (GPL-2.0);
der Code hier ist eine eigene Umsetzung in TypeScript.
