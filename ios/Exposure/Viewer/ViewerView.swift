import SwiftUI

/// Full-screen viewer from the mobile design: swipe ←/→ between photos, ↑ for info, ↓ to close,
/// double-tap / pinch to zoom, tap to hide controls, and a version picker.
struct ViewerView: View {
    @Environment(ServerStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let context: ViewerContext

    @State private var currentID: String?
    @State private var versions: [String: Version.Key] = [:]
    @State private var chrome = true
    @State private var sheet = false
    @State private var picker = false
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
                    if picker { pickerCard(p).transition(.move(edge: .bottom).combined(with: .opacity)) }
                    versionPill(p)
                }
                .opacity(chromeOn || picker ? 1 : 0).allowsHitTesting(chromeOn || picker)

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
        .statusBarHidden(!chromeOn)
        .preferredColorScheme(.dark)
        .onAppear {
            currentID = context.start
            #if DEBUG
            if DebugHooks.open == "info" { DispatchQueue.main.asyncAfter(deadline: .now() + 1) { sheet = true } }
            #endif
        }
        .onChange(of: currentID) { picker = false; zoomed = false }
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
        .scrollDisabled(zoomed || sheet)
    }

    private func page(_ p: Photo) -> some View {
        let v = versions[p.id]
        let api = store.api!
        return ZoomableImage(url: api.previewURL(p.id, version: v), placeholder: api.thumbURL(p.id, width: 400, version: v),
                             token: store.token,
                             onTap: { if sheet { sheet = false } else if picker { picker = false } else { chrome.toggle() } },
                             onZoomChange: { zoomed = $0 })
    }

    // MARK: gestures (vertical only; horizontal paging is the scroll view)

    private var verticalDrag: some Gesture {
        DragGesture(minimumDistance: 12)
            .onChanged { g in
                if axis == nil { axis = abs(g.translation.height) > abs(g.translation.width) ? .vertical : .horizontal }
                guard axis == .vertical, !zoomed else { return }
                picker = false
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
        picker = false
    }

    // MARK: chrome

    private func topBar(_ p: Photo) -> some View {
        HStack(alignment: .top) {
            Button { dismiss() } label: {
                Image(systemName: "chevron.left").font(.system(size: 20, weight: .medium)).frame(width: 44, height: 44)
            }
            Spacer()
            VStack(spacing: 2) {
                Text(p.shootTitle).font(.geist(15, .semibold))
                Text("\(Fmt.longDate.string(from: p.takenAt)) · \(Fmt.time.string(from: p.takenAt))")
                    .font(.geist(12)).foregroundStyle(.white.opacity(0.6))
            }
            .padding(.top, 4)
            Spacer()
            Button { store.toggleFav(p) } label: {
                Image(systemName: store.isFav(p) ? "heart.fill" : "heart").font(.system(size: 20)).frame(width: 44, height: 44)
            }
        }
        .foregroundStyle(.white).buttonStyle(.plain)
        .padding(.horizontal, 10)
        .padding(.bottom, 30)
        .background(LinearGradient(colors: [.black.opacity(0.5), .clear], startPoint: .top, endPoint: .bottom).ignoresSafeArea())
    }

    private func versionPill(_ p: Photo) -> some View {
        let cur = p.version(versions[p.id])
        return Button { withAnimation(.snappy) { picker.toggle() } } label: {
            HStack(spacing: 8) {
                Text(cur?.label ?? "")
                Text("· \(p.versions.count) version\(p.versions.count == 1 ? "" : "s")").foregroundStyle(.white.opacity(0.5))
            }
            .font(.geist(14)).foregroundStyle(.white)
            .padding(.horizontal, 16).frame(height: 40)
            .background(.ultraThinMaterial, in: Capsule())
            .overlay(Capsule().stroke(.white.opacity(0.14)))
        }
        .buttonStyle(.plain)
        .padding(.bottom, 20)
    }

    private func pickerCard(_ p: Photo) -> some View {
        let cur = versions[p.id] ?? p.best
        return VStack(alignment: .leading, spacing: 0) {
            Text("Versions").font(.geist(12)).foregroundStyle(Theme.viewerTx.opacity(0.5)).padding(.horizontal, 12).padding(.top, 8).padding(.bottom, 6)
            ForEach(p.versions, id: \.key) { v in
                Button { select(v.key, for: p) } label: {
                    HStack(spacing: 12) {
                        Circle().fill(Theme.viewerTx).frame(width: 7, height: 7).opacity(v.key == cur ? 1 : 0).frame(width: 10)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(v.label).font(.geist(16))
                            Text("\(v.fmt) · \(v.sizeLabel)").font(.geist(12)).foregroundStyle(Theme.viewerTx.opacity(0.5))
                        }
                        Spacer()
                    }
                    .padding(12).contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
        .foregroundStyle(Theme.viewerTx)
        .padding(8)
        .background(RoundedRectangle(cornerRadius: 18).fill(Color(white: 0.14).opacity(0.96)))
        .overlay(RoundedRectangle(cornerRadius: 18).stroke(.white.opacity(0.08)))
        .padding(.horizontal, 10).padding(.bottom, 12)
    }
}
