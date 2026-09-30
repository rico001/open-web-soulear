import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:soulear_local/main.dart';
import 'package:soulear_local/src/app_controller.dart';
import 'package:soulear_local/src/camera_client.dart';
import 'package:soulear_local/src/protocol.dart';

/// Rendert die App in typischen Größen und prüft, dass nichts überläuft
/// (Flutter meldet Überläufe als Fehler). Ohne Kamera und ohne Plugins.
void main() {
  const sizes = {
    'kleines Handy': Size(360, 640),
    'Handy': Size(390, 844),
    'Tablet quer': Size(1024, 768),
    'Desktop': Size(1440, 900),
  };

  AppController fakeController({bool stabilize = false}) {
    final c = AppController();
    c.status.value = const CameraStatus(
      connected: true,
      fps: 17.3,
      battery: 57,
      led: 100,
      details: {
        'Hersteller': 'YPC',
        'Modell': 'BK7231U-XRH-FBPRO',
        'Firmware': 'HKV41B',
        'SSID': 'Soulear-xxxxx',
        'Laden': 'nein',
        'Empfangsport': '22785',
        'Auflösung': '640×480',
      },
    );
    c.sensor.value = const SensorReading(-5091, 169, 27762, 0.3, -10.4, (1, 1), true);
    if (stabilize) c.stabilize = const StabilizeSettings(enabled: true);
    return c;
  }

  for (final entry in sizes.entries) {
    for (final stab in [false, true]) {
      testWidgets('${entry.key}${stab ? ' (stabilisiert)' : ''}: kein Überlauf', (tester) async {
        tester.view.physicalSize = entry.value;
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.reset);

        await tester.pumpWidget(SoulearApp(controller: fakeController(stabilize: stab)));
        await tester.pump();
        expect(tester.takeException(), isNull);

        for (final tab in ['Fotos (0)', 'Gerät', 'Lage']) {
          await tester.tap(find.text(tab));
          await tester.pumpAndSettle();
          expect(tester.takeException(), isNull, reason: 'Tab $tab');
        }
        expect(find.text('Foto aufnehmen'), findsOneWidget);
      });
    }
  }
}
