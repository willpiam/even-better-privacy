package com.mobile

import android.system.Os
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.uimanager.ViewManager
import java.io.File
import java.io.FileOutputStream

class AtomicFileModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName() = "EbpAtomicFile"

  @ReactMethod
  fun write(path: String, content: String, promise: Promise) {
    var temporary: File? = null
    try {
      val target = File(path).canonicalFile
      val root = reactApplicationContext.filesDir.canonicalPath + File.separator
      require(target.path.startsWith(root)) { "Storage path must be inside app documents" }
      val parent = requireNotNull(target.parentFile)
      temporary = File.createTempFile("${target.name}.", ".tmp", parent)
      FileOutputStream(temporary).use { output ->
        output.write(content.toByteArray(Charsets.UTF_8))
        output.fd.sync()
      }
      // Same-directory POSIX rename replaces an existing file atomically.
      Os.rename(temporary.path, target.path)
      promise.resolve(null)
    } catch (error: Exception) {
      promise.reject("atomic_write_failed", "Could not save identity atomically", error)
    } finally {
      temporary?.delete()
    }
  }
}

class AtomicFilePackage : ReactPackage {
  override fun createNativeModules(context: ReactApplicationContext) = listOf(AtomicFileModule(context))
  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
