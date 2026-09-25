import SwiftUI

struct AlbumsView: View {
    @Environment(ServerStore.self) private var store
    private let columns = [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                UnreachableBanner { await store.loadCollections() }
                if store.albums.isEmpty {
                    Text("No albums yet. Create them in Exposure on your computer.")
                        .font(.geist(15)).foregroundStyle(Theme.tx2).multilineTextAlignment(.center)
                        .frame(maxWidth: .infinity).padding(.horizontal, 30).padding(.top, 60)
                }
                LazyVGrid(columns: columns, alignment: .leading, spacing: 24) {
                    ForEach(store.albums) { a in
                        NavigationLink(value: a) {
                            VStack(alignment: .leading, spacing: 0) {
                                Color.clear.aspectRatio(1, contentMode: .fit)
                                    .overlay { if let c = a.cover, let api = store.api { AuthImage(url: api.thumbURL(c, width: 600)) } else { Theme.skel } }
                                    .clipShape(RoundedRectangle(cornerRadius: 6))
                                Text(a.title).font(.geist(15, .medium)).lineLimit(1).padding(.top, 9)
                                Text(Fmt.photos(a.count)).font(.geist(12)).foregroundStyle(Theme.tx2).padding(.top, 2)
                            }
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 18)
            }
            .padding(.top, 8).padding(.bottom, 110)
        }
        .pinnedHeader { LargeTitle(title: "Albums").padding(.bottom, 10) }
        .scrollIndicators(.hidden)
        .refreshable { await store.loadCollections() }
        .toolbar(.hidden, for: .navigationBar)
        .background(Theme.bg)
        .navigationDestination(for: Album.self) { AlbumDetailView(album: $0) }
    }
}

struct AlbumDetailView: View {
    @Environment(ServerStore.self) private var store
    let album: Album
    @State private var feed = PhotoFeed()
    @State private var sharing = false

    var body: some View {
        DetailScaffold(back: "Albums", title: album.title, date: Fmt.photos(album.count), counts: "") {
            Button { sharing = true } label: {
                Label("Share album", systemImage: "link").font(.geist(14, .medium)).foregroundStyle(Theme.tx)
                    .padding(.horizontal, 14).frame(height: 34)
                    .background(Capsule().stroke(Theme.tx3.opacity(0.5)))
                    .contentShape(Capsule())
            }
            .buttonStyle(.plain).padding(.top, 14)
        } content: {
            PhotoGrid(sections: [PhotoSection(id: "a\(album.id)", title: "", sub: "", photos: feed.photos)], showHeaders: false) {
                Task { await feed.loadMore(store: store) }
            }
        }
        .task(id: store.libraryVersion) {
            var q = APIClient.PhotoQuery(); q.album = album.id
            await feed.load(q, store: store)
        }
        .sheet(isPresented: $sharing) { ShareAlbumView(album: album) }
    }
}
