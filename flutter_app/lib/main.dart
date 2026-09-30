import 'package:flutter/material.dart';

import 'src/app_controller.dart';
import 'ui/home_page.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  final controller = AppController();
  runApp(SoulearApp(controller: controller));
  controller.init();
}

class SoulearApp extends StatelessWidget {
  const SoulearApp({super.key, required this.controller});
  final AppController controller;

  @override
  Widget build(BuildContext context) {
    ThemeData theme(Brightness b) => ThemeData(
          colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFFEA580C), brightness: b),
          useMaterial3: true,
        );
    return MaterialApp(
      title: 'Soulear lokal',
      debugShowCheckedModeBanner: false,
      theme: theme(Brightness.light),
      darkTheme: theme(Brightness.dark),
      home: HomePage(controller: controller),
    );
  }
}
