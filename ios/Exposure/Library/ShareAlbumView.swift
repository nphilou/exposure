import SwiftUI

/// Album → Share album: read-only links for people without a paired device (mirrors the web's Share dialog).
struct ShareAlbumView: View {
    @Environment(ServerStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let album: Album

    @State private var links: [AlbumShare] = []
    @State private var name = ""
    @State private var days: Int? = nil
    @State private var originals = false
    @State private var made: (id: String, url: URL)?
    @State private var revoking: AlbumShare?
    @State private var base = ""
    @State private var busy = false
    @State private var error: String?

    private static let expiry: [(String, Int?)] = [("Never", nil), ("1 day", 1), ("1 week", 7), ("1 month", 30)]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                HStack {
                    Text("Share album").font(.geist(32, .medium)).kerning(-1)
                    Spacer()
                    Button("Done") { dismiss() }.font(.geist(16, .medium))
                }
                .padding(.top, 28)
                Text("Anyone with a link can view “\(album.title)”, without an account. Photos you add later are shared too.")
                    .font(.geist(15)).foregroundStyle(Theme.tx2)

                if let made = made?.url {
                    VStack(alignment: .leading, spacing: 12) {
                        Text(made.absoluteString).font(.geistMono(13)).foregroundStyle(Theme.tx2).textSelection(.enabled)
                        ShareLink(item: made, subject: Text(album.title)) {
                            Text("Send link").font(.geist(16, .medium)).foregroundStyle(Theme.btntx)
                                .frame(maxWidth: .infinity, minHeight: 50)
                                .background(RoundedRectangle(cornerRadius: 12).fill(Theme.btn))
                        }
                        Button { UIPasteboard.general.url = made } label: {
                            Text("Copy link").font(.geist(16, .medium)).frame(maxWidth: .infinity, minHeight: 44)
                        }
                        Text("Send it now: for safety, Exposure can’t show this link again.").font(.geist(13)).foregroundStyle(Theme.tx3)
                        Button("New link") { self.made = nil }.font(.geist(14))
                    }
                } else {
                    TextField("Who is it for? (Family, Wedding guests…)", text: $name)
                        .font(.geist(16)).padding(.horizontal, 14).frame(height: 48)
                        .background(RoundedRectangle(cornerRadius: 10).fill(Theme.skel))
                    Picker("Expires", selection: $days) {
                        ForEach(Self.expiry, id: \.0) { Text($0.0).tag($0.1) }
                    }
                    .pickerStyle(.segmented)
                    Toggle("Allow full-resolution downloads", isOn: $originals).font(.geist(15))
                    Button { Task { await create() } } label: {
                        Text(busy ? "Creating…" : "Create link").font(.geist(16, .medium)).foregroundStyle(Theme.btntx)
                            .frame(maxWidth: .infinity, minHeight: 50)
                            .background(RoundedRectangle(cornerRadius: 12).fill(Theme.btn))
                    }
                    .disabled(busy)
                }
                if isLocal(base) {
                    Text("This server’s address only works on your home network. To share with people elsewhere, make Exposure reachable over HTTPS and set EXPOSURE_PUBLIC_URL.")
                        .font(.geist(13)).foregroundStyle(Theme.tx3)
                }
                if let error { Text(error).font(.geist(14)).foregroundStyle(.orange) }

                if !links.isEmpty {
                    Text("LINKS").font(.geist(11, .medium)).kerning(0.6).foregroundStyle(Theme.tx3).padding(.top, 8)
                    VStack(spacing: 0) {
                        ForEach(links) { l in
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(l.name).font(.geist(15))
                                    Text(detail(l)).font(.geist(12)).foregroundStyle(Theme.tx3)
                                }
                                Spacer()
                                Button { revoking = l } label: { Image(systemName: "xmark").foregroundStyle(Theme.tx2).frame(width: 36, height: 36) }
                                    .accessibilityLabel("Stop sharing with \(l.name)")
                            }
                            .padding(.vertical, 8)
                            Divider()
                        }
                    }
                }
            }
            .padding(.horizontal, 24).padding(.bottom, 40)
        }
        .foregroundStyle(Theme.tx)
        .background(Theme.bg.ignoresSafeArea())
        .task { await load() }
        .confirmationDialog("Stop sharing with “\(revoking?.name ?? "")”?", isPresented: Binding(get: { revoking != nil }, set: { if !$0 { revoking = nil } }), titleVisibility: .visible) {
            Button("Stop sharing", role: .destructive) { if let l = revoking { Task { await revoke(l) } } }
        } message: {
            Text("Anyone with that link loses access.")
        }
    }

    private func load() async {
        // Prefer the server's public address (Tailscale, tunnel) over the one this iPhone happens to use.
        let session = try? await store.call { try await $0.session() }
        var b = session?.publicUrl ?? store.server?.absoluteString ?? ""
        while b.hasSuffix("/") { b.removeLast() }
        base = b
        links = (try? await store.call { try await $0.shares(album: album.id) }) ?? links
    }

    private func create() async {
        busy = true; error = nil
        defer { busy = false }
        do {
            let body = APIClient.NewShare(name: name, expiresInDays: days, allowOriginals: originals)
            let r = try await store.call { try await $0.createShare(album: album.id, body) }
            made = URL(string: base + r.path).map { (r.id, $0) }
            name = ""
            await load()
        } catch { self.error = error.localizedDescription }
    }

    private func revoke(_ l: AlbumShare) async {
        do {
            try await store.call { try await $0.deleteShare(l.id) }
            if made?.id == l.id { made = nil }
            await load()
        }
        catch { self.error = error.localizedDescription }
    }

    private func detail(_ l: AlbumShare) -> String {
        let f = RelativeDateTimeFormatter()
        var parts = [l.lastSeen.map { "opened " + f.localizedString(for: Date(timeIntervalSince1970: $0 / 1000), relativeTo: .now) } ?? "not opened yet"]
        if let e = l.expiresAt {
            // Whole days, rounded up: a week-long link reads "in 7 days", not "in 6 days" a minute later.
            let days = Int(((e / 1000 - Date.now.timeIntervalSince1970) / 86400).rounded(.up))
            parts.append(days <= 0 ? "expired" : days == 1 ? "expires tomorrow" : "expires in \(days) days")
        }
        if l.allowOriginals { parts.append("downloads on") }
        return parts.joined(separator: " · ")
    }

    private func isLocal(_ base: String) -> Bool {
        guard let host = URL(string: base)?.host() else { return false }
        return host == "localhost" || host.hasSuffix(".local") || ["127.", "10.", "192.168.", "172."].contains { host.hasPrefix($0) }
    }
}
