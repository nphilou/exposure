import SwiftUI

/// Square grid with optional section headers (design: 2pt gaps, heart on favorites).
/// Pinch to zoom out like Photos: 3 → 5 → 7 columns; zoomed out, headers become floating date pills.
struct PhotoGrid: View {
    @Environment(ServerStore.self) private var store
    @Environment(Router.self) private var router
    @Environment(\.zoomNamespace) private var zoom
    let sections: [PhotoSection]
    var showHeaders = true
    /// Version to show as the thumbnail when the photo has it (Edited / Originals filters).
    var rep: Version.Key? = nil
    var onNearEnd: (() -> Void)? = nil

    /// Columns per row, shared by every grid and remembered across launches.
    @AppStorage("grid.columns") private var columns = 3
    @State private var pinch: CGFloat = 1
    @State private var pinchBase: CGFloat = 1
    @State private var pinchAnchor: UnitPoint = .center
    /// Leftmost photo on the row near the top of the screen, kept in view when the column count changes.
    @State private var topPhoto: String?

    private static let levels = [3, 5, 7]
    private static let anchorLine: CGFloat = 120
    private static let pillSpace: CGFloat = 50
    private var level: Int { Self.levels.firstIndex(of: columns) ?? 0 }
    private var dense: Bool { level > 0 }
    private var gap: CGFloat { dense ? 1 : 2 }

    var body: some View {
        let all = sections.flatMap(\.photos)
        let lastIDs = Set(all.suffix(40).map(\.id))
        let grid = Array(repeating: GridItem(.flexible(), spacing: gap), count: Self.levels[level])
        ScrollViewReader { proxy in
            LazyVStack(alignment: .leading, spacing: 0, pinnedViews: dense ? [.sectionHeaders] : []) {
                ForEach(sections) { s in
                    Section {
                        LazyVGrid(columns: grid, spacing: gap) {
                            ForEach(s.photos) { p in
                                cell(p)
                                    .onTapGesture { router.open(p, in: all) }
                                    .onAppear { if lastIDs.contains(p.id) { onNearEnd?() } }
                            }
                        }
                        .padding(.top, dense && showHeaders && !s.title.isEmpty ? -Self.pillSpace : 0)
                        .padding(.bottom, dense ? gap : 0)
                    } header: {
                        header(s)
                    }
                }
            }
            .scaleEffect(pinch, anchor: pinchAnchor)
            .simultaneousGesture(magnify(proxy))
        }
    }

    @ViewBuilder private func header(_ s: PhotoSection) -> some View {
        if dense {
            // The grid is pulled up under the header (see pillSpace) so the pill floats over the first row,
            // pins to the top, and gets pushed away by the next section's pill.
            if showHeaders && !s.title.isEmpty {
                DatePill(title: s.title, sub: s.sub).padding(10)
                    .frame(maxWidth: .infinity, minHeight: Self.pillSpace, maxHeight: Self.pillSpace, alignment: .topLeading)
                    .zIndex(1)
            }
        } else if showHeaders {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(s.title).font(.geist(15, .semibold))
                Text(s.sub).font(.geist(13)).foregroundStyle(Theme.tx2)
            }
            .padding(.horizontal, 18).padding(.top, 18).padding(.bottom, 9)
        }
    }

    private func cell(_ p: Photo) -> some View {
        let v = rep.flatMap { r in p.versions.contains { $0.key == r } ? r : nil }
        return Color.clear
            .aspectRatio(1, contentMode: .fit)
            .overlay { AuthImage(url: store.api!.thumbURL(p.id, width: 400, version: v)) }
            .clipped()
            .overlay(alignment: .bottomLeading) {
                if store.isFav(p) && level < 2 {
                    Image(systemName: "heart.fill").font(.system(size: dense ? 8 : 11)).foregroundStyle(.white)
                        .shadow(color: .black.opacity(0.5), radius: 2).padding(dense ? 3 : 6)
                }
            }
            .contentShape(Rectangle())
            .modifier(ZoomSource(id: p.id, ns: zoom))
            .id(p.id)
            .onGeometryChange(for: Bool.self) { g in
                let f = g.frame(in: .scrollView)
                return f.minX < 1 && f.minY <= Self.anchorLine && f.maxY > Self.anchorLine
            } action: { onLine in
                if onLine { topPhoto = p.id } else if topPhoto == p.id { topPhoto = nil }
            }
    }

    /// Switches level as soon as the pinch crosses a threshold (like Photos), and follows the fingers in between.
    private func magnify(_ proxy: ScrollViewProxy) -> some Gesture {
        MagnifyGesture()
            .onChanged { v in
                pinchAnchor = v.startAnchor
                let m = v.magnification / pinchBase
                let next = m < 1 ? level + 1 : level - 1
                guard Self.levels.indices.contains(next) else {
                    pinch = 1 + (m - 1) * 0.1 // nothing further this way: resist
                    return
                }
                if m < 0.8 || m > 1.25 {
                    pinchBase = v.magnification
                    let anchor = topPhoto
                    withAnimation(.snappy(duration: 0.3)) {
                        pinch = 1
                        columns = Self.levels[next]
                        if let anchor { proxy.scrollTo(anchor, anchor: UnitPoint(x: 0, y: 0.15)) }
                    }
                } else {
                    pinch = 1 + (m - 1) * 0.5
                }
            }
            .onEnded { _ in
                pinchBase = 1
                withAnimation(.snappy(duration: 0.25)) { pinch = 1 }
            }
    }
}

/// "22 September · Akita Show" on a blurred capsule, shown over the zoomed-out grid.
private struct DatePill: View {
    let title: String
    let sub: String
    var body: some View {
        HStack(spacing: 5) {
            Text(title).font(.geist(13, .semibold))
            if !sub.isEmpty {
                Text("·").foregroundStyle(.secondary)
                Text(sub).font(.geist(13)).lineLimit(1)
            }
        }
        .foregroundStyle(Theme.tx)
        .padding(.horizontal, 11).padding(.vertical, 6)
        .background(.regularMaterial, in: Capsule())
        .shadow(color: .black.opacity(0.15), radius: 6, y: 2)
        .allowsHitTesting(false)
    }
}

private struct ZoomSource: ViewModifier {
    let id: String
    let ns: Namespace.ID?
    func body(content: Content) -> some View {
        if let ns { content.matchedTransitionSource(id: id, in: ns) } else { content }
    }
}
