/// Testet den Dart-Kamera-Client ohne App – gegen die echte Kamera oder die
/// simulierte aus app/ (`npm run fake-camera`).
///
///   dart run tool/probe.dart [IP] [Sekunden]
///   dart run tool/probe.dart 127.0.0.1 5     # simulierte Kamera
///   dart run tool/probe.dart                 # echte Kamera (192.168.1.1)
library;

import 'dart:io';

import 'package:soulear_local/src/camera_client.dart';
import 'package:soulear_local/src/protocol.dart';

Future<void> main(List<String> args) async {
  final ip = args.isNotEmpty ? args[0] : '192.168.1.1';
  final seconds = args.length > 1 ? int.parse(args[1]) : 5;
  final client = CameraClient(config: CameraConfig(ip: ip), log: (m) => stdout.writeln('  [client] $m'));

  var frames = 0;
  var bytes = 0;
  SensorReading? sensor;
  client.frames.listen((f) {
    frames++;
    bytes += f.jpeg.length;
  });
  client.sensors.listen((s) => sensor = s);

  try {
    await client.connect();
  } catch (e) {
    stderr.writeln('Verbinden fehlgeschlagen: $e');
    exit(1);
  }
  stdout.writeln('Verbunden: ${client.status.details}');

  await Future<void>.delayed(Duration(seconds: seconds));
  stdout.writeln('Bilder: $frames in $seconds s (${(frames / seconds).toStringAsFixed(1)} fps), '
      'Ø ${frames == 0 ? 0 : bytes ~/ frames} Byte');
  final s = sensor;
  if (s != null) {
    stdout.writeln('Sensor: Drehung ${s.roll}°, Neigung ${s.pitch}°, roh ${s.x}/${s.y}/${s.z}');
  }

  await client.setLed(0);
  stdout.writeln('LED nach Aus: ${client.status.led}');
  await client.setLed(100);
  stdout.writeln('LED nach An: ${client.status.led}');

  await client.dispose();
  exit(frames > 0 ? 0 : 2);
}
