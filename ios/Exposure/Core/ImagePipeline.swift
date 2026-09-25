import SwiftUI
import UIKit

/// Loads images with the device token (AsyncImage can't send headers). Memory cache here, disk cache via URLCache.
actor ImagePipeline {
    static let shared = ImagePipeline()
    private let memory = NSCache<NSURL, UIImage>()
    private var inflight: [URL: Task<UIImage?, Never>] = [:]

    init() { memory.totalCostLimit = 200 << 20 }

    nonisolated func cached(_ url: URL) -> UIImage? { memory.object(forKey: url as NSURL) }

    func image(_ url: URL, token: String?) async -> UIImage? {
        if let hit = memory.object(forKey: url as NSURL) { return hit }
        if let t = inflight[url] { return await t.value }
        let t = Task<UIImage?, Never> {
            var r = URLRequest(url: url)
            if let token { r.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
            guard let (data, resp) = try? await APIClient.session.data(for: r),
                  (resp as? HTTPURLResponse)?.statusCode == 200,
                  let img = UIImage(data: data)?.preparingForDisplay() else { return nil }
            return img
        }
        inflight[url] = t
        let img = await t.value
        inflight[url] = nil
        if let img { memory.setObject(img, forKey: url as NSURL, cost: Int(img.size.width * img.size.height * img.scale * img.scale * 4)) }
        return img
    }
}

/// An authenticated image. `placeholder` URL (e.g. the grid thumbnail) is shown while `url` loads.
struct AuthImage: View {
    @Environment(ServerStore.self) private var store
    let url: URL
    var placeholder: URL? = nil
    var contentMode: ContentMode = .fill
    @State private var image: UIImage?

    var body: some View {
        ZStack {
            // Check the cache while rendering too: .task runs after the first frame, so cells scrolled or
            // zoomed into view would otherwise flash the skeleton for a frame even when their image is ready.
            if let image = ImagePipeline.shared.cached(url) ?? image {
                Image(uiImage: image).resizable().aspectRatio(contentMode: contentMode)
            } else {
                Theme.skel
            }
        }
        .task(id: url) {
            if let hit = ImagePipeline.shared.cached(url) { image = hit; return }
            if let placeholder, image == nil { image = ImagePipeline.shared.cached(placeholder) }
            if let img = await ImagePipeline.shared.image(url, token: store.token) { image = img }
        }
    }
}
