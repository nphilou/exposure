import SwiftUI

struct PhotosView: View {
    @Environment(ServerStore.self) private var store
    @Environment(Router.self) private var router
    enum Filter: Hashable { case all, edited }
    @State private var filter: Filter = UserDefaults.standard.string(forKey: "defaultView") == "edited" ? .edited : .all
    @State private var touched = false   // once the user picks a filter, the server default no longer overrides it
    @State private var feed = PhotoFeed()

    /// Without edited photos both filters show the same thing, so the control is hidden and All applies.
    private var hasEdits: Bool { store.editedCount > 0 }
    private var active: Filter { hasEdits ? filter : .all }
    private var query: APIClient.PhotoQuery { var q = APIClient.PhotoQuery(); q.edited = active == .edited; return q }
    private var rep: Version.Key? { active == .edited ? .edited : nil }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                UnreachableBanner { await reload() }
                if feed.loaded && feed.photos.isEmpty {
                    Text(active == .edited ? "No edited photos yet." : "No photos yet. New shoots appear here automatically.")
                        .font(.geist(15)).foregroundStyle(Theme.tx2).frame(maxWidth: .infinity).padding(.top, 80)
                }
                PhotoGrid(sections: feed.photos.groupedByDay(), rep: rep) { Task { await feed.loadMore(store: store) } }
            }
            .padding(.bottom, 110)
        }
        .pinnedHeader {
            LargeTitle(title: "Photos") {
                HStack(spacing: 8) {
                    ServerMenu()
                    CircleButton(system: "magnifyingglass") { withAnimation(.easeOut(duration: 0.2)) { router.searching = true } }
                }
            }
            if hasEdits {
                Segmented(options: [(.all, "All"), (.edited, "Edited")], selection: $filter)
                    .padding(.horizontal, 18).padding(.top, 14).padding(.bottom, 10)
            }
        }
        .scrollIndicators(.hidden)
        .refreshable { await reload() }
        .toolbar(.hidden, for: .navigationBar)
        .background(Theme.bg)
        .task(id: "\(active)-\(store.libraryVersion)") { await reload() }
        .task { await store.loadSettings() }
        .onChange(of: store.defaultView) { _, v in if !touched { filter = v == "edited" ? .edited : .all } }
        .onChange(of: filter) { _, new in if new != (store.defaultView == "edited" ? .edited : .all) { touched = true } }
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

/// Small menu next to the title: which server, add another device, and disconnect.
struct ServerMenu: View {
    @Environment(ServerStore.self) private var store
    @State private var confirm = false
    @State private var adding = false
    var body: some View {
        Menu {
            Section(store.server?.host() ?? "Server") {
                Button("Add a device…", systemImage: "qrcode") { adding = true }
                Button("Disconnect this iPhone", role: .destructive) { confirm = true }
            }
        } label: {
            Image(systemName: "ellipsis").font(.system(size: 17, weight: .medium))
                .frame(width: 40, height: 40).background(Circle().fill(Theme.hover))
        }
        .confirmationDialog("Disconnect from your server? You’ll need a new pairing code to come back.", isPresented: $confirm, titleVisibility: .visible) {
            Button("Disconnect", role: .destructive) { store.disconnect() }
        }
        .sheet(isPresented: $adding) { AddDeviceView() }
    }
}
