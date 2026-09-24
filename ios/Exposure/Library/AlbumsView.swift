import SwiftUI

struct AlbumsView: View {
    @Environment(ServerStore.self) private var store
    private let columns = [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                LargeTitle(title: "Albums").padding(.bottom, 18)
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
            .padding(.bottom, 110)
        }
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

    var body: some View {
        DetailScaffold(back: "Albums", title: album.title, date: Fmt.photos(album.count), counts: "") {
            PhotoGrid(sections: [PhotoSection(id: "a\(album.id)", title: "", sub: "", photos: feed.photos)], showHeaders: false) {
                Task { await feed.loadMore(store: store) }
            }
        }
        .task(id: store.libraryVersion) {
            var q = APIClient.PhotoQuery(); q.album = album.id
            await feed.load(q, store: store)
        }
    }
}
