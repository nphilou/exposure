import SwiftUI

/// 3-column square grid with optional section headers (design: 2pt gaps, heart on favorites).
struct PhotoGrid: View {
    @Environment(ServerStore.self) private var store
    @Environment(Router.self) private var router
    @Environment(\.zoomNamespace) private var zoom
    let sections: [PhotoSection]
    var showHeaders = true
    /// Version to show as the thumbnail when the photo has it (Edited / Originals filters).
    var rep: Version.Key? = nil
    var onNearEnd: (() -> Void)? = nil

    private let columns = Array(repeating: GridItem(.flexible(), spacing: 2), count: 3)

    var body: some View {
        let all = sections.flatMap(\.photos)
        let lastIDs = Set(all.suffix(40).map(\.id))
        LazyVStack(alignment: .leading, spacing: 0) {
            ForEach(sections) { s in
                if showHeaders {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text(s.title).font(.geist(15, .semibold))
                        Text(s.sub).font(.geist(13)).foregroundStyle(Theme.tx2)
                    }
                    .padding(.horizontal, 18).padding(.top, 18).padding(.bottom, 9)
                }
                LazyVGrid(columns: columns, spacing: 2) {
                    ForEach(s.photos) { p in
                        cell(p)
                            .onTapGesture { router.open(p, in: all) }
                            .onAppear { if lastIDs.contains(p.id) { onNearEnd?() } }
                    }
                }
            }
        }
    }

    private func cell(_ p: Photo) -> some View {
        let v = rep.flatMap { r in p.versions.contains { $0.key == r } ? r : nil }
        return Color.clear
            .aspectRatio(1, contentMode: .fit)
            .overlay { AuthImage(url: store.api!.thumbURL(p.id, width: 400, version: v)) }
            .clipped()
            .overlay(alignment: .bottomLeading) {
                if store.isFav(p) {
                    Image(systemName: "heart.fill").font(.system(size: 11)).foregroundStyle(.white)
                        .shadow(color: .black.opacity(0.5), radius: 2).padding(6)
                }
            }
            .contentShape(Rectangle())
            .modifier(ZoomSource(id: p.id, ns: zoom))
    }
}

private struct ZoomSource: ViewModifier {
    let id: String
    let ns: Namespace.ID?
    func body(content: Content) -> some View {
        if let ns { content.matchedTransitionSource(id: id, in: ns) } else { content }
    }
}
