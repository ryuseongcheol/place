package expo.modules.paymentnotifications

import android.content.ComponentName
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.service.notification.NotificationListenerService
import androidx.core.app.NotificationManagerCompat
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class PaymentNotificationsModule : Module() {
  private val context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private fun component() = ComponentName(context, PaymentNotificationListener::class.java)

  override fun definition() = ModuleDefinition {
    Name("PaymentNotifications")

    /** 알림 접근이 허용돼 있는지 */
    Function("isEnabled") {
      NotificationManagerCompat.getEnabledListenerPackages(context).contains(context.packageName)
    }

    /** 알림 접근 설정 화면 열기 (안드로이드 11 이상은 이 앱 항목으로 바로) */
    Function("openSettings") {
      val intent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        Intent(Settings.ACTION_NOTIFICATION_LISTENER_DETAIL_SETTINGS)
          .putExtra(Settings.EXTRA_NOTIFICATION_LISTENER_COMPONENT_NAME, component().flattenToString())
      } else {
        Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
      }
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      try {
        context.startActivity(intent)
      } catch (e: Exception) {
        context.startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      }
      Unit
    }

    /** 앱 정보 화면 (⋮ 메뉴 > 제한된 설정 허용) */
    Function("openAppDetails") {
      context.startActivity(
        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${context.packageName}"))
          .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      )
      Unit
    }

    /** 허용은 돼 있는데 리스너가 끊겼을 때 다시 붙여 달라고 요청 */
    Function("requestRebind") {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
        try { NotificationListenerService.requestRebind(component()) } catch (e: Exception) {}
      }
      Unit
    }

    /** 아직 앱이 처리하지 않은 결제 알림 (JSON 배열 문자열) */
    Function("getPending") {
      PaymentStore.pending(context).toString()
    }

    /** 처리한 알림 지우기 */
    Function("ack") { maxPostedAt: Double ->
      PaymentStore.ack(context, maxPostedAt.toLong())
      Unit
    }

    Function("getStatus") {
      PaymentStore.status(context)
    }
  }
}
