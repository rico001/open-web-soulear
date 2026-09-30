#!/usr/bin/env bash
# Entpackt die Soulear-XAPK und dekompiliert sie fuer die statische Analyse.
#   apk/soulear/*.apk          – Basis- + Split-APKs (fuer adb install-multiple)
#   apk/soulear/apktool-out/   – Manifest, Ressourcen, smali (apktool)
#   apk/soulear/jadx-out/      – Java-Quelltext (jadx, deobfuskiert)
#   apk/soulear/native/        – native Libs aus dem arm64-Split (lib*.so)
# Voraussetzung: jadx, apktool, unzip (brew install jadx apktool).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
XAPK="${1:-$ROOT/apk/com.i4season.bkCamera_soulear_1.0.120.xapk}"
OUT="$ROOT/apk/soulear"
BASE="com.i4season.bkCamera_soulear.apk"

[ -f "$XAPK" ] || { echo "XAPK fehlt: $XAPK"; exit 1; }
mkdir -p "$OUT"

unzip -oq "$XAPK" -d "$OUT"
apktool d -f -q "$OUT/$BASE" -o "$OUT/apktool-out"
jadx -q --deobf -d "$OUT/jadx-out" "$OUT/$BASE" || true   # jadx meldet oft harmlose Fehler
unzip -oq "$OUT/config.arm64_v8a.apk" 'lib/*' -d "$OUT/native"

echo "OK: $OUT"
ls "$OUT/native/lib/arm64-v8a"
