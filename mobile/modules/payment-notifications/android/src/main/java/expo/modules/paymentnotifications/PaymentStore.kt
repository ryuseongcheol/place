package expo.modules.paymentnotifications

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * 받은 결제 알림을 앱이 가져갈 때까지 보관한다 (SharedPreferences, 최대 300건).
 * 앱(JS)이 getPending 으로 읽고 ack 로 지운다.
 */
object PaymentStore {
  private const val PREFS = "matjip_payment_notifications"
  private const val KEY_PENDING = "pending"
  private const val MAX = 300

  private fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  @Synchronized
  fun add(ctx: Context, item: JSONObject): Boolean {
    val arr = pending(ctx)
    val key = item.optString("key")
    for (i in 0 until arr.length()) {
      // 같은 알림이 갱신돼서 다시 들어오면 무시
      if (arr.optJSONObject(i)?.optString("key") == key) return false
    }
    arr.put(item)
    val trimmed = if (arr.length() > MAX) JSONArray().also { out ->
      for (i in arr.length() - MAX until arr.length()) out.put(arr.get(i))
    } else arr
    prefs(ctx).edit()
      .putString(KEY_PENDING, trimmed.toString())
      .putLong("lastCapturedAt", System.currentTimeMillis())
      .putInt("capturedCount", prefs(ctx).getInt("capturedCount", 0) + 1)
      .apply()
    return true
  }

  @Synchronized
  fun pending(ctx: Context): JSONArray =
    try { JSONArray(prefs(ctx).getString(KEY_PENDING, "[]")) } catch (e: Exception) { JSONArray() }

  /** postedAt 이 maxPostedAt 이하인 항목을 지운다 (앱이 처리를 마친 것) */
  @Synchronized
  fun ack(ctx: Context, maxPostedAt: Long) {
    val arr = pending(ctx)
    val out = JSONArray()
    for (i in 0 until arr.length()) {
      val o = arr.optJSONObject(i) ?: continue
      if (o.optLong("postedAt") > maxPostedAt) out.put(o)
    }
    prefs(ctx).edit().putString(KEY_PENDING, out.toString()).apply()
  }

  fun mark(ctx: Context, key: String) {
    prefs(ctx).edit().putLong(key, System.currentTimeMillis()).apply()
  }

  fun status(ctx: Context): Map<String, Any?> {
    val p = prefs(ctx)
    return mapOf(
      "connectedAt" to p.getLong("connectedAt", 0L).takeIf { it > 0 }?.toDouble(),
      "disconnectedAt" to p.getLong("disconnectedAt", 0L).takeIf { it > 0 }?.toDouble(),
      "lastCapturedAt" to p.getLong("lastCapturedAt", 0L).takeIf { it > 0 }?.toDouble(),
      "capturedCount" to p.getInt("capturedCount", 0),
      "pendingCount" to pending(ctx).length(),
    )
  }
}
