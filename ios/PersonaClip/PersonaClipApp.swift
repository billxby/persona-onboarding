import SwiftUI

/// "Meet your Persona" App Clip.
///
/// Launched from an App Clip card in Messages (or a QR / NFC / Safari banner) with the
/// invocation URL `https://<domain>/clip?sid=<session id>`. The clip is a tour of what
/// Persona does, the wristband, the products and the full experience; it never touches
/// the user's data. Everything it shows comes from `clip_content.json` (bundled) or, when
/// online, from `<baseURL>/api/clip/content` so copy can change without a resubmission.
@main
struct PersonaClipApp: App {
    @StateObject private var launch = LaunchContext()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(launch)
                // App Clips receive their invocation URL as a browsing-web user activity.
                .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { activity in
                    launch.apply(activity.webpageURL)
                }
        }
    }
}

/// The URL the clip was invoked with, and the bits of it the tour uses.
final class LaunchContext: ObservableObject {
    /// Fallback while running in Xcode without an invocation URL (set `_XCAppClipURL` in the scheme to test one).
    static let defaultBaseURL = URL(string: "https://yourpersona.com")! // PLACEHOLDER domain

    @Published private(set) var invocationURL: URL?
    @Published private(set) var sessionID: String?

    /// Scheme + host of the invocation URL, used to reach `/api/clip/content` and to link back to the chat.
    var baseURL: URL {
        guard let url = invocationURL, let scheme = url.scheme, let host = url.host else { return Self.defaultBaseURL }
        var s = "\(scheme)://\(host)"
        if let port = url.port { s += ":\(port)" }
        return URL(string: s) ?? Self.defaultBaseURL
    }

    func apply(_ url: URL?) {
        guard let url else { return }
        invocationURL = url
        sessionID = URLComponents(url: url, resolvingAgainstBaseURL: false)?
            .queryItems?
            .first(where: { $0.name == "sid" })?
            .value
    }
}
