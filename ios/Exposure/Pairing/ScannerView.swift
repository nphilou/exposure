import SwiftUI
import VisionKit

/// Full-screen QR scanner (VisionKit). Not available in the simulator; use manual entry there.
struct ScannerView: View {
    let onCode: (String) -> Void
    let onCancel: () -> Void

    var body: some View {
        ZStack(alignment: .top) {
            DataScanner(onCode: onCode).ignoresSafeArea()
            HStack {
                Text("Scan the code on your computer").font(.geist(15, .medium))
                Spacer()
                Button("Cancel", action: onCancel).font(.geist(15))
            }
            .foregroundStyle(.white).padding(.horizontal, 20).padding(.vertical, 14)
            .background(.black.opacity(0.4))
        }
    }
}

private struct DataScanner: UIViewControllerRepresentable {
    let onCode: (String) -> Void

    func makeUIViewController(context: Context) -> DataScannerViewController {
        let vc = DataScannerViewController(recognizedDataTypes: [.barcode(symbologies: [.qr])], qualityLevel: .balanced,
                                           isHighlightingEnabled: true)
        vc.delegate = context.coordinator
        try? vc.startScanning()
        return vc
    }
    func updateUIViewController(_ vc: DataScannerViewController, context: Context) {}
    func makeCoordinator() -> Coordinator { Coordinator(onCode: onCode) }

    final class Coordinator: NSObject, DataScannerViewControllerDelegate {
        let onCode: (String) -> Void
        private var done = false
        init(onCode: @escaping (String) -> Void) { self.onCode = onCode }
        func dataScanner(_ s: DataScannerViewController, didAdd items: [RecognizedItem], allItems: [RecognizedItem]) {
            guard !done else { return }
            for case .barcode(let b) in items {
                if let v = b.payloadStringValue { done = true; s.stopScanning(); onCode(v); return }
            }
        }
    }
}
