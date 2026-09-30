# tools/ – Anleitung

| Skript | Wofür | Braucht Gerät? |
|--------|-------|----------------|
| `decompile.sh` | XAPK entpacken, mit jadx + apktool dekompilieren, native Libs extrahieren | nein |
| `install-ca.sh` | mitmproxy-CA als System-Cert – nur für den **Cloud**-Mitschnitt | ja (gerootet) |

---

## decompile.sh

**Voraussetzungen:** `jadx`, `apktool`, `unzip` (`brew install jadx apktool`).

**Aufruf**
```bash
bash tools/decompile.sh                       # nimmt apk/com.i4season.bkCamera_soulear_1.0.120.xapk
bash tools/decompile.sh pfad/zu/andere.xapk   # z. B. neuere Version
```

**Ergebnis** unter `apk/soulear/`:
```
*.apk            – Basis + Splits (für adb install-multiple)
manifest.json    – XAPK-Metadaten (Version, Permissions, Splits)
apktool-out/     – AndroidManifest.xml, res/, smali/
jadx-out/        – Java-Quelltext (--deobf)
native/lib/arm64-v8a/ – libWifiCamera.so, libOtgCameraLibUSB.so, libUStorageDeviceFS.so, libI4Tool.so
```
Erneute Aufrufe überschreiben die Ausgabe. Bei einer anderen App-Version
Basis-APK-Namen (`BASE`) im Skript prüfen.

---

## install-ca.sh

Bringt die mitmproxy-CA als **System**-Zertifikat in den laufenden, gerooteten
Emulator (bzw. gerootetes Gerät) – per tmpfs-Overlay über
`/system/etc/security/cacerts`. Nur für den HTTPS-Verkehr zu `*.simicloud.com`
nötig; der Kamera-Verkehr ist unverschlüsselt und läuft am Proxy vorbei.

**Voraussetzungen**
- `adb root` gibt uid 0 (ATD-Image, API 33 – ab API 34 liegen die Certs im
  APEX-Modul, dann greift das Skript nicht)
- mitmproxy einmal gestartet (`~/.mitmproxy/mitmproxy-ca-cert.pem`)
- `adb` und `openssl` im PATH

**Aufruf**
```bash
bash tools/install-ca.sh
adb shell am force-stop com.i4season.bkCamera_soulear   # danach App neu starten
```

Das Overlay ist **flüchtig** – nach jedem Reboot erneut ausführen.
