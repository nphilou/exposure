import Foundation

/// What a pairing QR / manual entry resolves to: the server origin and the one-time code.
struct PairingTarget: Equatable, Sendable {
    let server: URL
    let code: String

    /// Parses the QR payload `http(s)://host[:port]/pair?code=XXXXXXXX`.
    static func parse(qr: String) -> PairingTarget? {
        guard let comps = URLComponents(string: qr.trimmingCharacters(in: .whitespacesAndNewlines)),
              let scheme = comps.scheme?.lowercased(), scheme == "http" || scheme == "https",
              let host = comps.host, !host.isEmpty,
              let code = comps.queryItems?.first(where: { $0.name == "code" })?.value, !normalize(code).isEmpty
        else { return nil }
        var origin = URLComponents(); origin.scheme = scheme; origin.host = host; origin.port = comps.port
        guard let url = origin.url else { return nil }
        return PairingTarget(server: url, code: normalize(code))
    }

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
