# Statische Analyse: Soulear 1.0.120

Erkenntnisse aus `bash tools/decompile.sh` (jadx + apktool), `strings` und
Disassemblierung (`llvm-objdump` aus dem NDK) der nativen Libs, ergänzt um
Tests mit der echten Kamera. Pfade relativ zu `apk/soulear/`.

## Eckdaten

| | |
|---|---|
| Paket | `com.i4season.bkCamera_soulear` (Code-Namespace `com.i4season.bkCamera`) |
| Version | 1.0.120 (versionCode 121), minSdk 24, targetSdk 36 |
| Application | `com.i4season.bkCamera.WDApplication` |
| Launcher | `com.i4season.bkCamera.uirelated.functionpage.initpage.InitPageActivity` |
| Framework | natives Android (Kotlin/Java), OkHttp 3, Glide, PictureSelector, BLE-Lib `cn.com.heaton.blelibrary` |
| Manifest | `usesCleartextTraffic="true"`, **keine** `networkSecurityConfig` → vertraut nur System-CAs |
| Splits | `base`, `config.arm64_v8a`, `config.en`, `config.mdpi` |

## Architektur

```
UI (uirelated/functionpage/…)          – Init, Home, CameraShow, Album, Setting, Feedback, Vip
  └─ logicrelated/camera/
       ├─ i4season/, i4season_new/     – WLAN-Kamera   -> com.jni.WifiCamera   -> libWifiCamera.so
       ├─ i4season_usb/                – USB-OTG-Kamera -> com.jni.OtgCameraApi -> libOtgCameraLibUSB.so
       ├─ i4seasonmfi/                 – (MFi/Accessory-Variante)
       └─ reportlic/                   – Lizenz-Report an die Cloud
  com.jni.UStorageDeviceModule         – libUStorageDeviceFS.so (Speicher/WebDAV, Port 10004)
  com.jni.I4Tool / LicCommand          – libI4Tool.so (Lizenz, OpenSSL)
```

Einstiegspunkte zum Lesen:
- `jadx-out/sources/com/jni/WifiCamera.java` – alle nativen Kamera-Funktionen
  (`caInit/caStart/caStop`, `cameraCmd`, `cameraParameterGet/Set`,
  `cameraLicInfoGet`, `cameraSetLic`, `cameraAcceptFileList`, `humidityGet`, …).
- `jadx-out/sources/com/i4season/bkCamera/logicrelated/camera/` – Java-Logik darum.
- `jadx-out/sources/com/i4season/bkCamera/uirelated/other/AppPathInfo.java`,
  `FunctionSwitch.java` – Konstanten (IPs, URLs, Feature-Schalter).

## Hosts / Endpunkte

### Kamera (lokal, im Kamera-WLAN)

`libWifiCamera.so` enthält **mehrere Kamerafamilien**. Welche genutzt wird,
entscheidet die App nach Gerätetyp (`WifiCallBack.DTYPE_*`). Soulear läuft
über `I4seasonCameraNew` → `com.jni.WifiCamera` (`caInit`/`caStart`, …) →
native Funktionen `caWifiInit`, `wificamera_search`, `newcamera_start` usw.

**Protokoll der Soulear-Familie (i4season „new“)** – öffentlich dokumentiert
von Sean Pesce ([Suear-Web-Viewer](https://github.com/SeanPesce/Suear-Web-Viewer)),
umgesetzt in [app/server/src/camera/suear-protocol.ts](../app/server/src/camera/suear-protocol.ts).
In der Soulear-Lib bestätigt (Disassemblierung):
- Header-Magic `0xffeeffee` (26 Stellen), Befehlsport **10005** (21×),
  Videoport **10006** (4×), Header-Byte `unk=1`.
- **LED** (Typ `0x0a`): Setzen (`LedStatusSet`) mit `[0x10|LED, an/aus, Helligkeit]`,
  Lesen (`LedStatusGet`) mit `[LED, 0, 0]` → Antwort `[?, an/aus, Helligkeit]`.
  Am Gerät wirkt nur an/aus, keine Dimmung.
- **OpenVideo** (Typ `0x04`) sendet – anders als bei Sean Pesce – eine Nutzlast:
  u16 (vermutlich eigener Empfangsport), optional u16, und außerhalb von
  `192.168.1.x` zusätzlich u32. Variante `0x16` (`openVideoForceApi`).
- Die Lib kennt Nachrichtentypen bis 30, mehr als bisher dokumentiert.

**Lagesensor:** Byte 6–11 jedes Bild-Chunks sind drei int16 (x/y/z) eines
Beschleunigungssensors (bei Sean Pesce „position“). `sensor_get_xyz` glättet
sie (10 Werte, ohne Min/Max); `newcamera_wait` berechnet daraus per `atanf`
Drehung (`atan(y/z)` mit Quadrantenkorrektur) und Neigung
(`atan(x/√(y²+z²))`). Die App dreht das Bild damit aufrecht
(`I4seasonCameraNew.acceptImageData`, beim Modell FBPRO `angle + 180°`).
Pro Bild liefert die Lib außerdem Tastenstatus (`picbutton`, `videobutton`,
`zoomup/down`, `frozen`, `mirror` in `WifiCameraPic`) – wo die im Paket
stehen, ist noch offen (Kandidaten: Header-Byte 0 und 5).

Ursprüngliche Hinweise aus Symbolen und Strings (vor dem Fund von Sean Pesces
Projekt – teils überholt: Befehle laufen über **feste** Ports 10005/10006,
Header **little-endian**; Suche/ACK betreffen offenbar andere Teile der Lib):
- **Binäres UDP** (`socket`/`bind`/`sendto`/`recvfrom`/`select`), kein HTTP.
- **Gerätesuche** (`wificamera_search`, `g_searchedip`, `needsearch`),
  vermutlich per Broadcast. IP-Kandidaten in der Lib: `192.168.1.1`,
  `192.168.1.254`, Broadcast `192.168.1.255`.
- **Ports werden ausgehandelt**, nicht fest kodiert: `proport` (Steuerkanal),
  `picport` (Bild), `audioport`, `libwificamera_notifyport`;
  Funktionen `proChangePort`, `proSetNotifyport`, `getPort`.
- **Zuverlässigkeit per ACK:** `addack`, `check_sendack`, `isackok`, `setackflag`.
- **Felder big-endian** (`read_big_endian_16`), Parser `parsebuf`.
- **Bild in Fragmenten**, Log-Format `seq=%d,frameId=%d,frameCnt=%d,len=%d`;
  Debug-Dateien `%s/new-%lld-%s.jpeg` → Nutzlast sehr wahrscheinlich **JPEG**.
- Weitere Kanäle/Funktionen: Audio (`wifidata_audio`), Sensoren
  (`sensor_get_xyz`, `humidityGet`, `temperatureGet`), Winkel/Neigung
  (`isAngleUpDown`, `maxangle`), Firmware-Update (`cameraWifiupdateFirmware`).
- Native Sockets können per JNI-Rückruf an ein bestimmtes Android-Netz
  gebunden werden (`bindSocketToNetwork`/`…Out` → `WifiCallBackFuc.bindSocket`).

**Debug-Log der Lib:** Die Lib schreibt u. a. `destip=%s,destport=%d`,
`picport=%d`, `proport=%d` in ein Log unter `<externer Speicher>/AWIFISDKLOG/`.
Eingeschaltet wird es über einen **versteckten Schalter**: Seitenmenü →
**10× auf das App-Icon** tippen (`NavigationViewFragment`, `navigation_icon`)
→ Schalter „Logcat“ → App neu starten (`WifiCameraApi.init` ruft dann
`openLog`). Ob die Lib unter Android 11+ dorthin schreiben darf (Scoped
Storage), ist offen.

**Andere Kamerafamilie – nicht Soulear:** Die HTTP-Befehle
`GET /?custom=1&cmd=<nr>` gehören zur Klasse `cameraHttpApi` /
`com.jni.Tieniu.WifiCameraTieniu` (Novatek-basierte Kameras, IP
`192.168.1.254`, Antworten als XML `<Cmd>…</Cmd>`). Zur Einordnung:

| cmd | Vermutung (aus Symbolnamen) |
|---|---|
| 1001 | Foto (`takePic`) |
| 2001 / 2002 / 2019 / 2020 | Modus, Auflösung, Aufnahme |
| 3005 / 3006 | Datum / Uhrzeit setzen |
| 3010–3029 | Status, SD-Karte, Batterie, Format, Reset |
| 4003 | Datei löschen |
| 8113–8119 | Geräteinfo, SN, Version |
| 8200–8204 | Helligkeit, Kontrast, Schärfe, R/G/B |
| 8205–8207 | Lizenz setzen/lesen |

**Sonstige Konstanten in der App:**

| Konstante / Fundstelle | Wert |
|---|---|
| `AppPathInfo.WiFi_HTTP` | `http://10.10.10.254:` |
| `UStorageDeviceModule.wifistart` | `192.168.1.1`, Port `10004` (Speicher-SDK) |
| `AppPathInfo.STORAGE_HTTP` | `http://127.0.0.1:` (lokaler Proxy der Storage-Lib) |
| `Constant.CONNECT_WIFI_KEY1..4` | SSID-Präfixe `i4season`, `SUEAR`, `inskam`, `Yanxuan` |

### Cloud

| URL | Zweck | Fundstelle |
|---|---|---|
| `https://yun.simicloud.com:10443/suear/api` | Basis-API (Feedback u. a.) | `WDApplication.BASE_URL` |
| `…/suear/api/feedback/clearnewreply` | Feedback | `FeedbackHistoryVM` |
| `https://yun.simicloud.com/licplatform/user/v2/report` | Lizenz-Report | `ReportLicInstance` |
| `https://lic.simicloud.com/api/nto/miss?` | Lizenz online holen | `FunctionSwitch.Online_Burning_Get_Lic_Url` |
| `http://www.simicloud.com/c/UStorage/android/version.xml` | Update-Check | – |

## Auffällige Cloud-Aufrufe (statisch, noch nicht per Mitschnitt bestätigt)

**1. Lizenz-Report mit Sperrmöglichkeit per Server** – `ReportLicInstance`,
aufgerufen aus `I4seasonCameraNew.wifiLicenseCheck()` bei jeder Verbindung mit
einer Ear-Kamera, deren lokale Lizenzprüfung (`checkLic10`) fehlschlägt.
- `POST https://yun.simicloud.com/licplatform/user/v2/report`, JSON:
  `lic, uuid (= ANDROID_ID), sn, mac, vendor, product, firmwareVersion,
  appName, appVersion, appPacketName, phoneProducer (Marke), phoneModel,
  phoneVersion`.
- Erzwingt **Mobilfunk** (`requestNetwork` mit TRANSPORT_CELLULAR, ohne WLAN),
  weil das Kamera-WLAN kein Internet hat. Ohne Mobilfunk: HTTP-Fallback-Schleife,
  die sich bei jedem Fehler alle 5 s rekursiv neu aufruft.
- Antwort `data.enable=false` → `reportReult(false)` → Kamera wird auf Status 31
  (offline) gesetzt, Aufnahme beendet. Der Hersteller kann einzelne Geräte
  (SN/MAC) also **aus der Ferne sperren**. Antwort `data.lic` → neue Lizenz wird
  per `cameraSetLic` in die Kamera geschrieben.

**2. Telemetrie aus den nativen Libs** (`libUStorageDeviceFS.so`) – wird in
`AppConfigInitInstance.initDeviceJniLibValue()` beim App-Start mit
Log-Pfad, Paketname, App-Version, Handymodell und Android-Version gefüttert,
dazu die SSID-Präfixe `i4season` und `SUEAR`. Strings in der Lib:
- `info2.simicloud.com` mit `uuid=%s&platform=%s&ssid=%s&appname=%s&mode=%s`
  → sendet u. a. die **WLAN-SSID**.
- Fehlerbericht-JSON (vermutlich an `lic.simicloud.com/api/nto/error`):
  `Sn, License, Devname, Uuid, Platform, Mobile, Sysver, Appname, Appver,
  Ssid, Devip, Devport, Errid, Errtime, …`
- Lizenz-Endpunkte `lic.simicloud.com/api/nto/{q,qlic2,qlic3,qmisslic2,miss,checkmiss}`
  mit `sn, id, swvendor, hwvendor, license, modelName, firmwareModel, firmwareVerson`.
- Native Sockets werden über `WifiCallBackFuc.bindSocket()` gezielt an das
  Mobilfunk-Netz gebunden, laufen also am WLAN (und an jedem Proxy) vorbei.
- TLS: Die Libs bringen ein eigenes, statisch gelinktes OpenSSL mit. Wie sie
  Serverzertifikate prüfen, ist statisch nicht geklärt – offene Frage für
  einen Mitschnitt.

**3. Tencent Bugly** (`com.tencent.bugly`, Crash-Reporting an
`android.bugly.qq.com` / `rqd.uu.qq.com`, per HTTP) ist eingebunden, wird im
App-Code aber **nicht** initialisiert (`CrashReport.initCrashReport` fehlt) →
vermutlich toter Code.

**Unauffällig:** Feedback (`…/suear/api/feedback/*`, sendet nur, was man selbst
eingibt: Text, E-Mail, Bilder), Update-Check (`version.xml`). Keine
Werbe-/Analytics-SDKs (Firebase, Facebook, AppsFlyer o. Ä.) gefunden, keine
Standort-Übertragung (Standort-Berechtigung dient der SSID-Erkennung).

## USB

`res/xml/device_filter.xml` listet die USB-Geräte, auf die `InitDeviceActivity`
reagiert – u. a. UVC-Klasse (`class 14`), Vendor `0x1c88` (mehrere PIDs),
`0xeb1a:0x2861`, `0x05e1:0x0408`.

## Bestätigt mit echter Kamera (30.09.2026)

Der `soulear`-Treiber in `app/` funktioniert – Geräteinfo (`YPC`,
`BK7231U-XRH-FBPRO`, Firmware `HKV41B`), Livebild (640×480, ~17 fps), LED
an/aus, Lagesensor mit Bildstabilisierung (Versatz 270°). Das Modell
`BK7231U-XRH-FBPRO` ist genau der Wert von `Constant.FBPRO`, bei dem die
Original-App nach fehlgeschlagener lokaler Lizenzprüfung den **Lizenz-Report
mit Sperrmöglichkeit** auslöst (siehe oben). Die eigene App braucht das nicht:
Die Kamera streamt ohne jede Lizenzprüfung.

## Offene Fragen

- Wo im Bildpaket die Kameratasten stehen (Header-Byte 0/5 beim Tastendruck
  beobachten – die App zeigt sie roh an).
- Ob Lizenz-Report und native Telemetrie (`info2.simicloud.com`) im Betrieb
  wirklich gesendet werden (Mitschnitt der Original-App mit Mobilfunk an,
  `npm run pcap -- hosts`).
- Bedeutung der übrigen OpenVideo-Felder und der Typen 0x10–0x1e.
- Ob die Kamera den mitgeteilten Port nutzt oder fest an 22785 sendet (beides
  ergibt 22785 – zum Unterscheiden `STREAM_PORTS=23000,22785` testen).
