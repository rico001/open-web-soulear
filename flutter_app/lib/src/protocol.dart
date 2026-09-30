/// UDP-Protokoll der i4season-„Suear“-Kamerafamilie (libWifiCamera.so).
///
/// Dart-Umsetzung von app/server/src/camera/suear-protocol.ts – Aufbau und
/// Quellen siehe dort (Sean Pesce, Suear-Web-Viewer, GPL-2.0; gegengeprüft an
/// Soulear 1.0.120). Alle Felder little-endian. Reines Dart, ohne Flutter.
library;

import 'dart:math' as math;
import 'dart:typed_data';

const int magic = 0xffeeffee;
const int headerSize = 12;
const int chunkHeaderSize = 16;
const int chunkDataSize = 1456;

abstract final class MsgType {
  static const getDeviceInfo = 0x01;
  static const getLicense = 0x02;
  static const openVideo = 0x04;
  static const led = 0x0a;
}

class Message {
  const Message(this.id, this.type, this.errCode, this.data);
  final int id;
  final int type;
  final int errCode;
  final Uint8List data;
}

/// Header (12 Byte): magic u32 | id u16 | type u16 | unk u8 (=1) | errCode u8 | length u16.
Uint8List encodeMessage(int id, int type, [List<int> data = const []]) {
  final out = Uint8List(headerSize + data.length);
  final b = ByteData.sublistView(out);
  b.setUint32(0, magic, Endian.little);
  b.setUint16(4, id & 0xffff, Endian.little);
  b.setUint16(6, type, Endian.little);
  b.setUint8(8, 1);
  b.setUint8(9, 0);
  b.setUint16(10, data.length, Endian.little);
  out.setRange(headerSize, out.length, data);
  return out;
}

Message? decodeMessage(Uint8List buf) {
  if (buf.length < headerSize) return null;
  final b = ByteData.sublistView(buf);
  if (b.getUint32(0, Endian.little) != magic) return null;
  final length = b.getUint16(10, Endian.little);
  final end = math.min(buf.length, headerSize + length);
  return Message(
    b.getUint16(4, Endian.little),
    b.getUint16(6, Endian.little),
    b.getUint8(9),
    Uint8List.sublistView(buf, headerSize, end),
  );
}

class DeviceInfo {
  const DeviceInfo(this.vendor, this.product, this.firmware, this.ssid, this.battery, this.charging);
  final String vendor;
  final String product;
  final String firmware;
  final String ssid;
  final int battery;
  final bool charging;
}

String _cstr(Uint8List d, int off, int len) {
  final s = Uint8List.sublistView(d, off, off + len);
  final end = s.indexOf(0);
  return String.fromCharCodes(end < 0 ? s : s.sublist(0, end));
}

/// Antwort auf GetDeviceInfo (128 Byte, gepackt).
DeviceInfo? parseDeviceInfo(Uint8List d) {
  if (d.length < 124) return null;
  final power = ByteData.sublistView(d).getUint16(119, Endian.little);
  return DeviceInfo(
    _cstr(d, 1, 32),
    _cstr(d, 33, 32),
    _cstr(d, 65, 16),
    _cstr(d, 81, 32),
    math.min(100, power >> 9),
    ((power >> 8) & 1) == 1,
  );
}

/// LED setzen (Typ 0x0a): [0x10 | LED-Nr., an/aus, Helligkeit 0–100].
List<int> ledSetPayload(int level, {int led = 1}) {
  final v = level.clamp(0, 100);
  return [0x10 | (led & 0x0f), v > 0 ? 1 : 0, v];
}

/// LED lesen (Typ 0x0a): [LED-Nr., 0, 0] → Antwort [?, an/aus, Helligkeit].
List<int> ledQueryPayload({int led = 1}) => [led & 0x0f, 0, 0];

/// Helligkeit 0–100 (0 = aus), null wenn unlesbar.
int? parseLedStatus(Uint8List d) {
  if (d.length < 3) return null;
  return d[1] != 0 ? math.min(100, d[2] == 0 ? 100 : d[2]) : 0;
}

class Chunk {
  const Chunk(this.chunkIndex, this.frameIndex, this.isLast, this.totalChunks, this.width, this.height, this.accel,
      this.flags, this.data);

  /// Laufender 8-Bit-Zähler über alle Chunks (nicht pro Frame).
  final int chunkIndex;
  final int frameIndex;
  final bool isLast;

  /// Nur im letzten Chunk eines Frames gesetzt.
  final int totalChunks;
  final int width;
  final int height;

  /// Beschleunigungssensor, roh (int16, Byte 6–11).
  final (int, int, int) accel;

  /// Unbekannte Header-Bytes 0 und 5.
  final (int, int) flags;
  final Uint8List data;
}

/// Ein Datagramm des Bildkanals kann mehrere Chunks enthalten:
/// je 16 Byte Header + bis zu 1456 Byte JPEG-Daten.
List<Chunk> parseChunks(Uint8List buf) {
  final chunks = <Chunk>[];
  var off = 0;
  while (off + chunkHeaderSize <= buf.length) {
    final h = ByteData.sublistView(buf, off, off + chunkHeaderSize);
    off += chunkHeaderSize;
    final end = math.min(off + chunkDataSize, buf.length);
    final data = Uint8List.sublistView(buf, off, end);
    off = end;
    chunks.add(Chunk(
      h.getUint8(1),
      h.getUint8(2),
      h.getUint8(3) == 1,
      h.getUint8(4),
      h.getUint16(12, Endian.little),
      h.getUint16(14, Endian.little),
      (h.getInt16(6, Endian.little), h.getInt16(8, Endian.little), h.getInt16(10, Endian.little)),
      (h.getUint8(0), h.getUint8(5)),
      data,
    ));
  }
  return chunks;
}

class Frame {
  const Frame(this.jpeg, this.width, this.height, this.accel, this.flags);
  final Uint8List jpeg;
  final int width;
  final int height;
  final (int, int, int) accel;
  final (int, int) flags;
}

class _Pending {
  _Pending(this.width, this.height, this.accel, this.flags, this.createdAt);
  final Map<int, Uint8List> chunks = {};
  int? lastIndex;
  int total = 0;
  final int width;
  final int height;
  final (int, int, int) accel;
  final (int, int) flags;
  final int createdAt;
}

/// Setzt Chunks zu JPEG-Frames zusammen. Robust gegen Umordnung: die Position
/// eines Chunks ergibt sich aus dem letzten Chunk (Index und Gesamtzahl).
class FrameAssembler {
  FrameAssembler({this.maxPending = 8});
  final int maxPending;
  final _pending = <int, _Pending>{};
  int dropped = 0;
  int _clock = 0;

  Frame? push(Chunk c) {
    var f = _pending[c.frameIndex];
    if (f == null) {
      if (_pending.length >= maxPending) {
        final oldest = _pending.entries.reduce((a, b) => a.value.createdAt <= b.value.createdAt ? a : b);
        _pending.remove(oldest.key);
        dropped++;
      }
      f = _Pending(c.width, c.height, c.accel, c.flags, _clock++);
      _pending[c.frameIndex] = f;
    }
    f.chunks[c.chunkIndex] = c.data;
    if (c.isLast) {
      f.lastIndex = c.chunkIndex;
      f.total = c.totalChunks;
    }
    final last = f.lastIndex;
    if (last == null || f.total == 0 || f.chunks.length < f.total) return null;

    final first = (last - (f.total - 1) + 256) & 0xff;
    final builder = BytesBuilder(copy: false);
    for (var i = 0; i < f.total; i++) {
      final part = f.chunks[(first + i) & 0xff];
      if (part == null) return null; // Lücke – evtl. kommt der Chunk noch
      builder.add(part);
    }
    _pending.remove(c.frameIndex);
    // Ältere, noch offene Frames sind jetzt veraltet.
    _pending.removeWhere((_, p) {
      final stale = p.createdAt < f!.createdAt;
      if (stale) dropped++;
      return stale;
    });
    final jpeg = builder.takeBytes();
    if (jpeg.length < 2 || jpeg[0] != 0xff || jpeg[1] != 0xd8) {
      dropped++;
      return null;
    }
    return Frame(jpeg, f.width, f.height, f.accel, f.flags);
  }

  void reset() => _pending.clear();
}

class SensorReading {
  const SensorReading(this.x, this.y, this.z, this.roll, this.pitch, this.flags, this.available);
  final int x;
  final int y;
  final int z;

  /// Drehung um die Längsachse, 0–360° (atan2(y, z), wie libWifiCamera).
  final double roll;

  /// Neigung, −90…90° (atan2(x, √(y²+z²))).
  final double pitch;
  final (int, int) flags;

  /// false, wenn alle Rohwerte 0 sind (kein Sensor).
  final bool available;
}

/// Glättung wie libWifiCamera.so (sensor_get_xyz): Mittelwert der letzten
/// 10 Werte ohne Minimum und Maximum, je Achse.
class SensorSmoother {
  final _hist = [<int>[], <int>[], <int>[]];

  SensorReading push((int, int, int) accel, (int, int) flags) {
    final raw = [accel.$1, accel.$2, accel.$3];
    final avg = List<double>.generate(3, (i) {
      final h = _hist[i]..add(raw[i]);
      if (h.length > 10) h.removeAt(0);
      if (h.length < 3) return raw[i].toDouble();
      final sorted = [...h]..sort();
      final trimmed = sorted.sublist(1, sorted.length - 1);
      return trimmed.reduce((a, b) => a + b) / trimmed.length;
    });
    final (x, y, z) = (avg[0], avg[1], avg[2]);
    const deg = 180 / math.pi;
    final roll = (math.atan2(y, z) * deg + 360) % 360;
    final pitch = math.atan2(x, math.sqrt(y * y + z * z)) * deg;
    return SensorReading(
      x.round(),
      y.round(),
      z.round(),
      (roll * 10).round() / 10,
      (pitch * 10).round() / 10,
      flags,
      raw.any((v) => v != 0),
    );
  }

  void reset() {
    for (final h in _hist) {
      h.clear();
    }
  }
}
