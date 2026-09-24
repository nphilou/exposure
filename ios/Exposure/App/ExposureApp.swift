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
            #if DEBUG
            .task { await DebugHooks.pairIfRequested(store) }
            #endif
        }
    }
}

/// App-wide presentation state: the search overlay and the full-screen viewer.
@MainActor @Observable
final class Router {
    var searching = false
    var viewer: ViewerContext?

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
