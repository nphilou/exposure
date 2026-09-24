import SwiftUI

enum Tab: String, CaseIterable { case photos = "Photos", shoots = "Shoots", albums = "Albums" }

private struct ZoomNamespaceKey: EnvironmentKey { static let defaultValue: Namespace.ID? = nil }
extension EnvironmentValues {
    /// Shared namespace for the grid → viewer zoom transition.
    var zoomNamespace: Namespace.ID? {
        get { self[ZoomNamespaceKey.self] }
        set { self[ZoomNamespaceKey.self] = newValue }
    }
}

struct MainTabs: View {
    @Environment(ServerStore.self) private var store
    @Environment(Router.self) private var router
    @State private var tab: Tab = .photos
    @Namespace private var zoom

    var body: some View {
        @Bindable var router = router
        ZStack(alignment: .bottom) {
            // Keep every tab alive so scroll positions survive switching.
            ForEach(Tab.allCases, id: \.self) { t in
                NavigationStack { root(t) }
                    .opacity(tab == t ? 1 : 0)
                    .allowsHitTesting(tab == t)
            }
            TabPill(tab: $tab).padding(.bottom, 6)
            if router.searching {
                SearchView().transition(.opacity).zIndex(2)
            }
        }
        .environment(\.zoomNamespace, zoom)
        .background(Theme.bg.ignoresSafeArea())
        .foregroundStyle(Theme.tx)
        .fullScreenCover(item: $router.viewer) { ctx in
            ViewerView(context: ctx)
                .navigationTransition(.zoom(sourceID: ctx.start, in: zoom))
        }
        .task { await store.loadCollections() }
        .task { await store.watchEvents() }
        #if DEBUG
        .task {
            if let t = DebugHooks.tab { tab = t }
            guard let o = DebugHooks.open else { return }
            if o == "search" { router.searching = true; return }
            if o == "viewer" || o == "info", let list = try? await store.call({ try await $0.photos(.init(), limit: 30) }), let p = list.first(where: { $0.hasEdit }) ?? list.first {
                router.open(p, in: list)
            }
        }
        #endif
    }

    @ViewBuilder private func root(_ t: Tab) -> some View {
        switch t {
        case .photos: PhotosView()
        case .shoots: ShootsView()
        case .albums: AlbumsView()
        }
    }
}

/// The design's floating glass pill tab bar.
private struct TabPill: View {
    @Binding var tab: Tab
    @Namespace private var ns

    var body: some View {
        HStack(spacing: 0) {
            ForEach(Tab.allCases, id: \.self) { t in
                Button {
                    withAnimation(.snappy(duration: 0.25)) { tab = t }
                } label: {
                    Text(t.rawValue).font(.geist(14, .medium)).foregroundStyle(Theme.tx)
                        .padding(.horizontal, 20).frame(height: 44)
                        .background {
                            if tab == t { Capsule().fill(Theme.sel).matchedGeometryEffect(id: "tab", in: ns) }
                        }
                        .contentShape(Capsule())
                }
                .buttonStyle(.plain)
            }
        }
        .padding(4)
        .background(.ultraThinMaterial, in: Capsule())
        .overlay(Capsule().stroke(Theme.line2, lineWidth: 1))
        .shadow(color: .black.opacity(0.18), radius: 12, y: 8)
    }
}

/// Large title row used by the three tab roots.
struct LargeTitle<Trailing: View>: View {
    let title: String
    @ViewBuilder var trailing: Trailing
    var body: some View {
        HStack {
            Text(title).font(.geist(34, .semibold)).kerning(-1.2)
            Spacer()
            trailing
        }
        .padding(.horizontal, 18).padding(.top, 6)
    }
}

extension LargeTitle where Trailing == EmptyView {
    init(title: String) { self.title = title; self.trailing = EmptyView() }
}

struct UnreachableBanner: View {
    @Environment(ServerStore.self) private var store
    var retry: () async -> Void
    var body: some View {
        if store.unreachable {
            HStack {
                Text("Can’t reach your server.").font(.geist(14))
                Spacer()
                Button("Try again") { Task { await retry() } }.font(.geist(14, .medium))
            }
            .padding(.horizontal, 14).padding(.vertical, 11)
            .background(RoundedRectangle(cornerRadius: 12).fill(Theme.hover))
            .padding(.horizontal, 18).padding(.top, 10)
        }
    }
}
