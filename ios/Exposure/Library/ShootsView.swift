import SwiftUI

struct ShootsView: View {
    @Environment(ServerStore.self) private var store

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                UnreachableBanner { await store.loadCollections() }
                LazyVStack(alignment: .leading, spacing: 30) {
                    ForEach(store.shoots) { s in
                        NavigationLink(value: s) {
                            VStack(alignment: .leading, spacing: 0) {
                                Color.clear.aspectRatio(1.5, contentMode: .fit)
                                    .overlay { if let c = s.cover, let api = store.api { AuthImage(url: api.thumbURL(c, width: 1200)) } else { Theme.skel } }
                                    .clipped()
                                Text(s.title).font(.geist(20, .medium)).kerning(-0.5).padding(.top, 12).padding(.horizontal, 18)
                                Text("\(Fmt.longDate.string(from: s.day)) · \(Fmt.photos(s.count))")
                                    .font(.geist(13)).foregroundStyle(Theme.tx2).padding(.top, 3).padding(.horizontal, 18)
                            }
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .padding(.top, 8).padding(.bottom, 110)
        }
        .pinnedHeader { LargeTitle(title: "Shoots").padding(.bottom, 10) }
        .scrollIndicators(.hidden)
        .refreshable { await store.loadCollections() }
        .toolbar(.hidden, for: .navigationBar)
        .background(Theme.bg)
        .navigationDestination(for: Shoot.self) { ShootDetailView(shoot: $0) }
    }
}

struct ShootDetailView: View {
    @Environment(ServerStore.self) private var store
    let shoot: Shoot
    enum Mode: Hashable { case final, all }
    @State private var mode: Mode
    @State private var feed = PhotoFeed()

    init(shoot: Shoot) { self.shoot = shoot; _mode = State(initialValue: shoot.edited > 0 ? .final : .all) }

    var body: some View {
        DetailScaffold(back: "Shoots", title: shoot.title, date: Fmt.longDate.string(from: shoot.day),
                       counts: "\(shoot.count) originals · \(shoot.edited) edited") {
            Segmented(options: [(.final, "Final"), (.all, "All")], selection: $mode, height: 30)
                .frame(width: 170).padding(.top, 16)
        } content: {
            if feed.loaded && feed.photos.isEmpty {
                Text(mode == .final ? "No edited photos in this shoot yet." : "No photos.")
                    .font(.geist(15)).foregroundStyle(Theme.tx2).frame(maxWidth: .infinity).padding(.top, 60)
            }
            PhotoGrid(sections: [PhotoSection(id: shoot.id, title: "", sub: "", photos: feed.photos)], showHeaders: false,
                      rep: mode == .final ? .edited : nil) { Task { await feed.loadMore(store: store) } }
        }
        .task(id: "\(mode)-\(store.libraryVersion)") {
            var q = APIClient.PhotoQuery(); q.shoot = shoot.id; q.edited = mode == .final
            await feed.load(q, store: store)
        }
    }
}

/// Shared header for shoot and album detail: "‹ Back", big title, date, counts, extra controls.
struct DetailScaffold<Extra: View, Content: View>: View {
    @Environment(\.dismiss) private var dismiss
    let back: String
    let title: String
    let date: String
    let counts: String
    @ViewBuilder var extra: Extra
    @ViewBuilder var content: Content

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                Button { dismiss() } label: {
                    HStack(spacing: 4) { Image(systemName: "chevron.left").font(.system(size: 15, weight: .medium)); Text(back) }
                        .font(.geist(16)).foregroundStyle(Theme.tx2).frame(height: 40).padding(.horizontal, 6)
                }
                .buttonStyle(.plain).padding(.horizontal, 12).padding(.top, 4)
                VStack(alignment: .leading, spacing: 0) {
                    Text(title).font(.geist(36, .semibold)).kerning(-1.4)
                    Text(date).font(.geist(15)).foregroundStyle(Theme.tx2).padding(.top, 8)
                    if !counts.isEmpty { Text(counts).font(.geist(13)).foregroundStyle(Theme.tx3).padding(.top, 4) }
                    extra
                }
                .padding(.horizontal, 18).padding(.top, 8).padding(.bottom, 18)
                content
            }
            .padding(.bottom, 110)
        }
        .scrollIndicators(.hidden)
        .toolbar(.hidden, for: .navigationBar)
        .background(Theme.bg)
    }
}

extension DetailScaffold where Extra == EmptyView {
    init(back: String, title: String, date: String, counts: String, @ViewBuilder content: () -> Content) {
        self.back = back; self.title = title; self.date = date; self.counts = counts
        self.extra = EmptyView(); self.content = content()
    }
}
