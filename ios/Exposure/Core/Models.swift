import Foundation

struct Version: Codable, Hashable, Sendable {
    enum Key: String, Codable, Sendable { case edited, camera, raw }
    let key: Key
    let label: String
    let fmt: String
    let size: Int
    let file: String

    var sizeLabel: String { String(format: "%.1f MB", Double(size) / 1_000_000) }
}

struct Photo: Codable, Identifiable, Hashable, Sendable {
    let id: String
    let name: String
    let shootId: String
    let shootTitle: String
    let folder: String
    let takenAt: Date
    let camera: String?
    let lens: String?
    let focal: Double?
    let fnum: Double?
    let shutter: String?
    let iso: Int?
    let ar: Double
    let hasEdit: Bool
    let hasRaw: Bool
    var fav: Bool
    let best: Version.Key?
    let versions: [Version]

    func version(_ key: Version.Key?) -> Version? {
        versions.first { $0.key == (key ?? best) } ?? versions.first
    }
}

struct Shoot: Codable, Identifiable, Hashable, Sendable {
    let id: String
    let folder: String
    let title: String
    let date: String          // YYYY-MM-DD
    let camera: String?
    let count: Int
    let edited: Int
    let cover: String?

    var day: Date { Fmt.isoDay.date(from: date) ?? .distantPast }
}

struct Album: Codable, Identifiable, Hashable, Sendable {
    let id: Int
    let title: String
    let count: Int
    let cover: String?
}

struct Suggestion: Codable, Hashable, Sendable { let label: String; let kind: String }
struct Session: Codable, Sendable { let claimed: Bool; let authenticated: Bool }
struct TokenResponse: Codable, Sendable { let token: String }

enum Fmt {
    static let isoDay: DateFormatter = {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.locale = Locale(identifier: "en_US_POSIX"); f.timeZone = .gmt; return f
    }()
    static let longDate: DateFormatter = { let f = DateFormatter(); f.setLocalizedDateFormatFromTemplate("d MMMM yyyy"); return f }()
    static let dayMonth: DateFormatter = { let f = DateFormatter(); f.setLocalizedDateFormatFromTemplate("d MMMM"); return f }()
    static let weekday: DateFormatter = { let f = DateFormatter(); f.setLocalizedDateFormatFromTemplate("EEEE d MMMM yyyy"); return f }()
    static let time: DateFormatter = { let f = DateFormatter(); f.timeStyle = .short; return f }()
    static func photos(_ n: Int) -> String { "\(n) \(n == 1 ? "photo" : "photos")" }
}
