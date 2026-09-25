import SwiftUI
import CoreImage.CIFilterBuiltins

/// Mints a one-time pairing code and shows it as a QR + text, so another browser or phone can join
/// (mirrors Settings → Devices → Add a device on the web).
struct AddDeviceView: View {
    @Environment(ServerStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var pair: (code: APIClient.PairCode, base: String, qr: UIImage?)?
    @State private var error: String?
    @State private var now = Date()
    private let tick = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    private var left: Int { pair.map { max(0, Int(($0.code.expiresAt / 1000 - now.timeIntervalSince1970).rounded())) } ?? 0 }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack {
                Text("Add a device").font(.geist(32, .medium)).kerning(-1)
                Spacer()
                Button("Done") { dismiss() }.font(.geist(16, .medium))
            }
            .padding(.top, 28)
            if let pair, left > 0 {
                Text("Scan with the other device’s camera, or open this address and type the code:")
                    .font(.geist(15)).foregroundStyle(Theme.tx2)
                if let qr = pair.qr {
                    Image(uiImage: qr).interpolation(.none).resizable().scaledToFit()
                        .frame(width: 220, height: 220).padding(12)
                        .background(RoundedRectangle(cornerRadius: 14).fill(.white))
                        .frame(maxWidth: .infinity)
                }
                Text(pair.base + "/pair").font(.geistMono(14)).foregroundStyle(Theme.tx2).textSelection(.enabled)
                Text(pair.code.code).font(.geistMono(34)).kerning(2).textSelection(.enabled)
                Text("Works once · expires in \(left / 60):\(String(format: "%02d", left % 60))")
                    .font(.geist(13)).foregroundStyle(Theme.tx3)
                if isLocal(pair.base) {
                    Text("This is a local address; it only works from devices on the same network.")
                        .font(.geist(13)).foregroundStyle(Theme.tx3)
                }
            } else if pair != nil {
                Text("That code has expired.").font(.geist(15)).foregroundStyle(Theme.tx2)
                newCodeButton
            } else if let error {
                Text(error).font(.geist(14)).foregroundStyle(.orange)
                newCodeButton
            } else {
                ProgressView().frame(maxWidth: .infinity).padding(.top, 40)
            }
            Spacer()
        }
        .padding(.horizontal, 24)
        .foregroundStyle(Theme.tx)
        .background(Theme.bg.ignoresSafeArea())
        .task { await create() }
        .onReceive(tick) { now = $0 }
    }

    private var newCodeButton: some View {
        Button { Task { await create() } } label: {
            Text("New code").font(.geist(16, .medium)).foregroundStyle(Theme.btntx)
                .frame(maxWidth: .infinity, minHeight: 50)
                .background(RoundedRectangle(cornerRadius: 12).fill(Theme.btn))
        }
    }

    private func create() async {
        error = nil; pair = nil
        do {
            let code = try await store.call { try await $0.newPairingCode() }
            // Prefer the server's public address (Tailscale, tunnel) over the one this iPhone happens to use.
            let session = try? await store.call { try await $0.session() }
            var base = session?.publicUrl ?? store.server?.absoluteString ?? ""
            while base.hasSuffix("/") { base.removeLast() }
            pair = (code, base, qrImage(base + code.path))
            now = Date()
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func isLocal(_ base: String) -> Bool {
        guard let host = URL(string: base)?.host() else { return false }
        return host == "localhost" || host.hasSuffix(".local") || ["127.", "10.", "192.168.", "172."].contains { host.hasPrefix($0) }
    }

    private func qrImage(_ text: String) -> UIImage? {
        let f = CIFilter.qrCodeGenerator()
        f.message = Data(text.utf8)
        f.correctionLevel = "M"
        guard let out = f.outputImage?.transformed(by: CGAffineTransform(scaleX: 10, y: 10)),
              let cg = CIContext().createCGImage(out, from: out.extent) else { return nil }
        return UIImage(cgImage: cg)
    }
}
