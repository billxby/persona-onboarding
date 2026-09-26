import Foundation

/// Mirrors `data/clip_content.json` / `src/lib/shared/clip.ts` (`ClipContentSchema`) one-to-one.
/// Unknown keys (like `_note`) are ignored by `Codable`.
struct ClipContent: Codable, Equatable {
    struct Cta: Codable, Equatable {
        var label: String
        var url: String
    }

    struct Hero: Codable, Equatable {
        var title: String
        var subtitle: String
        var cta: Cta
    }

    enum FeatureIcon: String, Codable, Equatable {
        case mail, pen, scissors, calendar, phone, shield

        /// SF Symbol for each icon key.
        var systemImage: String {
            switch self {
            case .mail: return "envelope"
            case .pen: return "pencil"
            case .scissors: return "scissors"
            case .calendar: return "calendar"
            case .phone: return "phone"
            case .shield: return "lock.shield"
            }
        }
    }

    struct Feature: Codable, Equatable, Identifiable {
        var id: String
        var icon: FeatureIcon
        var title: String
        var body: String
    }

    struct HowToGet: Codable, Equatable {
        var label: String
        var url: String
        var note: String?
    }

    struct Wristband: Codable, Equatable {
        var name: String
        var tagline: String
        var body: String
        var bullets: [String]
        var image: String?
        var howToGet: HowToGet

        enum CodingKeys: String, CodingKey {
            case name, tagline, body, bullets, image
            case howToGet = "how_to_get"
        }
    }

    struct Product: Codable, Equatable, Identifiable {
        var id: String
        var name: String
        var body: String
        var price: String?
        var cta: Cta
    }

    struct Step: Codable, Equatable {
        var title: String
        var body: String
    }

    struct Experience: Codable, Equatable {
        var title: String
        var steps: [Step]
    }

    struct Footer: Codable, Equatable {
        var privacy: String
    }

    var version: String
    var hero: Hero
    var features: [Feature]
    var wristband: Wristband
    var products: [Product]
    var experience: Experience
    var footer: Footer
}

/// Loads the tour copy: the live endpoint first (so copy can change without an App Store
/// resubmission), the bundled `clip_content.json` as the fallback and as the instant first paint.
@MainActor
final class ContentLoader: ObservableObject {
    enum Source: String { case bundled, remote }

    @Published private(set) var content: ClipContent?
    @Published private(set) var source: Source = .bundled
    @Published private(set) var error: String?

    static func bundled() -> ClipContent? {
        guard let url = Bundle.main.url(forResource: "clip_content", withExtension: "json"),
              let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(ClipContent.self, from: data)
    }

    func load(base: URL) async {
        if content == nil { content = Self.bundled() }
        let endpoint = base.appendingPathComponent("api/clip/content")
        var request = URLRequest(url: endpoint)
        request.timeoutInterval = 6
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
                throw URLError(.badServerResponse)
            }
            let remote = try JSONDecoder().decode(ClipContent.self, from: data)
            content = remote
            source = .remote
            error = nil
        } catch {
            // Offline or the endpoint is unreachable: the bundled copy stays on screen.
            self.error = error.localizedDescription
        }
    }
}
