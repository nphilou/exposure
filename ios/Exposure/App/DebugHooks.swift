#if DEBUG
import Foundation

/// Debug-build-only launch hooks so screens can be reached from `simctl` without tapping:
///   SIMCTL_CHILD_EXPOSURE_PAIR=<pairing URL>  SIMCTL_CHILD_EXPOSURE_TAB=shoots|albums
///   SIMCTL_CHILD_EXPOSURE_OPEN=viewer|info|search|shoot
enum DebugHooks {
    static let env = ProcessInfo.processInfo.environment
    static var tab: Tab? { env["EXPOSURE_TAB"].flatMap { Tab(rawValue: $0.capitalized) } }
    static var open: String? { env["EXPOSURE_OPEN"] }

    @MainActor static func pairIfRequested(_ store: ServerStore) async {
        guard let s = env["EXPOSURE_PAIR"], let t = PairingTarget.parse(qr: s) else { return }
        store.unpair()
        try? await store.pair(t)
    }
}
#endif
