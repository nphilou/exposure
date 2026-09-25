import SwiftUI

/// Square grid with optional section headers (design: 2pt gaps, heart on favorites).
/// Pinch to zoom out like Photos: 3 → 5 → 7 columns; zoomed out, headers become floating date pills.
struct PhotoGrid: View {
    let sections: [PhotoSection]
    var showHeaders = true
    /// Version to show as the thumbnail when the photo has it (Edited / Originals filters).
    var rep: Version.Key? = nil
    var onNearEnd: (() -> Void)? = nil

    /// Columns per row, shared by every grid and remembered across launches.
    @AppStorage("grid.columns") private var columns = 3
    /// Scale of the grid while pinching; 1 at rest.
    @State private var pinch: CGFloat = 1
    /// The pinch centre in scroll-view coordinates; the grid scales around it.
    @State private var focus: CGPoint = .zero
    /// Slides the photo under the fingers back into its column after a column change.
    @State private var shift: CGFloat = 0
    @State private var geo = GridGeometry()
    @GestureState private var pinching = false

    static let levels = [3, 5, 7]
    /// Keeps a column change from flipping straight back when the fingers hover near the threshold.
    private static let hysteresis: CGFloat = 1.05
    private var level: Int { Self.levels.firstIndex(of: columns) ?? 0 }

    var body: some View {
        ScrollViewReader { proxy in
            GridContent(sections: sections, showHeaders: showHeaders, rep: rep, columns: Self.levels[level], geo: geo, onNearEnd: onNearEnd)
                .equatable()
                .onGeometryChange(for: CGRect.self) { $0.frame(in: .scrollView) } action: { geo.frame = $0 }
                .onGeometryChange(for: CGFloat.self) { $0.bounds(of: .scrollView)?.height ?? 0 } action: { geo.viewportHeight = $0 }
                .visualEffect { [pinch, focus, shift] content, g in
                    let f = g.frame(in: .scrollView)
                    let anchor = UnitPoint(x: (focus.x - f.minX) / max(f.width, 1), y: (focus.y - f.minY) / max(f.height, 1))
                    return content.scaleEffect(pinch, anchor: anchor).offset(x: shift)
                }
                .simultaneousGesture(magnify(proxy))
                .onChange(of: pinching) { _, on in
                    if !on { withAnimation(.snappy(duration: 0.3)) { pinch = 1; shift = 0 } }
                }
        }
    }

    /// Follows the fingers 1:1 and changes the column count once the photos get closer to the next level's size
    /// than to this one's. At the switch the scale is carried over and the grid scrolled so the photo under the
    /// fingers keeps its size and place; letting go settles on the new level.
    private func magnify(_ proxy: ScrollViewProxy) -> some Gesture {
        MagnifyGesture()
            .updating($pinching) { _, on, _ in on = true }
            .onChanged { v in
                if geo.start != v.startLocation { begin(at: v.startLocation) }
                let raw = v.magnification * geo.gain
                if level + 1 < Self.levels.count, raw * sqrt(ratio(level + 1)) < 1 / Self.hysteresis {
                    change(to: level + 1, raw: raw, proxy)
                } else if level > 0, raw * sqrt(ratio(level - 1)) > Self.hysteresis {
                    change(to: level - 1, raw: raw, proxy)
                } else {
                    pinch = resisted(raw)
                }
            }
    }

    /// Column count of level `next` relative to the current one: > 1 when zooming out.
    private func ratio(_ next: Int) -> CGFloat { CGFloat(Self.levels[next]) / CGFloat(columns) }

    /// Nothing further past the first and last levels: resist.
    private func resisted(_ raw: CGFloat) -> CGFloat {
        if level == 0 && raw > 1 { return 1 + (raw - 1) * 0.15 }
        if level == Self.levels.count - 1 && raw < 1 { return 1 - (1 - raw) * 0.15 }
        return raw
    }

    private func begin(at location: CGPoint) {
        geo.start = location
        geo.gain = 1
        focus = CGPoint(x: geo.frame.minX + location.x, y: geo.frame.minY + location.y)
        let hit = geo.cells.min { $0.value.distance(to: focus) < $1.value.distance(to: focus) }
        geo.anchor = hit?.key
        if let f = hit?.value { geo.fy = min(max((focus.y - f.minY) / max(f.height, 1), 0), 1) }
    }

    private func change(to next: Int, raw: CGFloat, _ proxy: ScrollViewProxy) {
        let old = columns, new = Self.levels[next]
        let r = ratio(next)
        geo.gain *= r
        let scale = raw * r
        var slide: CGFloat = 0
        var target: (id: String, y: CGFloat)?
        if let id = geo.anchor, let i = index(of: id) {
            let (wOld, pOld) = GridContent.cell(width: geo.frame.width, columns: old)
            let (wNew, pNew) = GridContent.cell(width: geo.frame.width, columns: new)
            // How far across the photo the fingers are now, then where its new column puts it.
            let left = focus.x + (geo.frame.minX + CGFloat(i % old) * pOld - focus.x) * pinch
            let fx = (focus.x - left) / max(wOld * pinch, 1)
            slide = scale * (focus.x - geo.frame.minX - CGFloat(i % new) * pNew - fx * wNew)
            // Scroll so the photo's top lands where the same point of it stays under the fingers.
            let top = focus.y - geo.fy * wNew
            let room = geo.viewportHeight - wNew
            if abs(room) > 1 { target = (id, top / room) }
        }
        var t = Transaction()
        t.disablesAnimations = true
        withTransaction(t) {
            columns = new
            pinch = resisted(scale)
            shift = slide
            if let target { proxy.scrollTo(target.id, anchor: UnitPoint(x: 0, y: target.y)) }
        }
        if slide != 0 {
            Task { @MainActor in withAnimation(.snappy(duration: 0.35)) { shift = 0 } }
        }
    }

    /// Position of a photo within its section, which decides its column.
    private func index(of id: String) -> Int? {
        for s in sections { if let i = s.photos.firstIndex(where: { $0.id == id }) { return i } }
        return nil
    }
}

/// Where things are on screen, for the pinch. A plain class so updating it on every scroll frame re-renders nothing.
private final class GridGeometry {
    /// The grid, in scroll-view coordinates.
    var frame: CGRect = .zero
    var viewportHeight: CGFloat = 0
    /// Cells currently laid out, in scroll-view coordinates.
    var cells: [String: CGRect] = [:]

    /// Start of the current pinch; a new value means a new gesture.
    var start: CGPoint?
    /// Scale = magnification × gain; multiplied at each column change so the photos keep their on-screen size.
    var gain: CGFloat = 1
    /// Photo under the fingers, and how far down it they are (0…1).
    var anchor: String?
    var fy: CGFloat = 0
}

/// The grid itself. Equatable so the per-frame pinch updates in PhotoGrid don't rebuild it.
private struct GridContent: View, Equatable {
    @Environment(ServerStore.self) private var store
    @Environment(Router.self) private var router
    @Environment(\.zoomNamespace) private var zoom
    let sections: [PhotoSection]
    let showHeaders: Bool
    let rep: Version.Key?
    let columns: Int
    let geo: GridGeometry
    let onNearEnd: (() -> Void)?

    private static let pillSpace: CGFloat = 50
    private var level: Int { PhotoGrid.levels.firstIndex(of: columns) ?? 0 }
    private var dense: Bool { level > 0 }
    private var gap: CGFloat { Self.gap(columns) }

    static func gap(_ columns: Int) -> CGFloat { columns > PhotoGrid.levels[0] ? 1 : 2 }
    /// Cell side and column pitch for a grid `width` wide.
    static func cell(width: CGFloat, columns: Int) -> (side: CGFloat, pitch: CGFloat) {
        let g = gap(columns)
        let side = (width - g * CGFloat(columns - 1)) / CGFloat(columns)
        return (side, side + g)
    }

    static func == (a: Self, b: Self) -> Bool {
        a.sections == b.sections && a.showHeaders == b.showHeaders && a.rep == b.rep && a.columns == b.columns
    }

    var body: some View {
        let all = sections.flatMap(\.photos)
        let lastIDs = Set(all.suffix(40).map(\.id))
        let grid = Array(repeating: GridItem(.flexible(), spacing: gap), count: columns)
        LazyVStack(alignment: .leading, spacing: 0, pinnedViews: dense ? [.sectionHeaders] : []) {
            ForEach(sections) { s in
                Section {
                    LazyVGrid(columns: grid, spacing: gap) {
                        ForEach(s.photos) { p in
                            cell(p)
                                .onTapGesture { router.open(p, in: all) }
                                .contextMenu { menu(p) }
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

    @ViewBuilder private func menu(_ p: Photo) -> some View {
        Button("Share", systemImage: "square.and.arrow.up") { Sharer.shared.share([p], version: rep, store: store) }
        Button(store.isFav(p) ? "Unfavorite" : "Favorite", systemImage: store.isFav(p) ? "heart.slash" : "heart") { store.toggleFav(p) }
    }

    private func cell(_ p: Photo) -> some View {
        let v = rep.flatMap { r in p.versions.contains { $0.key == r } ? r : nil }
        return Color.clear
            .aspectRatio(1, contentMode: .fit)
            .overlay { if let api = store.api { AuthImage(url: api.thumbURL(p.id, width: 400, version: v)) } else { Theme.skel } }
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
            .onGeometryChange(for: CGRect.self) { $0.frame(in: .scrollView) } action: { geo.cells[p.id] = $0 }
            .onDisappear { geo.cells[p.id] = nil }
    }
}

private extension CGRect {
    /// 0 inside, else the distance to the nearest edge.
    func distance(to p: CGPoint) -> CGFloat {
        hypot(max(minX - p.x, 0, p.x - maxX), max(minY - p.y, 0, p.y - maxY))
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
