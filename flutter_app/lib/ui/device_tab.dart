import 'package:flutter/material.dart';

import '../src/app_controller.dart';

class DeviceTab extends StatefulWidget {
  const DeviceTab({super.key, required this.controller});
  final AppController controller;

  @override
  State<DeviceTab> createState() => _DeviceTabState();
}

class _DeviceTabState extends State<DeviceTab> {
  late final _ip = TextEditingController(text: widget.controller.cameraIp);

  @override
  void dispose() {
    _ip.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return ListView(padding: const EdgeInsets.all(16), children: [
      ValueListenableBuilder(
        valueListenable: widget.controller.status,
        builder: (context, s, _) {
          if (s.details.isEmpty) return Text('Keine Geräteangaben – Kamera nicht verbunden.', style: text.bodyMedium);
          return Wrap(spacing: 24, runSpacing: 12, children: [
            for (final e in s.details.entries)
              SizedBox(
                width: 140,
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(e.key, style: text.labelSmall?.copyWith(color: Theme.of(context).colorScheme.onSurfaceVariant)),
                  Text(e.value, style: text.bodyMedium),
                ]),
              ),
          ]);
        },
      ),
      const SizedBox(height: 24),
      Text('VERBINDUNG', style: text.labelSmall),
      const SizedBox(height: 8),
      Row(children: [
        Expanded(
          child: TextField(
            controller: _ip,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            decoration: const InputDecoration(labelText: 'Kamera-IP', border: OutlineInputBorder(), isDense: true),
            onSubmitted: widget.controller.setCameraIp,
          ),
        ),
        const SizedBox(width: 8),
        FilledButton.tonal(onPressed: () => widget.controller.setCameraIp(_ip.text), child: const Text('Verbinden')),
      ]),
      const SizedBox(height: 8),
      Text('Handy vorher mit dem WLAN der Kamera verbinden (SSID „Soulear-…“). Standard-IP: 192.168.1.1',
          style: text.bodySmall),
    ]);
  }
}
