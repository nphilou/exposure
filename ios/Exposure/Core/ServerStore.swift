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
    /// Why we were sent back to pairing (e.g. the server revoked this device); shown once on the welcome screen.
    var unpairedReason: String?
    /// Library rules → "Open the library on": "all" or "edited". Cached so launch starts on the right filter.
    var defaultView: String = UserDefaults.standard.string(forKey: "defaultView") ?? "all" {
        didSet { UserDefaults.standard.set(defaultView, forKey: "defaultView") }
    }
    /// Photos with an edited version. The All / Edited filter only appears when there are some; cached for launch.
    var editedCount: Int = UserDefaults.standard.integer(forKey: "editedCount") {
        didSet { UserDefaults.standard.set(editedCount, forKey: "editedCount") }
    }

    var api: APIClient? { server.map { APIClient(base: $0, token: token) } }
    var isPaired: Bool { server != nil && token != nil }

    init() {
        server = Keychain.get("server").flatMap(URL.init(string:))
        token = Keychain.get("token")
    }

    func pair(_ target: PairingTarget) async throws {
        let t = try await APIClient(base: target.server, token: nil).redeem(code: target.code, name: UIDevice.current.name)
        let switching = isPaired, old = api
        Keychain.set(target.server.absoluteString, for: "server")
        Keychain.set(t, for: "token")
        server = target.server; token = t; unpairedReason = nil
        if switching {   // re-paired from a link while connected: drop the old library's state and reload
            shoots = []; albums = []; favs = [:]; libraryVersion += 1
            if let old { Self.revokeInBackground(old) }
            await loadCollections()
        }
    }

    /// The person chose to disconnect: forget the server here and remove this device from its list there.
    func disconnect() {
        if let api { Self.revokeInBackground(api) }
        unpair()
    }

    /// Best effort: the old server may be unreachable, or refuse because this is its only device
    /// (that guard keeps the owner from being locked out). Either way the entry just stays in Settings → Devices.
    private static func revokeInBackground(_ api: APIClient) {
        Task.detached { try? await api.revokeSelf() }
    }

    func unpair() {
        Keychain.set(nil, for: "token"); Keychain.set(nil, for: "server")
        token = nil; server = nil; shoots = []; albums = []; favs = [:]; editedCount = 0
    }

    /// Runs a request; a 401 means this device was revoked on the server → back to pairing.
    func call<T>(_ body: (APIClient) async throws -> T) async throws -> T {
        guard let api else { throw APIError.unauthorized }
        do {
            let r = try await body(api)
            unreachable = false
            return r
        } catch APIError.unauthorized {
            if isPaired { unpairedReason = "This iPhone is no longer paired with your server. Scan a new pairing code to reconnect." }
            unpair(); throw APIError.unauthorized
        } catch APIError.unreachable {
            unreachable = true; throw APIError.unreachable
        }
    }

    private struct SetupState: Decodable { let defaultView: String? }
    func loadSettings() async {
        if let s: SetupState = try? await call({ try await $0.get("/api/setup/state") }), let v = s.defaultView { defaultView = v }
    }

    func loadCollections() async {
        async let s = try? call { try await $0.shoots() }
        async let a = try? call { try await $0.albums() }
        if let v = await s { shoots = v; editedCount = v.reduce(0) { $0 + $1.edited } }
        if let v = await a { albums = v }
    }

    /// Adds the photo to an album, creating it first when `album` is nil.
    func addToAlbum(_ p: Photo, album: Int?, newTitle: String = "") async throws {
        let id: Int
        if let album { id = album } else { id = try await call { try await $0.createAlbum(newTitle) } }
        try await call { try await $0.addToAlbum(id, photoIds: [p.id]) }
        await loadCollections()
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
                let status = (resp as? HTTPURLResponse)?.statusCode
                if status == 401 { _ = try? await call { _ in throw APIError.unauthorized }; return }
                guard status == 200 else { throw APIError.unreachable }
                for try await line in bytes.lines where line.hasPrefix("event: indexed") {
                    libraryVersion += 1
                    await loadCollections()
                    await loadSettings()
                }
            } catch {}
            try? await Task.sleep(for: .seconds(10))
        }
    }
}
