/// Kamera-Client für Soulear/Suear-Kameras (UDP). Reines Dart (dart:io), läuft
/// in der App und als Kommandozeilen-Programm (tool/probe.dart).
///
/// Ablauf wie app/server/src/camera/soulear.ts: GetDeviceInfo → Bild-Ports
/// öffnen → OpenVideo (erst mit eigenem Empfangsport als Nutzlast, bei Fehler
/// ohne) → Chunks zu JPEGs zusammensetzen. Bleiben Bilddaten aus, wird
/// OpenVideo wiederholt.
library;

import 'dart:async';
import 'dart:io';

import 'protocol.dart';

class CameraConfig {
  const CameraConfig({
    this.ip = '192.168.1.1',
    this.cmdPort = 10005,
    this.videoPort = 10006,
    this.streamPorts = const [22785, 22789],
  });
  final String ip;
  final int cmdPort;
  final int videoPort;
  final List<int> streamPorts;
}

class CameraStatus {
  const CameraStatus({
    this.connected = false,
    this.fps = 0,
    this.battery,
    this.charging = false,
    this.led,
    this.error,
    this.details = const {},
  });
  final bool connected;
  final double fps;
  final int? battery;
  final bool charging;

  /// 0–100, null wenn unbekannt.
  final int? led;
  final String? error;
  final Map<String, String> details;

  CameraStatus copyWith({
    bool? connected,
    double? fps,
    int? battery,
    bool? charging,
    int? led,
    String? error,
    bool clearError = false,
    Map<String, String>? details,
  }) =>
      CameraStatus(
        connected: connected ?? this.connected,
        fps: fps ?? this.fps,
        battery: battery ?? this.battery,
        charging: charging ?? this.charging,
        led: led ?? this.led,
        error: clearError ? null : (error ?? this.error),
        details: details ?? this.details,
      );
}

class CameraClient {
  CameraClient({this.config = const CameraConfig(), this.log = _noLog});

  final CameraConfig config;
  final void Function(String) log;

  static const _stall = Duration(seconds: 6);
  static const _infoInterval = Duration(seconds: 10);

  final _frames = StreamController<Frame>.broadcast();
  final _sensors = StreamController<SensorReading>.broadcast();
  final _statusCtrl = StreamController<CameraStatus>.broadcast();

  /// Fertige JPEG-Bilder.
  Stream<Frame> get frames => _frames.stream;

  /// Geglättete Lagesensor-Werte, eines pro Bild.
  Stream<SensorReading> get sensors => _sensors.stream;
  Stream<CameraStatus> get statusStream => _statusCtrl.stream;
  CameraStatus get status => _status;

  CameraStatus _status = const CameraStatus();
  Frame? lastFrame;

  RawDatagramSocket? _cmd;
  final _streamSocks = <RawDatagramSocket>[];
  final _assembler = FrameAssembler();
  final _smoother = SensorSmoother();
  late InternetAddress _addr;
  int _msgId = 0;
  Future<void> _queue = Future.value();
  _PendingRequest? _pending;
  bool _usePortPayload = true;
  bool _everReceived = false;
  bool _stallError = false;
  bool _restartPending = false;
  DateTime _lastData = DateTime.now();
  Timer? _watchdog;
  Timer? _infoTimer;
  int _infoFailures = 0;
  final _frameTimes = <DateTime>[];

  void _setStatus(CameraStatus s) {
    _status = s;
    if (!_statusCtrl.isClosed) _statusCtrl.add(s);
  }

  Future<void> connect() async {
    if (_status.connected) return;
    _setStatus(_status.copyWith(clearError: true));
    _everReceived = false;
    try {
      _addr = InternetAddress(config.ip);
      _cmd = await RawDatagramSocket.bind(InternetAddress.anyIPv4, 0);
      _cmd!.listen((e) {
        if (e == RawSocketEvent.read) _onCmdData();
      });

      final String info;
      try {
        info = await _updateInfo();
      } catch (_) {
        throw CameraException(
            'Kamera antwortet nicht (${config.ip}:${config.cmdPort}). Ist das Gerät im WLAN der Kamera?');
      }
      log('Kamera: $info');

      await _openStreamSockets();
      _setStatus(_status.copyWith(connected: true));
      await _openVideo();

      // Wie die Original-App: nach dem Verbinden Licht an.
      try {
        await setLed(100);
      } catch (e) {
        log('LED einschalten fehlgeschlagen: $e');
      }

      _watchdog = Timer.periodic(const Duration(seconds: 1), (_) => _checkStall());
      _infoTimer = Timer.periodic(_infoInterval, (_) => _pollInfo());
    } catch (e) {
      await _teardown();
      _setStatus(_status.copyWith(error: e is CameraException ? e.message : '$e'));
      rethrow;
    }
  }

  Future<void> disconnect() => _teardown();

  Future<void> dispose() async {
    await _teardown();
    await _frames.close();
    await _sensors.close();
    await _statusCtrl.close();
  }

  Future<void> setLed(int level) async {
    final res = await _request(config.cmdPort, MsgType.led, ledSetPayload(level));
    if (res.errCode != 0) throw CameraException('LED: Fehlercode ${res.errCode}');
    _setStatus(_status.copyWith(led: level.clamp(0, 100)));
    // Anzeige nach dem tatsächlichen Zustand der Kamera richten.
    try {
      await _readLed();
    } catch (_) {}
  }

  // --- intern ---------------------------------------------------------------

  Future<void> _teardown() async {
    _watchdog?.cancel();
    _infoTimer?.cancel();
    _watchdog = _infoTimer = null;
    _cmd?.close();
    _cmd = null;
    for (final s in _streamSocks) {
      s.close();
    }
    _streamSocks.clear();
    _assembler.reset();
    _smoother.reset();
    final p = _pending;
    _pending = null;
    if (p != null) {
      p.timer.cancel();
      if (!p.completer.isCompleted) p.completer.completeError(const CameraException('getrennt'));
    }
    _setStatus(_status.copyWith(connected: false, fps: 0));
  }

  Future<String> _updateInfo() async {
    final res = await _request(config.cmdPort, MsgType.getDeviceInfo);
    final info = parseDeviceInfo(res.data);
    if (info == null) throw CameraException('GetDeviceInfo: unerwartete Antwort (${res.data.length} Byte)');
    _setStatus(_status.copyWith(
      battery: info.battery,
      charging: info.charging,
      details: {
        ..._status.details,
        'Hersteller': info.vendor,
        'Modell': info.product,
        'Firmware': info.firmware,
        'SSID': info.ssid,
        'Laden': info.charging ? 'ja' : 'nein',
      },
    ));
    return '${info.vendor} ${info.product} ${info.firmware}, Akku ${info.battery} %';
  }

  Future<void> _readLed() async {
    final res = await _request(config.cmdPort, MsgType.led, ledQueryPayload());
    final level = parseLedStatus(res.data);
    if (level != null) _setStatus(_status.copyWith(led: level));
  }

  Future<void> _pollInfo() async {
    const lost = 'Kamera antwortet nicht mehr auf Statusabfragen';
    try {
      await _updateInfo();
      try {
        await _readLed();
      } catch (_) {}
      _infoFailures = 0;
      if (_status.error == lost) _setStatus(_status.copyWith(clearError: true));
    } catch (_) {
      if (++_infoFailures >= 3) _setStatus(_status.copyWith(error: lost));
    }
  }

  Future<void> _openStreamSockets() async {
    for (final port in config.streamPorts) {
      try {
        final s = await RawDatagramSocket.bind(InternetAddress.anyIPv4, port);
        s.listen((e) {
          if (e == RawSocketEvent.read) _onStreamData(s, port);
        });
        _streamSocks.add(s);
      } catch (e) {
        log('Bild-Port $port nicht nutzbar: $e');
      }
    }
    if (_streamSocks.isEmpty) {
      throw CameraException('Keiner der Bild-Ports ${config.streamPorts.join('/')} ist frei');
    }
  }

  Future<void> _openVideo() async {
    try {
      await _sendOpenVideo();
    } catch (e) {
      // Ältere Firmware kennt die Port-Nutzlast evtl. nicht → ohne versuchen.
      // Hat der Port-Modus schon Bilder geliefert, ist es nur ein Ausfall.
      if (!_usePortPayload || _everReceived) rethrow;
      log('OpenVideo mit Port fehlgeschlagen ($e) – versuche ohne Nutzlast');
      _usePortPayload = false;
      await _sendOpenVideo();
    }
  }

  Future<void> _sendOpenVideo() async {
    final payload = <int>[];
    if (_usePortPayload) {
      final p = config.streamPorts.first;
      payload.addAll([p & 0xff, (p >> 8) & 0xff]);
    }
    final res = await _request(config.videoPort, MsgType.openVideo, payload);
    if (res.errCode != 0) throw CameraException('OpenVideo: Fehlercode ${res.errCode}');
    _lastData = DateTime.now();
    log('OpenVideo gesendet (${_usePortPayload ? 'mit Port' : 'ohne Nutzlast'})');
  }

  void _checkStall() {
    _frameTimes.removeWhere((t) => DateTime.now().difference(t) > const Duration(seconds: 3));
    final fps = (_frameTimes.length / 3 * 10).round() / 10;
    if (fps != _status.fps) _setStatus(_status.copyWith(fps: fps));

    if (!_status.connected || _restartPending || DateTime.now().difference(_lastData) < _stall) return;
    if (!_everReceived && _usePortPayload) _usePortPayload = false;
    _stallError = true;
    final msg = _everReceived ? 'Bildstrom unterbrochen – starte neu' : 'Keine Bilddaten – versuche anderen Startmodus';
    _setStatus(_status.copyWith(error: msg));
    log(msg);
    _lastData = DateTime.now();
    _restartPending = true;
    _openVideo().catchError((Object e) => log('OpenVideo fehlgeschlagen: $e')).whenComplete(() => _restartPending = false);
  }

  void _onStreamData(RawDatagramSocket sock, int port) {
    Datagram? d;
    while ((d = sock.receive()) != null) {
      if (d!.address != _addr) continue;
      _lastData = DateTime.now();
      if (!_everReceived) {
        _everReceived = true;
        log('Erste Bilddaten auf Port $port');
        _setStatus(_status.copyWith(details: {
          ..._status.details,
          'Empfangsport': '$port',
          'Startmodus': _usePortPayload ? 'port' : 'plain',
        }));
      }
      if (_stallError) {
        _stallError = false;
        _setStatus(_status.copyWith(clearError: true));
      }
      for (final chunk in parseChunks(d.data)) {
        final frame = _assembler.push(chunk);
        if (frame == null) continue;
        lastFrame = frame;
        _frameTimes.add(DateTime.now());
        final res = '${frame.width}×${frame.height}';
        if (_status.details['Auflösung'] != res) {
          _setStatus(_status.copyWith(details: {..._status.details, 'Auflösung': res}));
        }
        _frames.add(frame);
        _sensors.add(_smoother.push(frame.accel, frame.flags));
      }
    }
  }

  void _onCmdData() {
    final sock = _cmd;
    if (sock == null) return;
    Datagram? d;
    while ((d = sock.receive()) != null) {
      final p = _pending;
      if (p == null || d!.address != _addr || d.port != p.port) continue;
      final msg = decodeMessage(d.data);
      if (msg == null || msg.type != p.type) continue;
      _pending = null;
      p.timer.cancel();
      p.completer.complete(msg);
    }
  }

  /// Anfrage/Antwort, serialisiert – die Kamera beantwortet eine nach der
  /// anderen; zugeordnet über Absenderport und Nachrichtentyp.
  Future<Message> _request(int port, int type, [List<int> data = const [], int attempts = 3]) {
    Future<Message> run() async {
      Object lastErr = const CameraException('keine Antwort');
      for (var i = 0; i < attempts; i++) {
        try {
          return await _requestOnce(port, type, data);
        } catch (e) {
          lastErr = e;
        }
      }
      throw lastErr;
    }

    final result = _queue.then((_) => run(), onError: (_) => run());
    _queue = result.then((_) {}, onError: (_) {});
    return result;
  }

  Future<Message> _requestOnce(int port, int type, List<int> data) {
    final sock = _cmd;
    if (sock == null) return Future.error(const CameraException('nicht verbunden'));
    final completer = Completer<Message>();
    final timer = Timer(const Duration(milliseconds: 1500), () {
      if (_pending?.completer == completer) _pending = null;
      if (!completer.isCompleted) {
        completer.completeError(CameraException('Zeitüberschreitung (Typ $type, Port $port)'));
      }
    });
    _pending = _PendingRequest(port, type, completer, timer);
    sock.send(encodeMessage(_msgId++, type, data), _addr, port);
    return completer.future;
  }
}

class _PendingRequest {
  _PendingRequest(this.port, this.type, this.completer, this.timer);
  final int port;
  final int type;
  final Completer<Message> completer;
  final Timer timer;
}

class CameraException implements Exception {
  const CameraException(this.message);
  final String message;
  @override
  String toString() => message;
}

void _noLog(String _) {}
