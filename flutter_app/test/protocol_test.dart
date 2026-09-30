import 'dart:math' as math;
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:soulear_local/src/protocol.dart';

/// Baut Chunks so, wie die Kamera sie sendet (Header laut suear-protocol.ts).
List<Uint8List> makeChunks(Uint8List jpeg, {required int frame, required int firstChunk, (int, int, int) accel = (0, 0, 1000)}) {
  final total = (jpeg.length / chunkDataSize).ceil();
  return List.generate(total, (i) {
    final h = ByteData(16)
      ..setUint8(0, 1)
      ..setUint8(1, (firstChunk + i) & 0xff)
      ..setUint8(2, frame)
      ..setUint8(3, i == total - 1 ? 1 : 0)
      ..setUint8(4, i == total - 1 ? total : 0)
      ..setInt16(6, accel.$1, Endian.little)
      ..setInt16(8, accel.$2, Endian.little)
      ..setInt16(10, accel.$3, Endian.little)
      ..setUint16(12, 640, Endian.little)
      ..setUint16(14, 480, Endian.little);
    final data = jpeg.sublist(i * chunkDataSize, math.min(jpeg.length, (i + 1) * chunkDataSize));
    return Uint8List.fromList([...h.buffer.asUint8List(), ...data]);
  });
}

Uint8List fakeJpeg(int size, int seed) {
  final r = math.Random(seed);
  final b = Uint8List(size);
  for (var i = 0; i < size; i++) {
    b[i] = r.nextInt(256);
  }
  b[0] = 0xff;
  b[1] = 0xd8;
  return b;
}

void main() {
  test('Nachricht kodieren und dekodieren', () {
    final m = encodeMessage(7, MsgType.led, [0x11, 1, 100]);
    expect(m.sublist(0, 4), [0xee, 0xff, 0xee, 0xff]);
    expect(m[8], 1); // unk
    final d = decodeMessage(m)!;
    expect(d.id, 7);
    expect(d.type, MsgType.led);
    expect(d.errCode, 0);
    expect(d.data, [0x11, 1, 100]);
    expect(decodeMessage(Uint8List(4)), isNull);
  });

  test('Geräteinfo lesen', () {
    final d = Uint8List(128);
    d.setRange(1, 4, 'YPC'.codeUnits);
    d.setRange(33, 33 + 17, 'BK7231U-XRH-FBPRO'.codeUnits);
    d.setRange(65, 71, 'HKV41B'.codeUnits);
    ByteData.sublistView(d).setUint16(119, (57 << 9) | (1 << 8), Endian.little);
    final info = parseDeviceInfo(d)!;
    expect(info.vendor, 'YPC');
    expect(info.product, 'BK7231U-XRH-FBPRO');
    expect(info.firmware, 'HKV41B');
    expect(info.battery, 57);
    expect(info.charging, isTrue);
  });

  test('LED-Nutzlasten und Antwort', () {
    expect(ledSetPayload(100), [0x11, 1, 100]);
    expect(ledSetPayload(0), [0x11, 0, 0]);
    expect(ledQueryPayload(), [0x01, 0, 0]);
    expect(parseLedStatus(Uint8List.fromList([1, 1, 100])), 100);
    expect(parseLedStatus(Uint8List.fromList([1, 0, 100])), 0);
    expect(parseLedStatus(Uint8List(0)), isNull);
  });

  test('Mehrere Chunks in einem Datagramm', () {
    final chunks = makeChunks(fakeJpeg(4000, 1), frame: 3, firstChunk: 10, accel: (5, -6, 7));
    final parsed = parseChunks(Uint8List.fromList([...chunks[0], ...chunks[1]]));
    expect(parsed.length, 2);
    expect(parsed[0].chunkIndex, 10);
    expect(parsed[1].chunkIndex, 11);
    expect(parsed[0].data.length, chunkDataSize);
    expect(parsed[0].accel, (5, -6, 7));
    expect(parsed[0].width, 640);
  });

  test('Frame aus vertauschten Chunks, Chunk-Zähler läuft über 255', () {
    final jpeg = fakeJpeg(10000, 2);
    final chunks = makeChunks(jpeg, frame: 9, firstChunk: 250).map((c) => parseChunks(c).single).toList();
    final shuffled = [...chunks]..shuffle(math.Random(3));
    final a = FrameAssembler();
    Frame? out;
    for (final c in shuffled) {
      out = a.push(c) ?? out;
    }
    expect(out, isNotNull);
    expect(out!.jpeg, jpeg);
  });

  test('Unvollständiger Frame wird nicht ausgegeben, nächster schon', () {
    final a = FrameAssembler();
    final f1 = makeChunks(fakeJpeg(5000, 4), frame: 1, firstChunk: 0).map((c) => parseChunks(c).single).toList();
    f1.removeAt(1); // Verlust
    final f2 = makeChunks(fakeJpeg(5000, 5), frame: 2, firstChunk: 4).map((c) => parseChunks(c).single).toList();
    final outs = [...f1, ...f2].map(a.push).whereType<Frame>().toList();
    expect(outs.length, 1);
    expect(a.dropped, 1);
  });

  test('Sensor: Drehung und Neigung', () {
    final s = SensorSmoother();
    final r = s.push((0, 1000, 0), (1, 0)); // y positiv, z 0 → 90°
    expect(r.roll, closeTo(90, 0.1));
    expect(r.pitch, closeTo(0, 0.1));
    expect(r.available, isTrue);
    expect(SensorSmoother().push((0, 0, 0), (0, 0)).available, isFalse);
  });
}
