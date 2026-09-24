import Foundation
import Observation
import UIKit

/// The paired server (URL + device token) and app-wide library state.
@MainActor @Observable
final class ServerStore {
    private(set) var server: URL?
    private(set) var token: String?
    var shoots: [Shoot] = []
    var albums: [Album] = []
    var favs: [String: Bool] = [:]      // optimistic overrides, keyed by photo id
    var libraryVersion = 0              // bumped when the server re-indexes
    var unreachable = false

    var api: APIClient? { server.map { APIClient(base: $0, token: token) } }
    var isPaired: Bool { server != nil && token != nil }

    init() {
        server = Keychain.get("server").flatMap(URL.init(string:))
        token = Keychain.get("token")
    }

    func pair(_ target: PairingTarget) async throws {
        let t = try await APIClient(base: target.server, token: nil).redeem(code: target.code, name: UIDevice.current.name)
        Keychain.set(target.server.absoluteString, for: "server")
        Keychain.set(t, for: "token")
        server = target.server; token = t
    }

    func unpair() {
        Keychain.set(nil, for: "token"); Keychain.set(nil, for: "server")
        token = nil; server = nil; shoots = []; albums = []; favs = [:]
    }

    /// Runs a request; a 401 means this device was revoked on the server → back to pairing.
    func call<T>(_ body: (APIClient) async throws -> T) async throws -> T {
        guard let api else { throw APIError.unauthorized }
        do {
            let r = try await body(api)
            unreachable = false
            return r
        } catch APIError.unauthorized {
            unpair(); throw APIError.unauthorized
        } catch APIError.unreachable {
            unreachable = true; throw APIError.unreachable
        }
    }

    func loadCollections() async {
        async let s = try? call { try await $0.shoots() }
        async let a = try? call { try await $0.albums() }
        if let v = await s { shoots = v }
        if let v = await a { albums = v }
    }

    func isFav(_ p: Photo) -> Bool { favs[p.id] ?? p.fav }
    func toggleFav(_ p: Photo) {
        let new = !isFav(p)
        favs[p.id] = new
        Task { do { try await call { try await $0.setFav(p.id, new) } } catch { favs[p.id] = !new } }
    }

    /// Listens to the server's SSE stream and bumps `libraryVersion` when new photos are indexed.
    func watchEvents() async {
        while !Task.isCancelled, let api {
            do {
                let (bytes, resp) = try await APIClient.session.bytes(for: api.request(api.url("/api/events")))
                guard (resp as? HTTPURLResponse)?.statusCode == 200 else { throw APIError.unreachable }
                for try await line in bytes.lines where line.hasPrefix("event: indexed") {
                    libraryVersion += 1
                    await loadCollections()
                }
            } catch {}
            try? await Task.sleep(for: .seconds(10))
        }
    }
}
