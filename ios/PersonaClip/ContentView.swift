import SwiftUI

/// The "Meet your Persona" tour. One scroll view, no navigation; the only input is the optional
/// "Try your Persona" demo task (see `TryItView`), which is what makes this a demo clip.
/// Every string comes from `ClipContent`; the layout is plain SwiftUI so it stays far under the
/// App Clip size limit and passes review as a native experience (no web view).
struct ContentView: View {
    @EnvironmentObject private var launch: LaunchContext
    @StateObject private var loader = ContentLoader()
    @Environment(\.openURL) private var openURL

    var body: some View {
        Group {
            if let content = loader.content {
                Tour(content: content, baseURL: launch.baseURL, sessionID: launch.sessionID)
            } else {
                ContentUnavailableView("Persona", systemImage: "sparkles", description: Text("Loading the tour…"))
            }
        }
        .task(id: launch.baseURL) { await loader.load(base: launch.baseURL) }
    }
}

private struct Tour: View {
    let content: ClipContent
    let baseURL: URL
    let sessionID: String?
    @Environment(\.openURL) private var openURL

    private let accent = Color(red: 0.10, green: 0.51, blue: 0.99) // iMessage blue

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 32) {
                hero
                TryItView(baseURL: baseURL, sessionID: sessionID, onContinue: startInMessages)
                features
                wristband
                products
                experience
                footer
            }
            .padding(.horizontal, 20)
            .padding(.top, 24)
            .padding(.bottom, 40)
        }
        .background(Color(.systemGroupedBackground))
    }

    // MARK: Sections

    private var hero: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 12) {
                Image(systemName: "sparkles")
                    .font(.title2.weight(.semibold))
                    .foregroundStyle(.white)
                    .frame(width: 44, height: 44)
                    .background(accent, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                Text("Persona").font(.headline)
                Spacer()
                Text("App Clip").font(.caption).foregroundStyle(.secondary)
            }
            Text(content.hero.title).font(.largeTitle.bold())
            Text(content.hero.subtitle).font(.body).foregroundStyle(.secondary)
            HStack(spacing: 10) {
                Button {
                    startInMessages()
                } label: {
                    Label(content.hero.cta.label, systemImage: "message.fill")
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 6)
                }
                .buttonStyle(.borderedProminent)
                .tint(accent)
                RemindMeButton()
            }
        }
    }

    private var features: some View {
        VStack(alignment: .leading, spacing: 12) {
            sectionTitle("What it does")
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)], spacing: 12) {
                ForEach(content.features) { feature in
                    VStack(alignment: .leading, spacing: 8) {
                        Image(systemName: feature.icon.systemImage)
                            .font(.title3.weight(.semibold))
                            .foregroundStyle(accent)
                        Text(feature.title).font(.subheadline.weight(.semibold))
                        Text(feature.body).font(.footnote).foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(14)
                    .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                }
            }
        }
    }

    private var wristband: some View {
        VStack(alignment: .leading, spacing: 12) {
            sectionTitle(content.wristband.name)
            VStack(alignment: .leading, spacing: 12) {
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .fill(LinearGradient(colors: [Color(.systemGray5), Color(.systemGray3)], startPoint: .topLeading, endPoint: .bottomTrailing))
                    .frame(height: 150)
                    .overlay {
                        Image(systemName: "applewatch.side.right")
                            .font(.system(size: 56, weight: .light))
                            .foregroundStyle(.secondary)
                    }
                Text(content.wristband.tagline).font(.title3.weight(.semibold))
                Text(content.wristband.body).font(.body).foregroundStyle(.secondary)
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(content.wristband.bullets, id: \.self) { bullet in
                        HStack(alignment: .top, spacing: 8) {
                            Image(systemName: "checkmark.circle.fill").foregroundStyle(accent).font(.footnote)
                            Text(bullet).font(.footnote)
                        }
                    }
                }
                if let url = URL(string: content.wristband.howToGet.url) {
                    Link(destination: url) {
                        Text(content.wristband.howToGet.label)
                            .font(.headline)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 6)
                    }
                    .buttonStyle(.bordered)
                    .tint(accent)
                }
                if let note = content.wristband.howToGet.note {
                    Text(note).font(.caption2).foregroundStyle(.tertiary)
                }
            }
            .padding(16)
            .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        }
    }

    private var products: some View {
        VStack(alignment: .leading, spacing: 12) {
            sectionTitle("Products")
            ForEach(content.products) { product in
                VStack(alignment: .leading, spacing: 8) {
                    HStack(alignment: .firstTextBaseline) {
                        Text(product.name).font(.headline)
                        Spacer()
                        if let price = product.price {
                            Text(price).font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    Text(product.body).font(.footnote).foregroundStyle(.secondary)
                    if let url = URL(string: product.cta.url) {
                        Link(product.cta.label, destination: url)
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(accent)
                    }
                }
                .padding(16)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            }
        }
    }

    private var experience: some View {
        VStack(alignment: .leading, spacing: 12) {
            sectionTitle(content.experience.title)
            VStack(alignment: .leading, spacing: 14) {
                ForEach(Array(content.experience.steps.enumerated()), id: \.offset) { index, step in
                    HStack(alignment: .top, spacing: 12) {
                        Text("\(index + 1)")
                            .font(.footnote.weight(.bold))
                            .foregroundStyle(.white)
                            .frame(width: 26, height: 26)
                            .background(accent, in: Circle())
                        VStack(alignment: .leading, spacing: 3) {
                            Text(step.title).font(.subheadline.weight(.semibold))
                            Text(step.body).font(.footnote).foregroundStyle(.secondary)
                        }
                    }
                }
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        }
    }

    private var footer: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("Privacy", systemImage: "lock.shield").font(.subheadline.weight(.semibold))
            Text(content.footer.privacy).font(.footnote).foregroundStyle(.secondary)
            Text("Content \(content.version)").font(.caption2).foregroundStyle(.tertiary)
        }
    }

    // MARK: Helpers

    private func sectionTitle(_ text: String) -> some View {
        Text(text).font(.title2.bold())
    }

    /// Back to the conversation: the Messages app on a device (the thread with Persona is already
    /// there when the clip was opened from it), otherwise the web chat for this session.
    private func startInMessages() {
        if let sms = URL(string: "sms:"), UIApplication.shared.canOpenURL(sms) {
            openURL(sms)
            return
        }
        var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false)
        components?.path = "/"
        if let sessionID { components?.queryItems = [URLQueryItem(name: "sid", value: sessionID)] }
        if let url = components?.url ?? URL(string: content.hero.cta.url) { openURL(url) }
    }
}

#Preview {
    ContentView().environmentObject(LaunchContext())
}
