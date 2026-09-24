import SwiftUI

struct ManualPairView: View {
    @Environment(\.dismiss) private var dismiss
    let submit: (PairingTarget) async -> String?
    @State private var address = ""
    @State private var code = ""
    @State private var busy = false
    @State private var error: String?

    private var target: PairingTarget? {
        guard let url = PairingTarget.server(from: address) else { return nil }
        let c = PairingTarget.normalize(code)
        return c.count >= 8 ? PairingTarget(server: url, code: c) : nil
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("Add this iPhone").font(.geist(32, .medium)).kerning(-1).padding(.top, 28)
            Text("Enter your server’s address and the pairing code it shows.").font(.geist(15)).foregroundStyle(Theme.tx2)
            field("Address", text: $address, placeholder: "192.168.1.20 or nas.local", mono: false)
                .keyboardType(.URL)
            field("Pairing code", text: $code, placeholder: "XXXX-XXXX", mono: true)
                .textInputAutocapitalization(.characters)
            if let error { Text(error).font(.geist(13)).foregroundStyle(.orange) }
            Button {
                guard let target else { return }
                busy = true
                Task {
                    error = await submit(target)
                    busy = false
                    if error == nil { dismiss() }
                }
            } label: {
                Text(busy ? "Connecting…" : "Connect").font(.geist(16, .medium)).foregroundStyle(Theme.btntx)
                    .frame(maxWidth: .infinity, minHeight: 50)
                    .background(RoundedRectangle(cornerRadius: 12).fill(Theme.btn))
            }
            .disabled(target == nil || busy).opacity(target == nil ? 0.45 : 1)
            Spacer()
        }
        .padding(.horizontal, 24)
        .foregroundStyle(Theme.tx)
        .background(Theme.bg.ignoresSafeArea())
    }

    private func field(_ label: String, text: Binding<String>, placeholder: String, mono: Bool) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(label).font(.geist(13)).foregroundStyle(Theme.tx2)
            TextField(placeholder, text: text)
                .font(mono ? .geistMono(16) : .geist(16))
                .autocorrectionDisabled().textInputAutocapitalization(.never)
                .padding(.horizontal, 14).frame(height: 46)
                .background(RoundedRectangle(cornerRadius: 10).fill(Theme.hover))
        }
    }
}
