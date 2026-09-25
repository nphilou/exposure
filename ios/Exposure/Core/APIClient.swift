import Foundation

enum APIError: LocalizedError {
    case unauthorized, server(String), unreachable
    var errorDescription: String? {
        switch self {
        case .unauthorized: "This device is no longer paired."
        case .server(let m): m
        case .unreachable: "Can’t reach your server."
        }
    }
}

/// Thin async client for the Exposure server (mirrors web/src/api.ts).
struct APIClient: Sendable {
    let base: URL
    let token: String?

    static let session: URLSession = {
        let c = URLSessionConfiguration.default
        c.urlCache = URLCache(memoryCapacity: 64 << 20, diskCapacity: 500 << 20)   // thumbnails are immutable
        c.requestCachePolicy = .useProtocolCachePolicy
        c.timeoutIntervalForRequest = 20
        return URLSession(configuration: c)
    }()

    private static let decoder: JSONDecoder = {
        let d = JSONDecoder()
        let iso = ISO8601DateFormatter(); iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let plain = ISO8601DateFormatter()
        d.dateDecodingStrategy = .custom { dec in
            let s = try dec.singleValueContainer().decode(String.self)
            if let v = iso.date(from: s) ?? plain.date(from: s) { return v }
            throw DecodingError.dataCorrupted(.init(codingPath: dec.codingPath, debugDescription: "bad date \(s)"))
        }
        return d
    }()

    func url(_ path: String, _ query: [String: String?] = [:]) -> URL {
        var c = URLComponents(url: base.appending(path: path), resolvingAgainstBaseURL: false)!
        let items = query.compactMap { k, v in v.map { URLQueryItem(name: k, value: $0) } }.sorted { $0.name < $1.name }
        if !items.isEmpty { c.queryItems = items }
        return c.url!
    }

    func request(_ url: URL, method: String = "GET", body: (any Encodable)? = nil) -> URLRequest {
        var r = URLRequest(url: url)
        r.httpMethod = method
        if let token { r.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let body {
            r.setValue("application/json", forHTTPHeaderField: "Content-Type")
            r.httpBody = try? JSONEncoder().encode(body)
        }
        return r
    }

    func send<T: Decodable>(_ r: URLRequest, as: T.Type = T.self) async throws -> T {
        let (data, resp): (Data, URLResponse)
        do { (data, resp) = try await Self.session.data(for: r) } catch { throw APIError.unreachable }
        let status = (resp as? HTTPURLResponse)?.statusCode ?? 0
        if status == 401 { throw APIError.unauthorized }
        guard (200..<300).contains(status) else {
            let msg = (try? JSONDecoder().decode([String: String].self, from: data))?["error"] ?? "Server error (\(status))"
            throw APIError.server(msg)
        }
        return try Self.decoder.decode(T.self, from: data)
    }

    func get<T: Decodable>(_ path: String, _ query: [String: String?] = [:]) async throws -> T {
        try await send(request(url(path, query)))
    }

    // MARK: endpoints
    func session() async throws -> Session { try await get("/api/session") }
    func redeem(code: String, name: String) async throws -> String {
        let r: TokenResponse = try await send(request(url("/api/pair/redeem"), method: "POST", body: ["code": code, "name": name]))
        return r.token
    }
    struct PairCode: Decodable, Sendable { let code: String; let expiresAt: Double; let path: String }
    /// One-time code another device can redeem; `path` is `/pair?code=…`, appended to the server's address.
    func newPairingCode() async throws -> PairCode {
        try await send(request(url("/api/pair/new"), method: "POST", body: [String: String]()))
    }
    /// Removes this device from the server (its token stops working).
    func revokeSelf() async throws {
        struct OK: Decodable {}
        let _: OK = try await send(request(url("/api/devices/me"), method: "DELETE"))
    }
    func shoots() async throws -> [Shoot] { try await get("/api/shoots") }
    func albums() async throws -> [Album] { try await get("/api/albums") }
    func createAlbum(_ title: String) async throws -> Int {
        struct Created: Decodable { let id: Int }
        let r: Created = try await send(request(url("/api/albums"), method: "POST", body: ["title": title]))
        return r.id
    }
    func addToAlbum(_ album: Int, photoIds: [String]) async throws {
        struct OK: Decodable {}
        let _: OK = try await send(request(url("/api/albums/\(album)/photos"), method: "POST", body: ["photoIds": photoIds]))
    }
    func suggestions() async throws -> [Suggestion] { try await get("/api/search/suggest") }

    // Album share links (read-only pages at /s/<token> for people without a device).
    func shares(album: Int) async throws -> [AlbumShare] { try await get("/api/albums/\(album)/shares") }
    struct NewShare: Encodable { let name: String; let expiresInDays: Int?; let allowOriginals: Bool }
    /// `path` is `/s/<token>`, appended to the server's address. The server can't show it again.
    func createShare(album: Int, _ body: NewShare) async throws -> CreatedShare {
        try await send(request(url("/api/albums/\(album)/shares"), method: "POST", body: body))
    }
    func deleteShare(_ id: String) async throws {
        struct OK: Decodable {}
        let _: OK = try await send(request(url("/api/shares/\(id)"), method: "DELETE"))
    }

    struct PhotoQuery: Hashable, Sendable {
        var q: String?, shoot: String?, album: Int?, fav = false, edited = false
    }
    func photos(_ f: PhotoQuery, limit: Int = 500, offset: Int = 0) async throws -> [Photo] {
        try await get("/api/photos", [
            "q": f.q, "shoot": f.shoot, "album": f.album.map(String.init), "fav": f.fav ? "1" : nil,
            "edited": f.edited ? "1" : nil, "limit": String(limit), "offset": String(offset),
        ])
    }
    func setFav(_ id: String, _ fav: Bool) async throws {
        struct OK: Decodable {}
        let _: OK = try await send(request(url("/api/photos/\(id)/fav"), method: "POST", body: ["fav": fav]))
    }

    func thumbURL(_ id: String, width: Int, version: Version.Key? = nil) -> URL {
        url("/api/photos/\(id)/thumb", ["w": String(width), "v": version?.rawValue])
    }
    func previewURL(_ id: String, version: Version.Key? = nil) -> URL {
        url("/api/photos/\(id)/preview", ["v": version?.rawValue])
    }
    func originalURL(_ id: String, version: Version.Key? = nil) -> URL {
        url("/api/photos/\(id)/original", ["v": version?.rawValue])
    }
}
