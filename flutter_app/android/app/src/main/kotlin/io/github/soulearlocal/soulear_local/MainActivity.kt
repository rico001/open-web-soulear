package io.github.soulearlocal.soulear_local

import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

/**
 * Das Kamera-WLAN hat kein Internet – Android schickt Verbindungen dann über
 * die mobilen Daten, und die Kamera (192.168.1.1) ist nicht erreichbar.
 * Deshalb wird die ganze App vor dem Verbinden an das WLAN gebunden
 * (so macht es auch die Original-App, WifiCallBackFuc.bindSocket).
 */
class MainActivity : FlutterActivity() {
    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "soulear/network").setMethodCallHandler { call, result ->
            val cm = getSystemService(ConnectivityManager::class.java)
            when (call.method) {
                "bindToWifi" -> {
                    @Suppress("DEPRECATION")
                    val wifi = cm.allNetworks.firstOrNull {
                        cm.getNetworkCapabilities(it)?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true
                    }
                    result.success(wifi != null && cm.bindProcessToNetwork(wifi))
                }
                "unbind" -> result.success(cm.bindProcessToNetwork(null))
                else -> result.notImplemented()
            }
        }
    }
}
