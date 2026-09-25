import SwiftUI

/// Full-screen viewer from the mobile design: swipe ←/→ between photos, ↑ for info, ↓ to close,
/// double-tap / pinch to zoom, tap to hide controls. Chrome follows Photos: glass buttons, a thumbnail strip
/// to scrub through the photos, share on the left and favorite / add to album in the middle.
struct ViewerView: View {
    @Environment(ServerStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let context: ViewerContext

    @State private var currentID: String?
    @State private var versions: [String: Version.Key] = [:]
    @State private var chrome = true
    @State private var sheet = false
    @State private var addingToAlbum: Photo?
    @State private var stripID: String?
    @State private var stripScrolling = false
    @State private var zoomed = false
    @State private var dragY: CGFloat = 0
    @State private var axis: Axis?

    private var photos: [Photo] { context.photos }
    private var current: Photo? { photos.first { $0.id == currentID } ?? photos.first { $0.id == context.start } }
    private var pull: CGFloat { !sheet && dragY > 0 ? dragY : 0 }
    private var chromeOn: Bool { chrome && !sheet && !zoomed }

    var body: some View {
        ZStack {
            Color.black.opacity(Double(max(0.4, 1 - pull / 400))).ignoresSafeArea()

            pager
                .frame(height: sheet ? 330 : nil)
                .padding(.top, sheet ? 64 : 0)
                .frame(maxHeight: .infinity, alignment: .top)
                .offset(y: pull * 0.6)
                .scaleEffect(1 - min(pull, 300) / 1200)
                .ignoresSafeArea()

            if let p = current {
                VStack(spacing: 0) {
                    topBar(p)
                    Spacer()
                    strip
                    bottomBar(p)
                }
                .opacity(chromeOn ? 1 : 0).allowsHitTesting(chromeOn)

                InfoSheet(photo: p, current: versions[p.id] ?? p.best, select: { select($0, for: p) })
                    .frame(height: 520)
                    .offset(y: sheet ? max(0, dragY) : 600)
                    .frame(maxHeight: .infinity, alignment: .bottom)
                    .ignoresSafeArea(edges: .bottom)
            }
        }
        .animation(axis == nil ? .spring(response: 0.32, dampingFraction: 0.86) : nil, value: sheet)
        .animation(axis == nil ? .spring(response: 0.32, dampingFraction: 0.86) : nil, value: dragY)
        .animation(.easeInOut(duration: 0.2), value: chromeOn)
        .simultaneousGesture(verticalDrag, including: zoomed ? .subviews : .all)
        .sharingStatus()
        .statusBarHidden(!chromeOn)
        .preferredColorScheme(.dark)
        .sheet(item: $addingToAlbum) { AddToAlbumSheet(photo: $0) }
        .onAppear {
            currentID = context.start
            stripID = context.start
            #if DEBUG
            if DebugHooks.open == "info" { DispatchQueue.main.asyncAfter(deadline: .now() + 1) { sheet = true } }
            #endif
        }
        .onChange(of: currentID) {
            zoomed = false
            if !stripScrolling, stripID != currentID { withAnimation(.snappy) { stripID = currentID } }
        }
        // Scrubbing the strip pages the viewer; programmatic strip moves (from paging) don't feed back.
        .onChange(of: stripID) { if stripScrolling, let id = stripID, id != currentID { currentID = id } }
    }

    // MARK: pager

    private var pager: some View {
        ScrollView(.horizontal) {
            LazyHStack(spacing: 0) {
                ForEach(photos) { p in
                    page(p).containerRelativeFrame([.horizontal, .vertical])
                }
            }
            .scrollTargetLayout()
        }
        .scrollTargetBehavior(.paging)
        .scrollPosition(id: $currentID)
        .scrollIndicators(.hidden)
        .scrollDisabled(zoomed || sheet || axis == .vertical)
    }

    @ViewBuilder
    private func page(_ p: Photo) -> some View {
        let v = versions[p.id]
        // `api` goes nil if the device is unpaired (e.g. revoked on the server) while the viewer is still up.
        if let api = store.api {
            ZoomableImage(url: api.previewURL(p.id, version: v), original: api.originalURL(p.id, version: v), placeholder: api.thumbURL(p.id, width: 400, version: v),
                          token: store.token,
                          onTap: { if sheet { sheet = false } else { chrome.toggle() } },
                          onZoomChange: { zoomed = $0 })
        } else {
            Color.black
        }
    }

    // MARK: gestures (vertical only; horizontal paging is the scroll view)

    private var verticalDrag: some Gesture {
        DragGesture(minimumDistance: 6)
            .onChanged { g in
                if axis == nil { axis = abs(g.translation.height) > abs(g.translation.width) * 0.6 ? .vertical : .horizontal }
                guard axis == .vertical, !zoomed else { return }
                dragY = g.translation.height
            }
            .onEnded { g in
                defer { axis = nil; dragY = 0 }
                guard axis == .vertical, !zoomed else { return }
                let dy = g.translation.height
                if dy < -50 { sheet = true }
                else if dy > 50 {
                    if sheet { sheet = false } else if dy > 110 { dismiss() }
                }
            }
    }

    private func select(_ key: Version.Key, for p: Photo) {
        versions[p.id] = key
    }

    // MARK: chrome

    // Every button label sets a contentShape: with .plain buttons only the glyph is tappable otherwise,
    // and taps just outside the thin chevron fall through to the photo (which toggles the chrome).
    private func topBar(_ p: Photo) -> some View {
        HStack {
            Button { dismiss() } label: {
                Image(systemName: "chevron.left").font(.system(size: 19, weight: .semibold)).frame(width: 48, height: 48).contentShape(Circle())
            }
            .glass(Circle())
            Spacer(minLength: 12)
            VStack(spacing: 1) {
                Text(p.shootTitle).font(.geist(15, .semibold)).lineLimit(1)
                Text("\(Fmt.longDate.string(from: p.takenAt))  \(Fmt.time.string(from: p.takenAt))").font(.geist(12)).foregroundStyle(.white.opacity(0.75))
            }
            .padding(.horizontal, 22).frame(height: 48)
            .glass(Capsule())
            Spacer(minLength: 12)
            Menu {
                if p.versions.count > 1 {
                    Picker("Version", selection: Binding(get: { versions[p.id] ?? p.best ?? p.versions[0].key }, set: { select($0, for: p) })) {
                        ForEach(p.versions, id: \.key) { v in Text("\(v.label) · \(v.fmt)").tag(v.key) }
                    }
                }
                Button("Info", systemImage: "info.circle") { sheet = true }
            } label: {
                Image(systemName: "ellipsis").font(.system(size: 19, weight: .semibold)).frame(width: 48, height: 48).contentShape(Circle())
            }
            .glass(Circle())
        }
        .foregroundStyle(.white).buttonStyle(.plain)
        .padding(.horizontal, 16)
    }

    /// Thumbnail strip: the current photo shows at its own shape with room around it, the others as narrow crops.
    private var strip: some View {
        GeometryReader { geo in ScrollViewReader { proxy in
            ScrollView(.horizontal) {
                LazyHStack(spacing: 2) {
                    ForEach(photos) { p in
                        let on = p.id == currentID
                        Color.clear
                            .frame(width: on ? min(max(36 * p.ar, 26), 60) : 22, height: 36)
                            .overlay { if let api = store.api { AuthImage(url: api.thumbURL(p.id, width: 120, version: versions[p.id])) } else { Theme.skel } }
                            .clipShape(RoundedRectangle(cornerRadius: 2))
                            .padding(.horizontal, on ? 10 : 0)
                            .contentShape(Rectangle())
                            .onTapGesture { withAnimation(.snappy) { currentID = p.id } }
                            .id(p.id)
                    }
                }
                .scrollTargetLayout()
            }
            .contentMargins(.horizontal, geo.size.width / 2, for: .scrollContent)
            .scrollPosition(id: $stripID, anchor: .center)
            .scrollTargetBehavior(.viewAligned)
            .scrollIndicators(.hidden)
            .onScrollPhaseChange { _, phase in
                stripScrolling = phase == .interacting || phase == .decelerating
                // The current thumbnail widens after snapping; re-centre it once the strip settles.
                if phase == .idle, let id = currentID { withAnimation(.snappy) { proxy.scrollTo(id, anchor: .center) } }
            }
            .animation(.snappy(duration: 0.2), value: currentID)
        } }
        .frame(height: 36)
        .mask(LinearGradient(stops: [.init(color: .clear, location: 0), .init(color: .black, location: 0.06),
                                     .init(color: .black, location: 0.94), .init(color: .clear, location: 1)], startPoint: .leading, endPoint: .trailing))
        .padding(.bottom, 22)
    }

    private func bottomBar(_ p: Photo) -> some View {
        ZStack {
            HStack(spacing: 0) {
                Button { store.toggleFav(p) } label: {
                    Image(systemName: store.isFav(p) ? "heart.fill" : "heart").font(.system(size: 21)).frame(width: 60, height: 52).contentShape(Rectangle())
                        .contentTransition(.symbolEffect(.replace))
                }
                Button { addingToAlbum = p } label: {
                    Image(systemName: "rectangle.stack.badge.plus").font(.system(size: 20)).frame(width: 60, height: 52).contentShape(Rectangle())
                }
            }
            .padding(.horizontal, 6)
            .glass(Capsule())
            HStack {
                Button { Sharer.shared.share([p], version: versions[p.id] ?? p.best, store: store) } label: {
                    Image(systemName: "square.and.arrow.up").font(.system(size: 20)).offset(y: -1).frame(width: 52, height: 52).contentShape(Circle())
                }
                .disabled(Sharer.shared.busy)
                .glass(Circle())
                Spacer()
            }
        }
        .foregroundStyle(.white).buttonStyle(.plain)
        .padding(.horizontal, 24).padding(.bottom, 4)
    }
}

private extension View {
    /// Liquid Glass on iOS 26, a material bubble before.
    @ViewBuilder func glass<S: Shape>(_ shape: S) -> some View {
        if #available(iOS 26, *) {
            glassEffect(.regular.interactive(), in: shape)
        } else {
            background(.ultraThinMaterial, in: shape).overlay(shape.stroke(.white.opacity(0.12)))
        }
    }
}
