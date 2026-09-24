import Foundation
import Observation

/// Paged list of photos for one query (a tab filter, a shoot, an album or a search).
@MainActor @Observable
final class PhotoFeed {
    private(set) var photos: [Photo] = []
    private(set) var loading = false
    private(set) var loaded = false
    private var done = false
    private var query = APIClient.PhotoQuery()
    private var generation = 0
    private let page = 500

    func load(_ q: APIClient.PhotoQuery, store: ServerStore) async {
        generation += 1
        let gen = generation
        query = q; done = false; loading = true
        defer { if gen == generation { loading = false } }
        guard let first = try? await store.call({ try await $0.photos(q, limit: self.page) }), gen == generation else { return }
        photos = first; done = first.count < page; loaded = true
    }

    func loadMore(store: ServerStore) async {
        guard !done, !loading else { return }
        let gen = generation
        loading = true; defer { loading = false }
        guard let next = try? await store.call({ try await $0.photos(self.query, limit: self.page, offset: self.photos.count) }), gen == generation else { return }
        photos += next; done = next.count < page
    }
}

struct PhotoSection: Identifiable {
    let id: String
    let title: String
    let sub: String
    let photos: [Photo]
}

extension Array where Element == Photo {
    /// Groups consecutive photos by shoot + calendar day ("22 September · Akita Show").
    func groupedByDay() -> [PhotoSection] {
        var out: [PhotoSection] = []
        var cur: [Photo] = []
        var key = ""
        let cal = Calendar.current
        func flush() {
            guard let p = cur.first else { return }
            out.append(PhotoSection(id: key, title: Fmt.dayMonth.string(from: p.takenAt), sub: p.shootTitle, photos: cur))
        }
        for p in self {
            let d = cal.dateComponents([.year, .month, .day], from: p.takenAt)
            let k = "\(p.shootId)-\(d.year!)-\(d.month!)-\(d.day!)"
            if k != key { flush(); cur = []; key = k }
            cur.append(p)
        }
        flush()
        return out
    }
}
