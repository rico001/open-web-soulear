import 'dart:async';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:gal/gal.dart';
import 'package:path_provider/path_provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'camera_client.dart';
import 'protocol.dart';

class StabilizeSettings {
  const StabilizeSettings({this.enabled = false, this.invert = false, this.offset = 270});

  final bool enabled;

  /// Drehrichtung umkehren, falls das Bild gegen die Bewegung dreht.
  final bool invert;

  /// Fester Versatz in Grad. Standard 270° – am Soulear-Gerät ermittelt.
  final int offset;

  StabilizeSettings copyWith({bool? enabled, bool? invert, int? offset}) =>
      StabilizeSettings(enabled: enabled ?? this.enabled, invert: invert ?? this.invert, offset: offset ?? this.offset);
}

/// Hält Kamera-Verbindung, Einstellungen und Fotos. Livebild und Sensorwerte
/// laufen über eigene ValueNotifier, damit nicht die ganze Oberfläche bei
/// jedem Bild neu gebaut wird.
class AppController extends ChangeNotifier {
  AppController();

  static const _network = MethodChannel('soulear/network');

  late SharedPreferences _prefs;
  CameraClient? _client;
  final _subs = <StreamSubscription<Object?>>[];

  final frame = ValueNotifier<Frame?>(null);
  final sensor = ValueNotifier<SensorReading?>(null);
  final status = ValueNotifier<CameraStatus>(const CameraStatus());

  /// Drehwinkel fürs Livebild in Grad, null = nicht stabilisieren.
  final rotation = ValueNotifier<double?>(null);

  String cameraIp = '192.168.1.1';
  StabilizeSettings stabilize = const StabilizeSettings();
  List<File> photos = [];
  bool connecting = false;

  late Directory _photoDir;

  Future<void> init() async {
    _prefs = await SharedPreferences.getInstance();
    cameraIp = _prefs.getString('cameraIp') ?? cameraIp;
    stabilize = StabilizeSettings(
      enabled: _prefs.getBool('stab.enabled') ?? false,
      invert: _prefs.getBool('stab.invert') ?? false,
      offset: _prefs.getInt('stab.offset') ?? 270,
    );
    _photoDir = Directory('${(await getApplicationDocumentsDirectory()).path}/photos');
    await _photoDir.create(recursive: true);
    await _loadPhotos();
    notifyListeners();
    unawaited(connect());
  }

  Future<void> connect() async {
    if (connecting) return;
    connecting = true;
    notifyListeners();
    await _disposeClient();
    if (Platform.isAndroid) {
      try {
        final ok = await _network.invokeMethod<bool>('bindToWifi');
        debugPrint('An WLAN gebunden: $ok');
      } catch (e) {
        debugPrint('WLAN-Bindung fehlgeschlagen: $e');
      }
    }
    final client = CameraClient(config: CameraConfig(ip: cameraIp), log: (m) => debugPrint('[kamera] $m'));
    _client = client;
    _subs
      ..add(client.frames.listen((f) => frame.value = f))
      ..add(client.sensors.listen(_onSensor))
      ..add(client.statusStream.listen((s) => status.value = s));
    try {
      await client.connect();
    } catch (_) {
      status.value = client.status;
    } finally {
      connecting = false;
      notifyListeners();
    }
  }

  Future<void> _disposeClient() async {
    for (final s in _subs) {
      await s.cancel();
    }
    _subs.clear();
    await _client?.dispose();
    _client = null;
    frame.value = null;
    sensor.value = null;
    rotation.value = null;
  }

  Future<void> toggleLed() async {
    final c = _client;
    if (c == null) return;
    await c.setLed((status.value.led ?? 0) > 0 ? 0 : 100);
  }

  Future<void> setCameraIp(String ip) async {
    cameraIp = ip.trim();
    await _prefs.setString('cameraIp', cameraIp);
    await connect();
  }

  void setStabilize(StabilizeSettings s) {
    stabilize = s;
    _prefs
      ..setBool('stab.enabled', s.enabled)
      ..setBool('stab.invert', s.invert)
      ..setInt('stab.offset', s.offset);
    if (!s.enabled) rotation.value = null;
    notifyListeners();
  }

  void _onSensor(SensorReading r) {
    sensor.value = r;
    if (!stabilize.enabled || !r.available) {
      rotation.value = null;
      return;
    }
    final target = (stabilize.invert ? -r.roll : r.roll) + stabilize.offset;
    final last = rotation.value;
    // Stetig weiterdrehen statt von 359° auf 0° zu springen.
    rotation.value = last == null ? target : last + ((((target - last) % 360) + 540) % 360) - 180;
  }

  // --- Fotos ----------------------------------------------------------------

  Future<void> _loadPhotos() async {
    final files = _photoDir.listSync().whereType<File>().where((f) => f.path.endsWith('.jpg')).toList()
      ..sort((a, b) => b.path.compareTo(a.path));
    photos = files;
  }

  /// Speichert das aktuelle Bild in der App und in der Galerie (Album „Soulear lokal“).
  /// Gibt eine Meldung für die Oberfläche zurück.
  Future<String> takePhoto() async {
    final f = frame.value;
    if (f == null) return 'Noch kein Bild';
    final now = DateTime.now();
    String two(int n) => n.toString().padLeft(2, '0');
    final name = '${now.year}${two(now.month)}${two(now.day)}-${two(now.hour)}${two(now.minute)}${two(now.second)}'
        '-${now.millisecond.toString().padLeft(3, '0')}.jpg';
    final file = File('${_photoDir.path}/$name');
    await file.writeAsBytes(f.jpeg);
    photos = [file, ...photos];
    notifyListeners();
    try {
      await Gal.putImageBytes(f.jpeg, album: 'Soulear lokal', name: name.replaceAll('.jpg', ''));
      return 'Foto gespeichert (auch in der Galerie)';
    } catch (e) {
      return 'Foto in der App gespeichert – Galerie: $e';
    }
  }

  Future<void> deletePhoto(File f) async {
    if (await f.exists()) await f.delete();
    photos = photos.where((p) => p.path != f.path).toList();
    notifyListeners();
  }

  @override
  void dispose() {
    unawaited(_disposeClient());
    super.dispose();
  }
}
