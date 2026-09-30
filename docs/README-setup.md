# Setup: Soulear analysieren (Schritt für Schritt)

Ziel: verstehen, wie die Soulear-App mit der Ohrkamera und mit der Cloud
spricht. Anders als bei einer reinen Backend-App gibt es hier **zwei**
Verkehrswege, die unterschiedlich mitgeschnitten werden müssen – siehe
[README-statische-analyse.md](README-statische-analyse.md).

> Für die **Nutzung** der Kamera ist nichts davon nötig – das Protokoll ist
> bekannt und die eigene App ([../app/README.md](../app/README.md)) läuft
> direkt. Dieses Setup braucht man nur, um weitere Funktionen zu erforschen
> (z. B. Kameratasten) oder die Cloud-Aufrufe der Original-App zu prüfen.

## Warum dieser Weg

- **Die Kamera spannt ein eigenes WLAN auf**, mit dem sich das Handy verbindet.
  Ein Emulator kann diesem WLAN nicht beitreten → für den Kamera-Verkehr
  braucht es ein **echtes Android-Gerät** (oder den Mac direkt im Kamera-WLAN).
- **Kamera-Kommandos und Video laufen über native Sockets** (`libWifiCamera.so`).
  Die ignorieren den Android-Proxy → mitmproxy sieht davon nichts. Stattdessen
  **Paketmitschnitt** (PCAPdroid / tcpdump / Wireshark). Das Protokoll ist
  unverschlüsseltes UDP, also direkt lesbar.
- **Cloud-Verkehr** (`*.simicloud.com`) läuft über Java/OkHttp und respektiert
  den Proxy → wie gewohnt mit **mitmproxy**. Da das Manifest keine
  `networkSecurityConfig` hat, wird nur System-CAs vertraut → CA als
  System-Cert (gerootetes Gerät/Emulator, `tools/install-ca.sh`).

## Voraussetzungen (macOS)

```bash
brew install jadx apktool mitmproxy
brew install --cask wireshark            # optional, zum Auswerten der .pcap
export ANDROID_HOME=$HOME/Library/Android/sdk
export PATH=$PATH:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator
```

Dazu: die Soulear-Kamera und ein Android-Handy (USB-Debugging an).

## 1. APK entpacken und dekompilieren

Die App ist **nicht** Teil dieses Repositorys (urheberrechtlich geschützt). Die
`.xapk` selbst besorgen – z. B. von einem APK-Mirror wie APKPure oder Softonic
– und nach `apk/` legen (der Ordner ist per `.gitignore` ausgeschlossen, bitte
nicht weitergeben). Eine `.xapk` ist ein ZIP mit Basis-APK, Split-APKs
(`config.*`) und `manifest.json`.

```bash
bash tools/decompile.sh
```

Ergebnis unter `apk/soulear/`: Splits, `jadx-out/` (Java), `apktool-out/`
(Manifest/Ressourcen/smali), `native/lib/arm64-v8a/*.so`.

**Echtheit prüfen** (nach dem Entpacken) – Mirrors können veränderte Apps
ausliefern. Die Signatur muss gültig sein und bei allen Splits dasselbe
Zertifikat zeigen:

```bash
APKSIGNER="$(ls -d ~/Library/Android/sdk/build-tools/*/ | tail -1)apksigner"
for a in apk/soulear/*.apk; do "$APKSIGNER" verify --print-certs "$a" | grep SHA-256; done
```

Für Soulear 1.0.120 (Download über Softonic) ergab das:
- Signatur gültig, bei allen vier APKs dasselbe Zertifikat:
  SHA-256 `9b67d3b086fe51ae7ec6f43137dc366aabbdaa10c1232239d143e1602bf92046`,
  DN `CN=Android, O=Google Inc.` (typisch für Play App Signing).
- Zusätzlich ein gültiger **Source Stamp** – den setzt Google Play beim
  Ausliefern, er deckt den APK-Inhalt mit ab. Stempel-Zertifikat SHA-256
  `3257d599a49d2c961a471ca9843f59d341a405884583fc087df4237b733bbd6d`
  (nach bekanntem Stand das von Google Play).

→ Die APK stammt sehr wahrscheinlich unverändert aus dem Play Store. Letzte
Gewissheit: Zertifikat mit der aus dem Play Store installierten App vergleichen
(`adb shell pm path com.i4season.bkCamera_soulear`, `adb pull …/base.apk`,
dann `apksigner verify --print-certs`).

Native Libs untersuchen: `strings -n 5 apk/soulear/native/lib/arm64-v8a/libWifiCamera.so`,
für mehr Tiefe Ghidra.

## 2. App installieren

Alle APKs **gemeinsam** installieren (Splits gehören zusammen):

```bash
adb install-multiple apk/soulear/*.apk
adb shell am start -n com.i4season.bkCamera_soulear/com.i4season.bkCamera.uirelated.functionpage.initpage.InitPageActivity
```

Die App fordert Standort- (nötig für WLAN-SSID-Erkennung), Kamera-, Speicher-
und Bluetooth-Berechtigungen an.

## 3. Kamera-Verkehr mitschneiden (echtes Gerät)

**Variante A – PCAPdroid (kein Root nötig, empfohlen):**
1. [PCAPdroid](https://play.google.com/store/apps/details?id=com.emanuelef.remote_capture)
   aufs Handy, als Ziel-App *Soulear* wählen, Ausgabe „PCAP-Datei“.
2. Handy mit dem Kamera-WLAN verbinden, Mitschnitt starten, Soulear öffnen,
   Livebild, Foto, Video, Einstellungen, Album durchklicken.
3. `.pcap` auf den Mac holen und in Wireshark öffnen
   (Filter: `http.request` bzw. `udp && ip.addr==<Kamera-IP>`).

Tipp: Vorher den **versteckten Debug-Log** der App einschalten (Seitenmenü →
10× aufs App-Icon tippen → Schalter, App neu starten). Die native Lib schreibt
dann Ziel-IP und Ports nach `AWIFISDKLOG/` im externen Speicher.

Auswertung der `.pcap`: mit dem Werkzeug in `app/`
(`npm run pcap -- summary|dump|hosts|extract-jpeg`, siehe
[../app/README.md](../app/README.md)).

**Variante B – Mac direkt ins Kamera-WLAN:** Mac mit dem Kamera-WLAN
verbinden (Kamera-IP: `route -n get default`, meist `192.168.1.1`) und mit
Wireshark mitschneiden, während die eigene App (`app/`) läuft. Zeigt nur den
Verkehr der eigenen App, nicht den der Original-App.

**Variante C – gerootetes Gerät:** `tcpdump` auf dem Handy
(`adb shell su -c 'tcpdump -i wlan0 -w /sdcard/cam.pcap'`).

## 4. Cloud-Verkehr mitschneiden (mitmproxy)

Geht mit dem gerooteten Emulator (API 33, arm64-v8a, „Google APIs ATD“ – nicht
„Google Play“, dort ist Root gesperrt) oder einem gerooteten Handy:

```bash
mitmweb --listen-port 8083                 # UI: http://127.0.0.1:8081
bash tools/install-ca.sh                   # CA als System-Cert (tmpfs, bis Reboot)
adb shell settings put global http_proxy 10.0.2.2:8083   # Emulator; echtes Gerät: <Mac-IP>:8083
adb shell am force-stop com.i4season.bkCamera_soulear
adb shell am start -n com.i4season.bkCamera_soulear/com.i4season.bkCamera.uirelated.functionpage.initpage.InitPageActivity
```

In mitmweb nach `simicloud` filtern. Interessant: Feedback-Seite, Lizenz-Report
(wird vermutlich erst nach Verbindung mit einer Kamera ausgelöst), Update-Check.
Achtung: Der Lizenz-Report erzwingt Mobilfunk und läuft dann evtl. am Proxy
vorbei – zusätzlich PCAPdroid mitlaufen lassen (`npm run pcap -- hosts`).

Hinweis: Hängt das Handy im Kamera-WLAN, hat es meist kein Internet – die
Cloud-Aufrufe passieren dann erst nach dem Zurückwechseln ins normale WLAN.

Proxy wieder entfernen: `adb shell settings put global http_proxy :0`

## Troubleshooting

| Symptom | Ursache / Fix |
|---|---|
| Schwarzer Bildschirm im ATD-Emulator | Kein Launcher – normal, App per `adb` starten. |
| In mitmweb nichts von der Kamera | Erwartet: native Sockets ignorieren den Proxy → Schritt 3. |
| Cloud-Requests scheitern mit TLS-Fehler | CA nicht im System-Store (nach Reboot weg) → `install-ca.sh` erneut. |
| App findet die Kamera nicht | Standort-Berechtigung + GPS an (SSID-Erkennung), Handy im Kamera-WLAN, mobile Daten ggf. aus. |

```bash
adb shell pidof com.i4season.bkCamera_soulear
adb logcat --pid=$(adb shell pidof com.i4season.bkCamera_soulear)
```

Die nativen Libs schreiben zusätzlich eigene Logs, z. B.
`/sdcard/AWIFISDKLOG/*.txt` (WLAN-Kamera) und `/sdcard/TOOLSDKLOG/*.txt` –
werden per `WifiCamera.openLog(...)` eingeschaltet; ein Blick lohnt sich.
