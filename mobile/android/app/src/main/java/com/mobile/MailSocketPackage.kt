package com.mobile

import android.util.Base64
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule.RCTDeviceEventEmitter
import com.facebook.react.uimanager.ViewManager
import java.io.IOException
import java.net.InetSocketAddress
import java.net.Socket
import java.net.SocketTimeoutException
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.atomic.AtomicBoolean

class MailSocketPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext) = listOf(MailSocketModule(reactContext))
  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}

class MailSocketModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  private val connections = ConcurrentHashMap<Int, Connection>()
  private val readers = Executors.newCachedThreadPool()

  override fun getName() = "EbpMailSocket"

  @ReactMethod
  fun addListener(eventName: String) = Unit

  @ReactMethod
  fun removeListeners(count: Int) = Unit

  @ReactMethod
  fun connect(id: Int, host: String, port: Int, implicitTls: Boolean, timeoutMs: Int, ready: Promise) {
    val connection = Connection(id, host, port, timeoutMs.coerceAtLeast(1))
    if (connections.putIfAbsent(id, connection) != null) {
      connection.close()
      ready.reject("mail_connect_failed", "Mail connection already exists")
      return
    }
    try {
      readers.execute { connection.read(implicitTls, ready) }
    } catch (error: RejectedExecutionException) {
      connection.close()
      ready.reject("mail_connect_failed", error)
    }
  }

  @ReactMethod
  fun startTls(id: Int, ready: Promise) {
    val connection = connections[id]
    if (connection == null) ready.reject("mail_tls_failed", "Mail connection closed")
    else connection.requestUpgrade(ready)
  }

  @ReactMethod
  fun write(id: Int, data: String) {
    connections[id]?.write(data)
  }

  @ReactMethod
  fun close(id: Int) {
    connections[id]?.close()
  }

  override fun invalidate() {
    readers.shutdownNow()
    connections.values.forEach { it.close() }
    super.invalidate()
  }

  private fun emit(id: Int, type: String, data: String? = null) {
    val context = reactApplicationContext
    if (!context.hasActiveReactInstance()) return
    val event = Arguments.createMap().apply {
      putInt("id", id)
      putString("type", type)
      putString("data", data)
    }
    context.getJSModule(RCTDeviceEventEmitter::class.java).emit("EbpMailSocketEvent", event)
  }

  private inner class Connection(
    private val id: Int,
    private val host: String,
    private val port: Int,
    private val timeoutMs: Int,
  ) {
    private val tcp = Socket()
    private val closed = AtomicBoolean(false)
    private val writer = Executors.newSingleThreadExecutor()
    @Volatile private var transport = tcp
    @Volatile private var upgrade: Promise? = null

    @Synchronized
    fun requestUpgrade(ready: Promise) {
      if (closed.get() || transport !== tcp || upgrade != null) {
        ready.reject("mail_tls_failed", "Mail connection cannot start TLS")
      } else {
        upgrade = ready
      }
    }

    fun read(implicitTls: Boolean, ready: Promise) {
      var connected = false
      try {
        tcp.connect(InetSocketAddress(host, port), timeoutMs)
        if (implicitTls) {
          transport = MailTls.handshake(tcp, host, port, timeoutMs)
        } else {
          // The reader owns both the plaintext reads and the STARTTLS handshake.
          // A short read timeout lets it hand off an otherwise idle connection.
          tcp.soTimeout = 250
        }
        connected = true
        ready.resolve(null)
        val buffer = ByteArray(16_384)
        var input = transport.getInputStream()
        while (!closed.get()) {
          val pending = upgrade
          if (pending != null) {
            transport = MailTls.handshake(tcp, host, port, timeoutMs)
            input = transport.getInputStream()
            upgrade = null
            pending.resolve(null)
          }
          val count = try {
            input.read(buffer)
          } catch (error: SocketTimeoutException) {
            if (transport !== tcp) throw error
            continue
          }
          if (count < 0) break
          if (count > 0 && upgrade == null && !closed.get()) {
            emit(id, "data", Base64.encodeToString(buffer, 0, count, Base64.NO_WRAP))
          }
        }
      } catch (error: Exception) {
        val pending = upgrade
        if (!connected) ready.reject("mail_connect_failed", error)
        else if (pending != null) pending.reject("mail_tls_failed", error)
        else if (!closed.get()) emit(id, "error", error.message ?: "Mail connection failed")
      } finally {
        close()
        if (connected) emit(id, "close")
      }
    }

    fun write(data: String) {
      try {
        writer.execute {
          try {
            if (closed.get()) return@execute
            if (upgrade != null) throw IOException("TLS handshake is in progress")
            transport.getOutputStream().write(Base64.decode(data, Base64.NO_WRAP))
          } catch (error: Exception) {
            if (!closed.get()) emit(id, "error", error.message ?: "Mail write failed")
            close()
          }
        }
      } catch (_: RejectedExecutionException) {
        // A caller may still have a queued write after the connection closes.
      }
    }

    @Synchronized
    fun close() {
      if (!closed.compareAndSet(false, true)) return
      connections.remove(id, this)
      runCatching { tcp.close() }
      if (transport !== tcp) runCatching { transport.close() }
      writer.shutdownNow()
      upgrade?.reject("mail_tls_failed", "Mail connection closed during TLS handshake")
      upgrade = null
    }
  }
}
