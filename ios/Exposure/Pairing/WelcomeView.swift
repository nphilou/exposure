import SwiftUI
import VisionKit

struct WelcomeView: View {
    @Environment(ServerStore.self) private var store
    @State private var scanning = false
    @State private var manual = false
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("exposure").font(.geist(22, .semibold)).kerning(-1).padding(.top, 12)
            Spacer()
            Text("Your photos.\nYour storage.")
                .font(.geist(46, .medium)).kerning(-2).lineSpacing(-4)
            Text("Browse your photography beautifully, without uploading it anywhere.")
                .font(.geist(18)).foregroundStyle(Theme.tx2).padding(.top, 18)
            Spacer()
            if let error { Text(error).font(.geist(14)).foregroundStyle(.orange).padding(.bottom, 14) }
            Button {
                error = nil
                if DataScannerViewController.isSupported { scanning = true } else { manual = true }
            } label: {
                Text(busy ? "Connecting…" : "Scan pairing code")
                    .font(.geist(16, .medium)).foregroundStyle(Theme.btntx)
                    .frame(maxWidth: .infinity, minHeight: 52)
                    .background(RoundedRectangle(cornerRadius: 12).fill(Theme.btn))
            }
            .disabled(busy)
            Button("Enter code manually") { error = nil; manual = true }
                .font(.geist(15)).foregroundStyle(Theme.tx2)
                .frame(maxWidth: .infinity, minHeight: 48)
            Text("On your computer, open Exposure → Settings → Devices → Add a device.")
                .font(.geist(12)).foregroundStyle(Theme.tx3).multilineTextAlignment(.center)
                .frame(maxWidth: .infinity).padding(.top, 4)
        }
        .padding(.horizontal, 24).padding(.bottom, 12)
        .foregroundStyle(Theme.tx)
        .background(Theme.bg.ignoresSafeArea())
        .fullScreenCover(isPresented: $scanning) {
            ScannerView { payload in
                scanning = false
                guard let target = PairingTarget.parse(qr: payload) else { error = "That QR code isn’t an Exposure pairing code."; return }
                Task { await pair(target) }
            } onCancel: { scanning = false }
        }
        .onAppear { if let r = store.unpairedReason { error = r; store.unpairedReason = nil } }
        .sheet(isPresented: $manual) {
            ManualPairView { target in await pair(target) }
                .presentationDetents([.large])
        }
    }

    @discardableResult
    private func pair(_ target: PairingTarget) async -> String? {
        busy = true; defer { busy = false }
        do { try await store.pair(target); return nil }
        catch { let m = pairingMessage(error); self.error = m; return m }
    }
}

func pairingMessage(_ error: Error) -> String {
    switch error {
    case APIError.unauthorized: "That code isn’t valid or has expired. Create a new one."
    case APIError.unreachable: "Can’t reach the server. Check the address, and that your phone is on the same network (or Tailscale)."
    default: error.localizedDescription
    }
}
