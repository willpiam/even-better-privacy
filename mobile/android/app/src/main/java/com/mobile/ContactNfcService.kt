package com.mobile

import android.app.KeyguardManager
import android.nfc.cardemulation.HostApduService
import android.os.Bundle

internal object ContactNfcProtocol {
  const val maxPayloadBytes = 8192
  private const val chunkSize = 240
  // The app-specific AID is also registered in contact_nfc_service.xml.
  private val aid = byteArrayOf(0xf0.toByte(), 0x45, 0x42, 0x50, 0x43, 0x4f, 0x4e, 0x54, 0x01)
  val select = byteArrayOf(0, 0xa4.toByte(), 0x04, 0, aid.size.toByte()) + aid
  val success = byteArrayOf(0x90.toByte(), 0)
  val unavailable = byteArrayOf(0x6a, 0x82.toByte())

  fun lengthBytes(length: Int) = byteArrayOf((length shr 8).toByte(), length.toByte())

  fun readLength(bytes: ByteArray, offset: Int = 0) =
    ((bytes[offset].toInt() and 0xff) shl 8) or (bytes[offset + 1].toInt() and 0xff)

  fun readChunk(payload: ByteArray, command: ByteArray): ByteArray {
    if (command.size != 5 || command[0] != 0.toByte() || command[1] != 0xb0.toByte()) {
      return byteArrayOf(0x6d, 0)
    }
    val offset = readLength(command, 2)
    val count = command[4].toInt() and 0xff
    if (count !in 1..chunkSize || offset + count > payload.size) {
      return byteArrayOf(0x6b, 0)
    }
    return payload.copyOfRange(offset, offset + count) + success
  }

  fun receive(transceive: (ByteArray) -> ByteArray): String {
    val header = responseData(transceive(select), 2)
    val length = readLength(header)
    require(length in 1..maxPayloadBytes) { "Invalid NFC contact size." }
    val payload = ByteArray(length)
    for (offset in 0 until length step chunkSize) {
      val count = minOf(chunkSize, length - offset)
      val command = byteArrayOf(0, 0xb0.toByte()) + lengthBytes(offset) + count.toByte()
      responseData(transceive(command), count).copyInto(payload, offset)
    }
    return payload.toString(Charsets.US_ASCII)
  }

  private fun responseData(response: ByteArray, count: Int): ByteArray {
    require(response.size == count + 2 && readLength(response, count) == 0x9000) {
      "Could not read an EBP NFC contact."
    }
    return response.copyOf(count)
  }
}

class ContactNfcService : HostApduService() {
  companion object {
    // Accessed only on the main thread, including the service callbacks.
    internal var payload: ByteArray? = null
  }

  private var selected: ByteArray? = null

  override fun processCommandApdu(command: ByteArray, extras: Bundle?): ByteArray {
    val current = payload
    if (command.contentEquals(ContactNfcProtocol.select)) {
      // A foreground service preference can override the manifest's lock setting.
      val unlocked = getSystemService(KeyguardManager::class.java)?.isDeviceLocked == false
      selected = current?.takeIf { unlocked }
      return selected?.let { ContactNfcProtocol.lengthBytes(it.size) + ContactNfcProtocol.success }
        ?: ContactNfcProtocol.unavailable
    }
    if (current == null || selected !== current) return ContactNfcProtocol.unavailable
    return ContactNfcProtocol.readChunk(current, command)
  }

  override fun onDeactivated(reason: Int) {
    selected = null
  }
}
