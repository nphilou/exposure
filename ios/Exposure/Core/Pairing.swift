import Foundation

/// What a pairing QR / manual entry resolves to: the server origin and the one-time code.
struct PairingTarget: Equatable, Sendable {
    let server: URL
    let code: String

    /// Parses the QR payload `http(s)://host[:port]/pair?code=XXXXXXXX`, or the app link
    /// `exposure://pair?server=http(s)://host[:port]&code=XXXXXXXX` that the server's /pair page opens.
    static func parse(qr: String) -> PairingTarget? {
        guard let comps = URLComponents(string: qr.trimmingCharacters(in: .whitespacesAndNewlines)),
              let code = comps.queryItems?.first(where: { $0.name == "code" })?.value, !normalize(code).isEmpty
        else { return nil }
        if comps.scheme?.lowercased() == appScheme {
            guard comps.host == "pair", let s = comps.queryItems?.first(where: { $0.name == "server" })?.value,
                  let server = origin(of: s) else { return nil }
            return PairingTarget(server: server, code: normalize(code))
        }
        guard let server = origin(of: qr) else { return nil }
        return PairingTarget(server: server, code: normalize(code))
    }

    static func parse(link: URL) -> PairingTarget? { parse(qr: link.absoluteString) }

    static let appScheme = "exposure"

    /// `scheme://host[:port]` of an http(s) URL, dropping any path or query.
    private static func origin(of s: String) -> URL? {
        guard let c = URLComponents(string: s.trimmingCharacters(in: .whitespacesAndNewlines)),
              let scheme = c.scheme?.lowercased(), scheme == "http" || scheme == "https",
              let host = c.host, !host.isEmpty else { return nil }
        var o = URLComponents(); o.scheme = scheme; o.host = host; o.port = c.port
        return o.url
    }

    /// "192.168.1.20:8787" for the confirmation prompt.
    var serverLabel: String { server.host.map { h in server.port.map { "\(h):\($0)" } ?? h } ?? server.absoluteString }

    /// Accepts "192.168.1.20", "nas.local:8787", "https://exposure.tail.ts.net" etc.
    static func server(from address: String) -> URL? {
        var a = address.trimmingCharacters(in: .whitespacesAndNewlines)
        while a.hasSuffix("/") { a.removeLast() }
        guard !a.isEmpty else { return nil }
        if !a.lowercased().hasPrefix("http://") && !a.lowercased().hasPrefix("https://") {
            a = "http://" + a
            if URLComponents(string: a)?.port == nil { a += ":8787" }
        }
        guard let c = URLComponents(string: a), c.host?.isEmpty == false else { return nil }
        var origin = URLComponents(); origin.scheme = c.scheme; origin.host = c.host; origin.port = c.port
        return origin.url
    }

    static func normalize(_ code: String) -> String {
        code.uppercased().filter { $0.isLetter || $0.isNumber }
    }
}
