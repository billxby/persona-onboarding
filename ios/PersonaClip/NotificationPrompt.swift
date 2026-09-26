import SwiftUI
import UserNotifications

/// App Clips may show notifications for up to 8 hours after launch when the Info.plist has
/// `NSAppClipRequestEphemeralUserNotification` and the user allowed it on the App Clip card
/// (the system then reports `authorizationStatus == .ephemeral`). If they did not, the clip can
/// still ask with the standard prompt (Apple: enabling-notifications-in-app-clips). We only ask
/// when the user taps "Remind me", never on launch.
struct RemindMeButton: View {
    @State private var status: UNAuthorizationStatus = .notDetermined
    @State private var scheduled = false

    var body: some View {
        Button {
            Task { await requestAndSchedule() }
        } label: {
            Label(scheduled ? "Reminder set" : "Remind me tonight", systemImage: scheduled ? "checkmark.circle.fill" : "bell.badge")
        }
        .buttonStyle(.bordered)
        .disabled(scheduled || status == .denied)
        .task { status = await UNUserNotificationCenter.current().notificationSettings().authorizationStatus }
    }

    private func requestAndSchedule() async {
        let center = UNUserNotificationCenter.current()
        let current = await center.notificationSettings().authorizationStatus
        var granted = current == .authorized || current == .ephemeral || current == .provisional
        if !granted {
            granted = (try? await center.requestAuthorization(options: [.alert, .sound])) ?? false
        }
        status = await center.notificationSettings().authorizationStatus
        guard granted else { return }
        let content = UNMutableNotificationContent()
        content.title = "Your Persona is ready"
        content.body = "Text one thing you want off your plate and it starts right away."
        // Well inside the 8-hour window the clip is allowed to notify in.
        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: 4 * 60 * 60, repeats: false)
        try? await center.add(UNNotificationRequest(identifier: "persona-clip-reminder", content: content, trigger: trigger))
        scheduled = true
    }
}
