import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../src/app_controller.dart';
import '../src/protocol.dart';

String _hex(int n) => '0x${n.toRadixString(16).padLeft(2, '0')}';

class SensorTab extends StatelessWidget {
  const SensorTab({super.key, required this.controller});
  final AppController controller;

  @override
  Widget build(BuildContext context) {
    final s = controller.stabilize;
    final text = Theme.of(context).textTheme;
    return ListView(padding: const EdgeInsets.all(16), children: [
      ValueListenableBuilder(
        valueListenable: controller.sensor,
        builder: (context, r, _) {
          if (r == null) return Text('Warte auf Sensordaten …', style: text.bodyMedium);
          if (!r.available) return Text('Die Kamera liefert keine Lagewerte (alle 0).', style: text.bodyMedium);
          return Row(children: [
            SizedBox.square(dimension: 96, child: CustomPaint(painter: _DialPainter(r, Theme.of(context).colorScheme))),
            const SizedBox(width: 16),
            Expanded(
              child: Wrap(spacing: 16, runSpacing: 12, children: [
                _Value('Drehung', '${r.roll.toStringAsFixed(1)}°', big: true),
                _Value('Neigung', '${r.pitch.toStringAsFixed(1)}°', big: true),
                _Value('Roh x / y / z', '${r.x} / ${r.y} / ${r.z}', mono: true),
                _Value('Header-Byte 0 / 5', '${_hex(r.flags.$1)} / ${_hex(r.flags.$2)}', mono: true),
              ]),
            ),
          ]);
        },
      ),
      const SizedBox(height: 16),
      Text('STABILISIERUNG', style: text.labelSmall),
      SwitchListTile(
        contentPadding: EdgeInsets.zero,
        title: const Text('Bild stabilisieren'),
        value: s.enabled,
        onChanged: (v) => controller.setStabilize(s.copyWith(enabled: v)),
      ),
      SwitchListTile(
        contentPadding: EdgeInsets.zero,
        title: const Text('Richtung umkehren'),
        value: s.invert,
        onChanged: s.enabled ? (v) => controller.setStabilize(s.copyWith(invert: v)) : null,
      ),
      Row(children: [
        const Expanded(child: Text('Versatz')),
        DropdownButton<int>(
          value: s.offset,
          onChanged: s.enabled ? (v) => controller.setStabilize(s.copyWith(offset: v)) : null,
          items: [for (final o in [0, 90, 180, 270]) DropdownMenuItem(value: o, child: Text('$o°'))],
        ),
      ]),
    ]);
  }
}

class _Value extends StatelessWidget {
  const _Value(this.label, this.value, {this.big = false, this.mono = false});
  final String label;
  final String value;
  final bool big;
  final bool mono;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return SizedBox(
      width: big ? 90 : 170,
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(label, style: text.labelSmall?.copyWith(color: Theme.of(context).colorScheme.onSurfaceVariant)),
        Text(
          value,
          style: (big ? text.titleLarge : text.bodyMedium)?.copyWith(
            fontFeatures: const [FontFeature.tabularFigures()],
            fontFamily: mono ? 'monospace' : null,
            fontFamilyFallback: mono ? const ['Menlo', 'Courier New', 'Courier'] : null,
          ),
        ),
      ]),
    );
  }
}

/// Lageanzeige: Zeiger = Drehung (0° oben, im Uhrzeigersinn), Punkt = Neigung.
class _DialPainter extends CustomPainter {
  _DialPainter(this.r, this.scheme);
  final SensorReading r;
  final ColorScheme scheme;

  @override
  void paint(Canvas canvas, Size size) {
    final c = size.center(Offset.zero);
    final radius = size.shortestSide / 2 - 2;
    canvas.drawCircle(c, radius, Paint()..color = scheme.surfaceContainerHighest);
    canvas.drawCircle(c, radius, Paint()..style = PaintingStyle.stroke..strokeWidth = 2..color = scheme.outlineVariant);
    canvas.drawLine(c.translate(0, -radius), c.translate(0, -radius + 8), Paint()..strokeWidth = 2..color = scheme.onSurfaceVariant);
    final a = (r.roll - 90) * math.pi / 180;
    final len = radius * 0.78;
    canvas.drawLine(c, c + Offset(math.cos(a) * len, math.sin(a) * len),
        Paint()..strokeWidth = 3.5..strokeCap = StrokeCap.round..color = scheme.primary);
    canvas.drawCircle(c, 3, Paint()..color = scheme.primary);
    final py = -(r.pitch.clamp(-90, 90) / 90) * len;
    canvas.drawCircle(c.translate(0, py), 4.5, Paint()..color = scheme.onSurfaceVariant.withValues(alpha: 0.8));
  }

  @override
  bool shouldRepaint(_DialPainter old) => old.r != r || old.scheme != scheme;
}
