import 'dart:io';

import 'package:flutter/material.dart';

import '../src/app_controller.dart';

class PhotosTab extends StatelessWidget {
  const PhotosTab({super.key, required this.controller});
  final AppController controller;

  @override
  Widget build(BuildContext context) {
    final photos = controller.photos;
    if (photos.isEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            Icon(Icons.photo_library_outlined, size: 40, color: Theme.of(context).colorScheme.onSurfaceVariant),
            const SizedBox(height: 8),
            const Text('Noch keine Fotos. „Foto aufnehmen“ speichert das aktuelle Bild – in der App und in der Galerie.',
                textAlign: TextAlign.center),
          ]),
        ),
      );
    }
    return GridView.builder(
      padding: const EdgeInsets.all(8),
      gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
        maxCrossAxisExtent: 180,
        childAspectRatio: 4 / 3,
        mainAxisSpacing: 8,
        crossAxisSpacing: 8,
      ),
      itemCount: photos.length,
      itemBuilder: (context, i) {
        final f = photos[i];
        return ClipRRect(
          borderRadius: BorderRadius.circular(10),
          child: Stack(fit: StackFit.expand, children: [
            GestureDetector(
              onTap: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => _PhotoPage(file: f))),
              child: Image.file(f, fit: BoxFit.cover, cacheWidth: 360),
            ),
            Positioned(
              left: 0,
              right: 0,
              bottom: 0,
              child: DecoratedBox(
                decoration: const BoxDecoration(
                  gradient: LinearGradient(
                    begin: Alignment.topCenter,
                    end: Alignment.bottomCenter,
                    colors: [Colors.transparent, Colors.black87],
                  ),
                ),
                child: Row(children: [
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(_label(f),
                        style: const TextStyle(color: Colors.white, fontSize: 11), overflow: TextOverflow.ellipsis),
                  ),
                  IconButton(
                    tooltip: 'Löschen',
                    iconSize: 18,
                    color: Colors.white,
                    icon: const Icon(Icons.delete_outline),
                    onPressed: () => _confirmDelete(context, f),
                  ),
                ]),
              ),
            ),
          ]),
        );
      },
    );
  }

  /// „20260930-220654-123.jpg“ → „30.09. 22:06:54“
  static String _label(File f) {
    final n = f.uri.pathSegments.last;
    if (n.length < 15) return n;
    return '${n.substring(6, 8)}.${n.substring(4, 6)}. ${n.substring(9, 11)}:${n.substring(11, 13)}:${n.substring(13, 15)}';
  }

  Future<void> _confirmDelete(BuildContext context, File f) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Foto löschen?'),
        content: const Text('Das Foto wird aus der App gelöscht. Die Kopie in der Galerie bleibt erhalten.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Abbrechen')),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Löschen')),
        ],
      ),
    );
    if (ok == true) await controller.deletePhoto(f);
  }
}

class _PhotoPage extends StatelessWidget {
  const _PhotoPage({required this.file});
  final File file;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(backgroundColor: Colors.black, foregroundColor: Colors.white, title: Text(PhotosTab._label(file))),
      body: InteractiveViewer(maxScale: 8, child: Center(child: Image.file(file))),
    );
  }
}
