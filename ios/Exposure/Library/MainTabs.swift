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
        .sharingStatus(active: router.viewer == nil)
        .environment(\.zoomNamespace, zoom)
        .background(Theme.bg.ignoresSafeArea())
        .foregroundStyle(Theme.tx)
        .fullScreenCover(item: $router.viewer) { ctx in
            ViewerView(context: ctx)
                .navigationTransition(.zoom(sourceID: ctx.start, in: zoom))
                // The zoom transition adds its own swipe-down-to-dismiss, which races the viewer's pull-down
                // (that also closes the info sheet and respects pinch-zoom); keep only the viewer's.
                .interactiveDismissDisabled()
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

/// The design's floating glass pill tab bar. Like the system tab bar, press anywhere on it and slide:
/// the highlight follows the finger and the tab under it is picked on release.
private struct TabPill: View {
    @Binding var tab: Tab
    @Namespace private var ns
    @State private var frames: [Tab: CGRect] = [:]
    /// The tab under the finger while pressed; nil when not touching.
    @State private var pressed: Tab?

    var body: some View {
        let shown = pressed ?? tab
        HStack(spacing: 0) {
            ForEach(Tab.allCases, id: \.self) { t in
                Text(t.rawValue).font(.geist(14, .medium)).foregroundStyle(Theme.tx)
                    .padding(.horizontal, 20).frame(height: 44)
                    .background {
                        if shown == t { Capsule().fill(Theme.sel).matchedGeometryEffect(id: "tab", in: ns) }
                    }
                    .onGeometryChange(for: CGRect.self) { $0.frame(in: .named("pill")) } action: { frames[t] = $0 }
                    .accessibilityAddTraits(tab == t ? [.isButton, .isSelected] : .isButton)
                    .accessibilityAction { select(t) }
            }
        }
        .padding(4)
        .coordinateSpace(.named("pill"))
        .contentShape(Capsule())
        .gesture(
            DragGesture(minimumDistance: 0, coordinateSpace: .named("pill"))
                .onChanged { g in
                    let t = nearest(g.location.x)
                    if t != pressed { withAnimation(.snappy(duration: 0.2)) { pressed = t } }
                }
                .onEnded { g in
                    let t = nearest(g.location.x)
                    pressed = nil
                    select(t)
                }
        )
        .scaleEffect(pressed == nil ? 1 : 1.04)
        .animation(.snappy(duration: 0.2), value: pressed == nil)
        .sensoryFeedback(.selection, trigger: pressed) { old, new in old != nil && new != nil }
        .background(.ultraThinMaterial, in: Capsule())
        .overlay(Capsule().stroke(Theme.line2, lineWidth: 1))
        .shadow(color: .black.opacity(0.18), radius: 12, y: 8)
    }

    private func select(_ t: Tab) {
        withAnimation(.snappy(duration: 0.25)) { tab = t }
    }

    /// The tab whose frame is horizontally closest to `x`, so sliding past either end keeps the edge tab.
    private func nearest(_ x: CGFloat) -> Tab {
        Tab.allCases.min { a, b in
            distance(x, frames[a]) < distance(x, frames[b])
        } ?? tab
    }

    private func distance(_ x: CGFloat, _ r: CGRect?) -> CGFloat {
        guard let r else { return .infinity }
        return x < r.minX ? r.minX - x : x > r.maxX ? x - r.maxX : 0
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

extension View {
    /// Pins `header` above a scroll view; content scrolls underneath it (see HeaderBackdrop).
    func pinnedHeader<H: View>(@ViewBuilder _ header: () -> H) -> some View { modifier(PinnedHeader(header: header())) }
}

private struct PinnedHeader<H: View>: ViewModifier {
    let header: H
    @State private var scrolled = false
    func body(content: Content) -> some View {
        content
            .onScrollGeometryChange(for: Bool.self) { $0.contentOffset.y + $0.contentInsets.top > 1 } action: { _, s in
                withAnimation(.easeOut(duration: 0.2)) { scrolled = s }
            }
            .safeAreaInset(edge: .top, spacing: 0) {
                VStack(alignment: .leading, spacing: 0) { header }
                    .background { HeaderBackdrop(scrolled: scrolled) }
            }
    }
}

/// Behind a pinned header: plain background at rest; once content scrolls under it, a translucent blur
/// that fades out at its bottom edge instead of ending on a hard line.
struct HeaderBackdrop: View {
    var scrolled: Bool
    var body: some View {
        ZStack {
            Theme.bg.opacity(scrolled ? 0 : 1)
            Rectangle().fill(.ultraThinMaterial).opacity(scrolled ? 1 : 0)
                .mask(LinearGradient(stops: [.init(color: .black, location: 0), .init(color: .black, location: 0.75), .init(color: .clear, location: 1)],
                                     startPoint: .top, endPoint: .bottom))
        }
        .padding(.bottom, scrolled ? -16 : 0)
        .ignoresSafeArea(edges: .top)
    }
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
