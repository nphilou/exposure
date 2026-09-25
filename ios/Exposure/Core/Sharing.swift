import SwiftUI
import UIKit

/// Shares photos through the system share sheet. The share sheet needs local files, so each photo's
/// full-resolution image (`/original`: JPEG/PNG untouched, HEIC/RAW rendered to JPEG) is downloaded
/// to a temporary folder first, then removed once the sheet closes.
@MainActor @Observable
final class Sharer {
    static let shared = Sharer()

    /// Downloading the files; the share sheet opens when they're ready.
    private(set) var busy = false
    private(set) var failed: String?
    private var task: Task<Void, Never>?

    /// `version` picks the version for every photo that has it; the rest share their preferred version.
    func share(_ photos: [Photo], version: Version.Key? = nil, store: ServerStore) {
        guard !busy, !photos.isEmpty, let api = store.api else { return }
        busy = true; failed = nil
        task = Task {
            defer { busy = false; task = nil }
            let dir = FileManager.default.temporaryDirectory.appending(path: "Share-\(UUID().uuidString)")
            do {
                try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
                var files: [URL] = []
                for p in photos {
                    let key = version.flatMap { v in p.versions.contains { $0.key == v } ? v : nil }
                    files.append(try await download(p, version: key, api: api, into: dir))
                }
                try Task.checkCancellation()
                present(files) { try? FileManager.default.removeItem(at: dir) }
            } catch {
                try? FileManager.default.removeItem(at: dir)
                if !(error is CancellationError) { failed = "Couldn’t get the photo from your server." }
            }
        }
    }

    func cancel() { task?.cancel() }
    func dismissError() { failed = nil }

    private func download(_ p: Photo, version: Version.Key?, api: APIClient, into dir: URL) async throws -> URL {
        let (tmp, resp) = try await APIClient.session.download(for: api.request(api.originalURL(p.id, version: version)))
        guard (resp as? HTTPURLResponse)?.statusCode == 200 else { throw APIError.server("Download failed") }
        // Distinct subfolders keep same-named files (DSC1.JPG in two shoots) apart and the names intact.
        let sub = dir.appending(path: p.id)
        try FileManager.default.createDirectory(at: sub, withIntermediateDirectories: true)
        let dest = sub.appending(path: Self.filename(p, version: version, mime: resp.mimeType))
        try FileManager.default.moveItem(at: tmp, to: dest)
        return dest
    }

    /// The version's own file name, with the extension of what the server actually sent.
    static func filename(_ p: Photo, version: Version.Key?, mime: String?) -> String {
        let file = p.version(version)?.file ?? p.name
        let base = ((file as NSString).lastPathComponent as NSString).deletingPathExtension
        let ext = ((file as NSString).pathExtension).lowercased()
        switch mime {
        case "image/png": return "\(base).png"
        case "image/jpeg" where ext == "jpg" || ext == "jpeg": return (file as NSString).lastPathComponent
        default: return "\(base).jpg"
        }
    }

    private func present(_ files: [URL], done: @escaping () -> Void) {
        guard let top = Self.topController() else { done(); return }
        let vc = UIActivityViewController(activityItems: files, applicationActivities: nil)
        vc.completionWithItemsHandler = { _, _, _, _ in done() }
        vc.popoverPresentationController?.sourceView = top.view
        top.present(vc, animated: true)
    }

    private static func topController() -> UIViewController? {
        let scene = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            .first { $0.activationState == .foregroundActive } ?? UIApplication.shared.connectedScenes.first as? UIWindowScene
        var top = scene?.keyWindow?.rootViewController
        while let next = top?.presentedViewController, !next.isBeingDismissed { top = next }
        return top
    }
}

/// "Preparing…" capsule while photos download for sharing, and an alert if that fails.
/// `active` is false for a view covered by another that shows the status (MainTabs under the viewer).
struct SharingStatus: ViewModifier {
    var active = true
    @State private var sharer = Sharer.shared

    func body(content: Content) -> some View {
        content
            .overlay(alignment: .top) {
                if active && sharer.busy {
                    HStack(spacing: 10) {
                        ProgressView().controlSize(.small)
                        Text("Preparing to share…").font(.geist(14))
                        Button("Cancel") { sharer.cancel() }.font(.geist(14, .medium))
                    }
                    .padding(.horizontal, 16).frame(height: 44)
                    .background(.regularMaterial, in: Capsule())
                    .shadow(color: .black.opacity(0.15), radius: 8, y: 3)
                    .padding(.top, 8)
                    .transition(.move(edge: .top).combined(with: .opacity))
                }
            }
            .animation(.snappy, value: sharer.busy)
            .alert("Couldn’t share", isPresented: Binding(get: { active && sharer.failed != nil }, set: { if !$0 { sharer.dismissError() } })) {
                Button("OK") {}
            } message: {
                Text(sharer.failed ?? "")
            }
    }
}

extension View {
    func sharingStatus(active: Bool = true) -> some View { modifier(SharingStatus(active: active)) }
}
