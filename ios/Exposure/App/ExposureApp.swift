import SwiftUI

@main
struct ExposureApp: App {
    @State private var store = ServerStore()
    @State private var router = Router()

    var body: some Scene {
        WindowGroup {
            Group {
                if store.isPaired { MainTabs() } else { WelcomeView() }
            }
            .environment(store)
            .environment(router)
            .fontDesign(.default)
            .tint(Theme.tx)
            .animation(.default, value: store.isPaired)
            .onOpenURL { url in router.pairLink = PairingTarget.parse(link: url) }
            .alert(pairTitle, isPresented: .init(get: { router.pairLink != nil }, set: { if !$0 { router.pairLink = nil } }),
                   presenting: router.pairLink) { t in
                if alreadyConnected(to: t) { Button("OK", role: .cancel) {} }
                else { Button("Cancel", role: .cancel) {}; Button("Connect") { connect(t) } }
            } message: { t in Text(pairMessage(t)) }
            .alert("Couldn’t connect", isPresented: .init(get: { router.pairError != nil }, set: { if !$0 { router.pairError = nil } })) {
                Button("OK", role: .cancel) {}
            } message: { Text(router.pairError ?? "") }
            #if DEBUG
            .task { await DebugHooks.pairIfRequested(store) }
            #endif
        }
    }

    // An exposure://pair link can come from anywhere, so always ask before connecting to the server it names.
    private var pairTitle: String {
        router.pairLink.map { alreadyConnected(to: $0) ? "Already connected" : "Connect to \($0.serverLabel)?" } ?? ""
    }
    private func alreadyConnected(to t: PairingTarget) -> Bool { store.isPaired && store.server == t.server }
    private func pairMessage(_ t: PairingTarget) -> String {
        if alreadyConnected(to: t) { return "This iPhone is already connected to \(t.serverLabel)." }
        if store.isPaired, let s = store.server {
            return "This iPhone will be disconnected from \(PairingTarget(server: s, code: "").serverLabel) and show the library on \(t.serverLabel) instead."
        }
        return "This adds this iPhone to the Exposure server at \(t.serverLabel)."
    }
    private func connect(_ t: PairingTarget) {
        Task {
            do { router.viewer = nil; router.searching = false; try await store.pair(t) }
            catch { router.pairError = pairingMessage(error) }
        }
    }
}

/// App-wide presentation state: the search overlay and the full-screen viewer.
@MainActor @Observable
final class Router {
    var searching = false
    var viewer: ViewerContext?
    /// A pairing link waiting for the person to confirm, and why the last one failed.
    var pairLink: PairingTarget?
    var pairError: String?

    func open(_ photo: Photo, in list: [Photo]) {
        searching = false
        viewer = ViewerContext(photos: list, start: photo.id)
    }
}

struct ViewerContext: Identifiable {
    let id = UUID()
    let photos: [Photo]
    let start: String
}

// Keep the swipe-back gesture working even though we draw our own navigation headers.
extension UINavigationController: @retroactive UIGestureRecognizerDelegate {
    override open func viewDidLoad() {
        super.viewDidLoad()
        interactivePopGestureRecognizer?.delegate = self
    }
    public func gestureRecognizerShouldBegin(_ g: UIGestureRecognizer) -> Bool { viewControllers.count > 1 }
}
