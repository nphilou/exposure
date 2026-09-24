import SwiftUI

struct PhotosView: View {
    @Environment(ServerStore.self) private var store
    @Environment(Router.self) private var router
    enum Filter: Hashable { case all, edited, originals }
    @State private var filter: Filter = .all
    @State private var feed = PhotoFeed()

    private var query: APIClient.PhotoQuery { var q = APIClient.PhotoQuery(); q.edited = filter == .edited; return q }
    private var rep: Version.Key? { filter == .edited ? .edited : filter == .originals ? .camera : nil }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                LargeTitle(title: "Photos") {
                    HStack(spacing: 8) {
                        ServerMenu()
                        CircleButton(system: "magnifyingglass") { withAnimation(.easeOut(duration: 0.2)) { router.searching = true } }
                    }
                }
                Segmented(options: [(.all, "All"), (.edited, "Edited"), (.originals, "Originals")], selection: $filter)
                    .padding(.horizontal, 18).padding(.top, 14).padding(.bottom, 6)
                UnreachableBanner { await reload() }
                if feed.loaded && feed.photos.isEmpty {
                    Text(filter == .edited ? "No edited photos yet." : "No photos yet. New shoots appear here automatically.")
                        .font(.geist(15)).foregroundStyle(Theme.tx2).frame(maxWidth: .infinity).padding(.top, 80)
                }
                PhotoGrid(sections: feed.photos.groupedByDay(), rep: rep) { Task { await feed.loadMore(store: store) } }
            }
            .padding(.bottom, 110)
        }
        .scrollIndicators(.hidden)
        .refreshable { await reload() }
        .toolbar(.hidden, for: .navigationBar)
        .background(Theme.bg)
        .task(id: "\(filter)-\(store.libraryVersion)") { await reload() }
    }

    private func reload() async { await feed.load(query, store: store) }
}

struct CircleButton: View {
    let system: String
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            Image(systemName: system).font(.system(size: 17, weight: .medium))
                .frame(width: 40, height: 40).background(Circle().fill(Theme.hover))
        }
        .buttonStyle(.plain)
    }
}

/// Small menu next to the title: which server, and disconnect.
struct ServerMenu: View {
    @Environment(ServerStore.self) private var store
    @State private var confirm = false
    var body: some View {
        Menu {
            Section(store.server?.host() ?? "Server") {
                Button("Disconnect this iPhone", role: .destructive) { confirm = true }
            }
        } label: {
            Image(systemName: "ellipsis").font(.system(size: 17, weight: .medium))
                .frame(width: 40, height: 40).background(Circle().fill(Theme.hover))
        }
        .confirmationDialog("Disconnect from your server? You’ll need a new pairing code to come back.", isPresented: $confirm, titleVisibility: .visible) {
            Button("Disconnect", role: .destructive) { store.unpair() }
        }
    }
}
