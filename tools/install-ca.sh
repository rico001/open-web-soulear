#!/usr/bin/env bash
# Installiert die mitmproxy-CA als SYSTEM-Zertifikat im laufenden Emulator –
# per tmpfs-Overlay ueber /system/etc/security/cacerts. Das funktioniert ohne
# beschreibbares /system (kein remount/disable-verity noetig) und haelt bis zum
# naechsten Reboot. Voraussetzung: gerootetes AVD (adb root -> uid 0) und einmal
# gestartetes mitmproxy (erzeugt ~/.mitmproxy/mitmproxy-ca-cert.pem).
#
# Warum System- und nicht User-Cert: Apps mit targetSdk >= 24 vertrauen dem
# User-Store nicht (Soulear: targetSdk 36). Nur ein System-Cert wird akzeptiert.
set -euo pipefail

CA="${HOME}/.mitmproxy/mitmproxy-ca-cert.pem"
[ -f "$CA" ] || { echo "CA fehlt: $CA (mitmproxy einmal starten)"; exit 1; }

HASH="$(openssl x509 -inform PEM -subject_hash_old -in "$CA" | head -1)"
TMP="/tmp/${HASH}.0"
cp "$CA" "$TMP"

adb root >/dev/null 2>&1; sleep 3

# bestehende System-Certs + unseren in einen Arbeitsordner
adb shell "rm -rf /data/local/tmp/cacerts; mkdir -p /data/local/tmp/cacerts"
adb shell "cp /system/etc/security/cacerts/* /data/local/tmp/cacerts/"
adb push "$TMP" "/data/local/tmp/cacerts/${HASH}.0" >/dev/null

# tmpfs ueber den Store legen und komplett neu befuellen
adb shell "mount -t tmpfs tmpfs /system/etc/security/cacerts"
adb shell "cp /data/local/tmp/cacerts/* /system/etc/security/cacerts/"
adb shell "chown root:root /system/etc/security/cacerts/*"
adb shell "chmod 644 /system/etc/security/cacerts/*"
adb shell "chcon u:object_r:system_security_cacerts_file:s0 /system/etc/security/cacerts/* 2>/dev/null || true"

if adb shell "ls /system/etc/security/cacerts/${HASH}.0" >/dev/null 2>&1; then
  echo "OK: mitmproxy-CA (${HASH}.0) liegt im System-Store."
  echo "App danach neu starten (adb shell am force-stop <pkg>), damit sie den Store neu liest."
else
  echo "FEHLER: CA nicht im Store."
  exit 1
fi
