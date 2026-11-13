package expo.modules.paymentnotifications

import android.Manifest
import android.annotation.SuppressLint
import android.app.Notification
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationManager
import android.os.Build
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Log
import androidx.core.content.ContextCompat
import org.json.JSONObject

/**
 * 시스템이 모든 알림을 넘겨주면, 결제 알림처럼 보이는 것(금액 + 승인/결제/사용 등)만 골라 저장한다.
 * 가게 찾기·정리는 앱(JS)이 한다. 여기서는 "결제 순간"의 시각과 위치를 남기는 것이 목적.
 */
class PaymentNotificationListener : NotificationListenerService() {
  companion object {
    const val TAG = "PayNoti"
    private val AMOUNT = Regex("[0-9][0-9,]{2,}\\s*원")
    private val PAYMENT_WORDS = Regex("승인|결제|사용|일시불|할부|체크|출금")
    /** 결제 알림을 보내는 앱이 아니어도(문자 앱 등) 문구로 판별하지만, 이 앱들은 확실히 본다 */
    private val SKIP_PACKAGES = setOf("android", "com.android.systemui")
  }

  override fun onListenerConnected() {
    PaymentStore.mark(this, "connectedAt")
    Log.i(TAG, "listener connected")
  }

  override fun onListenerDisconnected() {
    PaymentStore.mark(this, "disconnectedAt")
    Log.i(TAG, "listener disconnected")
  }

  override fun onNotificationPosted(sbn: StatusBarNotification?) {
    try {
      if (sbn == null) return
      if (sbn.packageName == packageName || sbn.packageName in SKIP_PACKAGES) return
      val n = sbn.notification ?: return
      if (n.flags and Notification.FLAG_GROUP_SUMMARY != 0) return
      if (n.flags and Notification.FLAG_ONGOING_EVENT != 0) return
      val ex = n.extras ?: return
      val title = ex.getCharSequence(Notification.EXTRA_TITLE)?.toString() ?: ""
      val big = ex.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString()
      val lines = ex.getCharSequenceArray(Notification.EXTRA_TEXT_LINES)?.joinToString("\n")
      val text = big ?: lines ?: ex.getCharSequence(Notification.EXTRA_TEXT)?.toString() ?: ""
      val sub = ex.getCharSequence(Notification.EXTRA_SUB_TEXT)?.toString() ?: ""
      val all = "$title\n$text"
      if (!AMOUNT.containsMatchIn(all) || !PAYMENT_WORDS.containsMatchIn(all)) return

      val item = JSONObject()
        .put("key", "${sbn.packageName}|${sbn.postTime}|${all.hashCode()}")
        .put("package", sbn.packageName)
        .put("title", title)
        .put("text", text)
        .put("sub", sub)
        .put("postedAt", sbn.postTime)
      lastLocation(this)?.let {
        item.put("lat", it.latitude).put("lng", it.longitude).put("locAt", it.time).put("accuracy", it.accuracy.toDouble())
      }
      if (PaymentStore.add(this, item)) Log.i(TAG, "captured ${sbn.packageName}: ${title.take(20)}")
    } catch (e: Exception) {
      Log.w(TAG, "failed to read notification", e)
    }
  }

  /** 휴대폰이 마지막으로 알고 있는 위치 (켜져 있는 제공자 중 가장 최근 것) */
  @SuppressLint("MissingPermission") // 위에서 권한 확인
  private fun lastLocation(ctx: Context): Location? {
    val fine = ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
    val coarse = ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
    if (!fine && !coarse) return null
    val lm = ctx.getSystemService(Context.LOCATION_SERVICE) as? LocationManager ?: return null
    val providers = mutableListOf(LocationManager.PASSIVE_PROVIDER, LocationManager.NETWORK_PROVIDER, LocationManager.GPS_PROVIDER)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) providers.add(0, LocationManager.FUSED_PROVIDER)
    var best: Location? = null
    for (p in providers) {
      val loc = try { lm.getLastKnownLocation(p) } catch (e: Exception) { null } ?: continue
      if (best == null || loc.time > best.time) best = loc
    }
    return best
  }
}
