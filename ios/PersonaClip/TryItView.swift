import SwiftUI

/// "Try your Persona": the part that makes this a demo clip rather than a brochure (the HIG rejects
/// clips that only advertise; guideline 2.5.16(a) wants everything the clip does to exist in the full
/// app, and 4.2 rejects marketing-only apps). The user picks or types one task; the server runs it
/// against the demo inbox (`POST /api/clip/demo`) and returns the bubbles Persona would have sent.
/// Nothing here touches the user's own data, and nothing is sent anywhere.
struct TryItView: View {
    let baseURL: URL
    let sessionID: String?
    /// "Continue in Messages": the caller decides whether that is `sms:` or the web chat.
    var onContinue: () -> Void

    private let accent = Color(red: 0.10, green: 0.51, blue: 0.99) // iMessage blue
    private static let chips = [
        "Cancel my gym membership before it renews",
        "What is my landlord asking about the lease?",
        "Draft a reply to the dentist about my appointment",
    ]

    @State private var model = DemoModel()
    @State private var draft = ""
    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Try your Persona").font(.title2.bold())
            Text("Pick a task or type your own. It runs against a demo inbox, so nothing here is real.")
                .font(.footnote)
                .foregroundStyle(.secondary)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(Self.chips, id: \.self) { chip in
                        Button { send(chip) } label: {
                            Text(chip)
                                .font(.footnote.weight(.medium))
                                .lineLimit(1)
                                .padding(.horizontal, 12)
                                .padding(.vertical, 8)
                                .background(Color(.secondarySystemGroupedBackground), in: Capsule())
                                .overlay(Capsule().stroke(accent.opacity(0.35)))
                        }
                        .buttonStyle(.plain)
                        .disabled(model.phase == .sending)
                    }
                }
                .padding(.vertical, 2)
            }

            HStack(spacing: 8) {
                TextField("…or type one thing you want off your plate", text: $draft, axis: .vertical)
                    .lineLimit(1...3)
                    .textFieldStyle(.plain)
                    .focused($focused)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 9)
                    .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                    .onSubmit { send(draft) }
                Button { send(draft) } label: {
                    Image(systemName: "arrow.up.circle.fill").font(.system(size: 30))
                }
                .tint(accent)
                .disabled(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || model.phase == .sending)
                .accessibilityLabel("Go")
            }

            if let task = model.task {
                VStack(alignment: .leading, spacing: 6) {
                    bubble(task, outgoing: true)
                    ForEach(Array(model.bubbles.enumerated()), id: \.offset) { _, text in
                        bubble(text, outgoing: false)
                    }
                    if model.showTyping {
                        TypingIndicator()
                    }
                    if case .failed(let message) = model.phase {
                        Text(message).font(.footnote).foregroundStyle(.red).padding(.top, 2)
                    }
                }
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
                .animation(.snappy, value: model.bubbles.count)
            }

            Text("Demo inbox · nothing here is real").font(.caption2).foregroundStyle(.tertiary)

            if model.phase == .done || model.limitReached {
                Button { onContinue() } label: {
                    Label("Continue in Messages", systemImage: "message.fill")
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 6)
                }
                .buttonStyle(.borderedProminent)
                .tint(accent)
            }
        }
    }

    private func send(_ text: String) {
        let task = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !task.isEmpty, model.phase != .sending else { return }
        draft = ""
        focused = false
        Task { await model.run(task: task, base: baseURL, sid: sessionID) }
    }

    private func bubble(_ text: String, outgoing: Bool) -> some View {
        HStack {
            if outgoing { Spacer(minLength: 40) }
            Text(text)
                .font(.subheadline)
                .foregroundStyle(outgoing ? Color.white : Color.primary)
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(outgoing ? accent : Color(.systemGray5), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            if !outgoing { Spacer(minLength: 40) }
        }
    }
}

/// Three pulsing dots, the iMessage "typing" bubble.
private struct TypingIndicator: View {
    @State private var phase = 0.0

    var body: some View {
        HStack(spacing: 4) {
            ForEach(0..<3, id: \.self) { i in
                Circle()
                    .fill(Color(.systemGray))
                    .frame(width: 7, height: 7)
                    .opacity(0.35 + 0.65 * abs(sin(phase + Double(i) * 0.9)))
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(Color(.systemGray5), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .onAppear {
            withAnimation(.linear(duration: 1.2).repeatForever(autoreverses: false)) { phase = .pi * 2 }
        }
        .accessibilityLabel("Persona is typing")
    }
}

/// State of one demo run. Bubbles are revealed one by one, ~0.5 s apart, like the real thread.
@Observable
@MainActor
final class DemoModel {
    enum Phase: Equatable {
        case idle, sending, done
        case failed(String)
    }

    var phase: Phase = .idle
    var task: String?
    var bubbles: [String] = []
    var sessionID: String?
    var limitReached = false
    private var pending: [String] = []

    var showTyping: Bool { phase == .sending || !pending.isEmpty }

    func run(task: String, base: URL, sid: String?) async {
        self.task = task
        bubbles = []
        pending = []
        phase = .sending
        do {
            let response = try await DemoClient.run(task: task, sid: sid, base: base)
            sessionID = response.session_id
            pending = response.bubbles
            phase = .done
            await reveal()
        } catch let failure as DemoClient.Failure {
            if failure.status == 429 {
                limitReached = true
                phase = .failed("Limit reached — continue in Messages")
            } else {
                phase = .failed(failure.message)
            }
        } catch {
            phase = .failed("Couldn't reach Persona. Check your connection and try again.")
        }
    }

    private func reveal() async {
        while !pending.isEmpty {
            try? await Task.sleep(for: .milliseconds(500))
            bubbles.append(pending.removeFirst())
        }
    }
}

/// `POST <base>/api/clip/demo` — the same server the web simulator uses.
enum DemoClient {
    struct Response: Decodable {
        let session_id: String
        let bubbles: [String]
        let ms: Double?
    }

    struct Failure: Error {
        let status: Int
        let message: String
    }

    private struct ErrorBody: Decodable {
        let error: String
    }

    static func run(task: String, sid: String?, base: URL) async throws -> Response {
        var request = URLRequest(url: base.appendingPathComponent("api/clip/demo"))
        request.httpMethod = "POST"
        request.timeoutInterval = 45
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        var body: [String: String] = ["task": task]
        if let sid { body["sid"] = sid }
        request.httpBody = try JSONEncoder().encode(body)

        let (data, response) = try await URLSession.shared.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            let message = (try? JSONDecoder().decode(ErrorBody.self, from: data))?.error ?? "Persona returned \(status)."
            throw Failure(status: status, message: message)
        }
        return try JSONDecoder().decode(Response.self, from: data)
    }
}

#Preview {
    ScrollView {
        TryItView(baseURL: URL(string: "http://localhost:3000")!, sessionID: nil, onContinue: {})
            .padding(20)
    }
    .background(Color(.systemGroupedBackground))
}
