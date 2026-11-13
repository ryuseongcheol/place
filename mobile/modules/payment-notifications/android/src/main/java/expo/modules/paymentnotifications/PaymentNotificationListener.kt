package expo.modules.paymentnotifications

import android.Manifest
import android.annotation.SuppressLint
import android.app.Notification
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationManager
import android.os.Build
import android.os.Bundle
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Log
import androidx.core.content.ContextCompat
import org.json.JSONObject

/**
 * 시스템이 모든 알림을 넘겨주면, 결제 알림처럼 보이는 것(금액 + 승인/결제/사용 등)만 골라 저장한다.
 * 가게 찾기·정리는 앱(JS)이 한다. 여기서는 "결제 순간"의 시각과 위치를 남기는 것이 목적.
 * 연결될 때와 앱이 요청할 때(지금 가져오기) 알림창에 떠 있는 알림도 훑는다.
 */
class PaymentNotificationListener : NotificationListenerService() {
  companion object {
    const val TAG = "PayNoti"
    /** 연결돼 있는 리스너 (앱에서 알림창 다시 훑기에 사용) */
    @Volatile var instance: PaymentNotificationListener? = null

    private val AMOUNT = Regex("[0-9][0-9,]{2,}\\s*원")
    private val PAYMENT_WORDS = Regex("승인|결제|사용|일시불|할부|체크|출금")
    /** 메신저·문자 앱은 친구 대화도 오므로 카드 승인 문구가 확실할 때만 */
    private val STRICT_WORDS = Regex("승인|일시불|할부|누적|체크카드|결제\\s*(완료|되었|됐)|사용\\s*(완료|되었)")
    private val MESSENGERS = setOf(
      "com.kakao.talk",
      "com.samsung.android.messaging",
      "com.google.android.apps.messaging",
      "com.android.mms",
      "com.android.messaging",
      "com.lge.message",
      "com.nhn.android.line",
      "jp.naver.line.android",
    )
    private val SKIP_PACKAGES = setOf("android", "com.android.systemui")
  }

  override fun onListenerConnected() {
    instance = this
    PaymentStore.mark(this, "connectedAt")
    Log.i(TAG, "listener connected")
    // 켜기 전부터 알림창에 남아 있던 결제 알림도 가져온다
    scanActive()
  }

  override fun onListenerDisconnected() {
    if (instance === this) instance = null
    PaymentStore.mark(this, "disconnectedAt")
    Log.i(TAG, "listener disconnected")
  }

  override fun onDestroy() {
    if (instance === this) instance = null
    super.onDestroy()
  }

  override fun onNotificationPosted(sbn: StatusBarNotification?) {
    if (sbn != null && capture(sbn, fromScan = false)) Log.i(TAG, "captured ${sbn.packageName}")
  }

  /** 알림창에 떠 있는 알림 중 결제 알림을 저장. 새로 저장한 수 */
  fun scanActive(): Int {
    val list = try { activeNotifications } catch (e: Exception) { Log.w(TAG, "activeNotifications failed", e); null } ?: return 0
    var n = 0
    for (sbn in list) if (capture(sbn, fromScan = true)) n++
    Log.i(TAG, "scanned ${list.size} active, captured $n")
    return n
  }

  private fun textOf(ex: Bundle): String {
    val parts = LinkedHashSet<String>()
    ex.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString()?.let { parts.add(it) }
    ex.getCharSequenceArray(Notification.EXTRA_TEXT_LINES)?.joinToString("\n")?.let { parts.add(it) }
    ex.getCharSequence(Notification.EXTRA_TEXT)?.toString()?.let { parts.add(it) }
    // 메신저형 알림: 마지막 메시지 본문
    try {
      @Suppress("DEPRECATION")
      val msgs = ex.getParcelableArray(Notification.EXTRA_MESSAGES)
      val last = msgs?.lastOrNull() as? Bundle
      last?.getCharSequence("text")?.toString()?.let { parts.add(it) }
    } catch (e: Exception) {}
    // 짧은 본문이 긴 본문에 포함되면 뺀다
    val list = parts.map { it.trim() }.filter { it.isNotEmpty() }
    return list.filter { p -> list.none { o -> o !== p && o.length > p.length && o.contains(p) } }.joinToString("\n")
  }

  private fun capture(sbn: StatusBarNotification, fromScan: Boolean): Boolean {
    try {
      if (sbn.packageName == packageName || sbn.packageName in SKIP_PACKAGES) return false
      val n = sbn.notification ?: return false
      if (n.flags and Notification.FLAG_GROUP_SUMMARY != 0) return false
      if (n.flags and Notification.FLAG_ONGOING_EVENT != 0) return false
      val ex = n.extras ?: return false
      val title = ex.getCharSequence(Notification.EXTRA_TITLE)?.toString() ?: ""
      val text = textOf(ex)
      val sub = ex.getCharSequence(Notification.EXTRA_SUB_TEXT)?.toString() ?: ""
      val all = "$title\n$text"
      if (!AMOUNT.containsMatchIn(all)) return false
      val words = if (sbn.packageName in MESSENGERS) STRICT_WORDS else PAYMENT_WORDS
      if (!words.containsMatchIn(all)) return false

      val item = JSONObject()
        .put("key", "${sbn.packageName}|${sbn.postTime}|${all.hashCode()}")
        .put("package", sbn.packageName)
        .put("title", title)
        .put("text", text)
        .put("sub", sub)
        .put("postedAt", sbn.postTime)
      // 위치는 결제 순간 근처일 때만 (알림창에 오래 남아 있던 것엔 붙이지 않음)
      if (!fromScan || System.currentTimeMillis() - sbn.postTime < 30 * 60 * 1000L) {
        lastLocation(this)?.let {
          item.put("lat", it.latitude).put("lng", it.longitude).put("locAt", it.time).put("accuracy", it.accuracy.toDouble())
        }
      }
      return PaymentStore.add(this, item)
    } catch (e: Exception) {
      Log.w(TAG, "failed to read notification", e)
      return false
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
