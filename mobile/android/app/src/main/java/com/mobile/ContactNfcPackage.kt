package com.mobile

import android.app.Activity
import android.content.ComponentName
import android.content.pm.PackageManager
import android.nfc.NfcAdapter
import android.nfc.cardemulation.CardEmulation
import android.nfc.tech.IsoDep
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.common.LifecycleState
import com.facebook.react.uimanager.ViewManager

class ContactNfcPackage : ReactPackage {
  @Suppress("OVERRIDE_DEPRECATION")
  override fun createNativeModules(reactContext: ReactApplicationContext) =
    listOf(ContactNfcModule(reactContext))

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
    emptyList()
}

class ContactNfcModule(private val context: ReactApplicationContext) :
  ReactContextBaseJavaModule(context), LifecycleEventListener {
  private val adapter get() = NfcAdapter.getDefaultAdapter(context)
  private val canShare get() = context.packageManager.hasSystemFeature(PackageManager.FEATURE_NFC_HOST_CARD_EMULATION)
  private var sharingActivity: Activity? = null
  private var reading: ReadSession? = null

  private class ReadSession(val activity: Activity, val adapter: NfcAdapter, val promise: Promise)

  override fun getName() = "EbpContactNfc"

  override fun initialize() {
    super.initialize()
    context.addLifecycleEventListener(this)
  }

  @ReactMethod
  fun getCapabilities(promise: Promise) {
    val supported = adapter != null
    promise.resolve(Arguments.createMap().apply {
      putBoolean("share", supported && canShare)
      putBoolean("receive", supported)
    })
  }

  @ReactMethod
  fun startSharing(payload: String, promise: Promise) {
    UiThreadUtil.runOnUiThread {
      try {
        val activity = foregroundActivity()
        val nfc = enabledAdapter()
        require(canShare) { "This phone does not support sharing contacts via NFC." }
        require(payload.length in 1..ContactNfcProtocol.maxPayloadBytes &&
          payload.all { it == '\n' || it in ' '..'~' }) { "Invalid NFC contact data." }
        check(reading == null) { "Stop receiving before sharing via NFC." }
        val preferred = CardEmulation.getInstance(nfc)
          .setPreferredService(activity, ComponentName(context, ContactNfcService::class.java))
        check(preferred) { "Could not start NFC sharing." }
        sharingActivity = activity
        ContactNfcService.payload = payload.toByteArray(Charsets.US_ASCII)
        promise.resolve(null)
      } catch (error: Exception) {
        promise.reject("nfc_share_failed", error.message ?: "Could not start NFC sharing.", error)
      }
    }
  }

  @ReactMethod
  fun stopSharing() {
    UiThreadUtil.runOnUiThread { clearSharing() }
  }

  @ReactMethod
  fun receive(promise: Promise) {
    UiThreadUtil.runOnUiThread {
      try {
        val activity = foregroundActivity()
        val nfc = enabledAdapter()
        check(reading == null && sharingActivity == null) { "Another NFC session is active." }
        val session = ReadSession(activity, nfc, promise)
        nfc.enableReaderMode(activity, { tag ->
          val technology = IsoDep.get(tag) ?: return@enableReaderMode
          val result = runCatching {
            technology.use {
              it.connect()
              it.timeout = 1000
              ContactNfcProtocol.receive(it::transceive)
            }
          }
          UiThreadUtil.runOnUiThread {
            if (reading === session) {
              closeReader()
              result.fold(promise::resolve) {
                promise.reject("nfc_read_failed", "Could not read an EBP contact. Bring the phones together and try again.", it)
              }
            }
          }
        }, NfcAdapter.FLAG_READER_NFC_A or NfcAdapter.FLAG_READER_SKIP_NDEF_CHECK, null)
        reading = session
      } catch (error: Exception) {
        promise.reject("nfc_read_failed", error.message ?: "Could not start NFC receiving.", error)
      }
    }
  }

  @ReactMethod
  fun cancelReceive() {
    UiThreadUtil.runOnUiThread { cancelReader() }
  }

  private fun foregroundActivity(): Activity {
    check(context.lifecycleState == LifecycleState.RESUMED) { "Open EBP to use NFC." }
    return checkNotNull(context.currentActivity) { "Open EBP to use NFC." }
  }

  private fun enabledAdapter(): NfcAdapter {
    val nfc = checkNotNull(adapter) { "This phone does not support NFC." }
    check(nfc.isEnabled) { "Turn on NFC in Android settings and try again." }
    return nfc
  }

  private fun clearSharing() {
    val activity = sharingActivity ?: return
    ContactNfcService.payload = null
    sharingActivity = null
    // Android also clears the foreground preference as the activity pauses.
    runCatching { adapter?.let { CardEmulation.getInstance(it).unsetPreferredService(activity) } }
  }

  private fun closeReader(): ReadSession? {
    val session = reading ?: return null
    reading = null
    runCatching { session.adapter.disableReaderMode(session.activity) }
    return session
  }

  private fun cancelReader() {
    closeReader()?.promise?.reject("nfc_cancelled", "NFC receiving stopped.")
  }

  override fun onHostResume() = Unit

  override fun onHostPause() {
    clearSharing()
    cancelReader()
  }

  override fun onHostDestroy() = onHostPause()

  override fun invalidate() {
    context.removeLifecycleEventListener(this)
    UiThreadUtil.runOnUiThread { onHostPause() }
    super.invalidate()
  }
}
