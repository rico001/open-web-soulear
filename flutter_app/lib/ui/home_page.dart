import 'package:flutter/material.dart';

import '../src/app_controller.dart';
import '../src/camera_client.dart';
import 'device_tab.dart';
import 'live_view.dart';
import 'photos_tab.dart';
import 'sensor_tab.dart';

/// Breit (ab 840 dp): Livebild links, Seitenleiste mit Tabs rechts.
/// Schmal (Handy): Livebild oben, Bedienleiste, Tabs füllen den Rest.
class HomePage extends StatelessWidget {
  const HomePage({super.key, required this.controller});
  final AppController controller;

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: controller,
      builder: (context, _) => DefaultTabController(
        length: 3,
        child: Scaffold(
          appBar: AppBar(
            titleSpacing: 12,
            title: Row(children: [
              Icon(Icons.videocam, color: Theme.of(context).colorScheme.primary),
              const SizedBox(width: 10),
              const Flexible(child: Text('Soulear lokal', overflow: TextOverflow.ellipsis)),
            ]),
            actions: [
              ValueListenableBuilder(
                valueListenable: controller.status,
                builder: (context, s, _) => _StatusChips(status: s),
              ),
              const SizedBox(width: 8),
            ],
          ),
          body: SafeArea(
            child: LayoutBuilder(builder: (context, c) {
              final wide = c.maxWidth >= 840;
              final live = _LiveCard(controller: controller, wide: wide);
              final side = _SidePanel(controller: controller);
              if (wide) {
                return Padding(
                  padding: const EdgeInsets.all(16),
                  child: Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                    Expanded(child: live),
                    const SizedBox(width: 16),
                    SizedBox(width: c.maxWidth >= 1200 ? 440 : 380, child: side),
                  ]),
                );
              }
              // Genug Höhe: alles auf einem Bildschirm, Tabs füllen den Rest.
              // Kleine Handys: Seite scrollt, Tabs bekommen eine feste Höhe.
              if (c.maxHeight >= 720) {
                return Padding(
                  padding: const EdgeInsets.all(12),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                    live,
                    const SizedBox(height: 12),
                    Expanded(child: side),
                  ]),
                );
              }
              return SingleChildScrollView(
                padding: const EdgeInsets.all(12),
                child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                  live,
                  const SizedBox(height: 12),
                  SizedBox(height: 420, child: side),
                ]),
              );
            }),
          ),
        ),
      ),
    );
  }
}

class _StatusChips extends StatelessWidget {
  const _StatusChips({required this.status});
  final CameraStatus status;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final narrow = MediaQuery.sizeOf(context).width < 600;
    final battery = status.battery;
    return Row(mainAxisSize: MainAxisSize.min, children: [
      Tooltip(
        message: status.connected ? 'verbunden' : 'getrennt',
        child: Icon(status.connected ? Icons.link : Icons.link_off, color: status.connected ? Colors.green : scheme.error),
      ),
      if (status.connected && !narrow) ...[
        const SizedBox(width: 12),
        Text('${status.fps.toStringAsFixed(1)} fps', style: Theme.of(context).textTheme.labelLarge),
      ],
      if (battery != null) ...[
        const SizedBox(width: 12),
        Icon(_batteryIcon(battery, status.charging), size: 20, color: battery < 15 ? scheme.error : null),
        Text(' $battery %', style: Theme.of(context).textTheme.labelLarge),
      ],
    ]);
  }

  static IconData _batteryIcon(int level, bool charging) {
    if (charging) return Icons.battery_charging_full;
    if (level >= 95) return Icons.battery_full;
    if (level < 10) return Icons.battery_alert;
    const bars = [
      Icons.battery_0_bar,
      Icons.battery_1_bar,
      Icons.battery_2_bar,
      Icons.battery_3_bar,
      Icons.battery_4_bar,
      Icons.battery_5_bar,
      Icons.battery_6_bar,
    ];
    return bars[(level / (100 / 7)).floor().clamp(0, 6)];
  }
}

class _LiveCard extends StatelessWidget {
  const _LiveCard({required this.controller, required this.wide});
  final AppController controller;
  final bool wide;

  @override
  Widget build(BuildContext context) {
    final view = LiveView(controller: controller);
    return Card.outlined(
      clipBehavior: Clip.antiAlias,
      margin: EdgeInsets.zero,
      child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        if (wide)
          Expanded(child: view)
        else
          // Handy: Bild max. 55 % der Höhe, sonst 4:3 bzw. quadratisch (stabilisiert).
          ConstrainedBox(
            constraints: BoxConstraints(maxHeight: MediaQuery.sizeOf(context).height * 0.55),
            child: AspectRatio(aspectRatio: controller.stabilize.enabled ? 1 : 4 / 3, child: view),
          ),
        ValueListenableBuilder(
          valueListenable: controller.status,
          builder: (context, s, _) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            if (s.error != null)
              MaterialBanner(
                content: Text(s.error!),
                leading: const Icon(Icons.error_outline),
                backgroundColor: Theme.of(context).colorScheme.errorContainer,
                actions: const [SizedBox.shrink()],
              ),
            _Controls(controller: controller, status: s),
          ]),
        ),
      ]),
    );
  }
}

class _Controls extends StatelessWidget {
  const _Controls({required this.controller, required this.status});
  final AppController controller;
  final CameraStatus status;

  @override
  Widget build(BuildContext context) {
    final ledOn = (status.led ?? 0) > 0;
    final stab = controller.stabilize.enabled;
    Future<void> photo() async {
      final msg = await controller.takePhoto();
      if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
    }

    final photoBtn = FilledButton.icon(
      onPressed: status.connected ? photo : null,
      icon: const Icon(Icons.photo_camera),
      label: const Text('Foto aufnehmen'),
      style: FilledButton.styleFrom(minimumSize: const Size(0, 48)),
    );
    final ledBtn = ledOn
        ? FilledButton.tonalIcon(
            onPressed: status.connected ? controller.toggleLed : null,
            icon: const Icon(Icons.flashlight_on),
            label: const Text('LED an'))
        : OutlinedButton.icon(
            onPressed: status.connected ? controller.toggleLed : null,
            icon: const Icon(Icons.flashlight_off),
            label: const Text('LED aus'));
    final stabBtn = stab
        ? FilledButton.tonalIcon(
            onPressed: () => controller.setStabilize(controller.stabilize.copyWith(enabled: false)),
            icon: const Icon(Icons.screen_rotation),
            label: const Text('Stabilisieren'))
        : OutlinedButton.icon(
            onPressed: () => controller.setStabilize(controller.stabilize.copyWith(enabled: true)),
            icon: const Icon(Icons.screen_rotation),
            label: const Text('Stabilisieren'));
    final reconnect = IconButton(
      tooltip: 'Neu verbinden',
      onPressed: controller.connecting ? null : controller.connect,
      icon: controller.connecting
          ? const SizedBox.square(dimension: 20, child: CircularProgressIndicator(strokeWidth: 2))
          : const Icon(Icons.refresh),
    );

    return Padding(
      padding: const EdgeInsets.all(8),
      child: LayoutBuilder(builder: (context, c) {
        if (c.maxWidth < 700) {
          return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            photoBtn,
            const SizedBox(height: 8),
            Row(children: [
              Expanded(child: ledBtn),
              const SizedBox(width: 8),
              Expanded(child: stabBtn),
              reconnect,
            ]),
          ]);
        }
        return Row(children: [
          photoBtn,
          const SizedBox(width: 8),
          ledBtn,
          const SizedBox(width: 8),
          stabBtn,
          const Spacer(),
          reconnect,
        ]);
      }),
    );
  }
}

class _SidePanel extends StatelessWidget {
  const _SidePanel({required this.controller});
  final AppController controller;

  /// Icon und Text nebeneinander – flacher als Material-Standard (48 statt 72 dp).
  static Widget _tab(IconData icon, String label) => Tab(
        height: 48,
        child: Row(mainAxisSize: MainAxisSize.min, children: [
          Icon(icon, size: 20),
          const SizedBox(width: 6),
          Flexible(child: Text(label, overflow: TextOverflow.ellipsis, softWrap: false)),
        ]),
      );

  @override
  Widget build(BuildContext context) {
    return Card.outlined(
      clipBehavior: Clip.antiAlias,
      margin: EdgeInsets.zero,
      child: Column(children: [
        TabBar(labelPadding: const EdgeInsets.symmetric(horizontal: 8), tabs: [
          _tab(Icons.explore_outlined, 'Lage'),
          _tab(Icons.photo_library_outlined, 'Fotos (${controller.photos.length})'),
          _tab(Icons.memory, 'Gerät'),
        ]),
        Expanded(
          child: TabBarView(children: [
            SensorTab(controller: controller),
            PhotosTab(controller: controller),
            DeviceTab(controller: controller),
          ]),
        ),
      ]),
    );
  }
}
