import SwiftUI
import UIKit

/// Design tokens from the Still/Exposure design (dark + light), and Geist fonts.
enum Theme {
    private static func dyn(_ dark: UInt32, _ light: UInt32, _ da: CGFloat = 1, _ la: CGFloat = 1) -> Color {
        Color(UIColor { $0.userInterfaceStyle == .dark ? UIColor(hex: dark, alpha: da) : UIColor(hex: light, alpha: la) })
    }
    static let bg = dyn(0x1c1b1a, 0xf7f5f1)
    static let seg = dyn(0x3a3835, 0xfdfcfa)
    static let tx = dyn(0xecebe7, 0x1b1a18)
    static let tx2 = dyn(0xa29e97, 0x6f6b64)
    static let tx3 = dyn(0x6f6b65, 0xa39e96)
    static let line = dyn(0xffffff, 0x1c1812, 0.07, 0.08)
    static let line2 = dyn(0xffffff, 0x1c1812, 0.10, 0.10)
    static let hover = dyn(0xffffff, 0x1c1812, 0.07, 0.05)
    static let sel = dyn(0xffffff, 0x1c1812, 0.12, 0.08)
    static let skel = dyn(0x282624, 0xe9e6e0)
    static let btn = dyn(0xecebe7, 0x1b1a18)
    static let btntx = dyn(0x1c1b1a, 0xf7f5f1)
    static let ok = Color(red: 0.42, green: 0.78, blue: 0.52)

    // Viewer is always dark.
    static let sheet = Color(UIColor(hex: 0x1d1c1b))
    static let viewerTx = Color(UIColor(hex: 0xecebe7))
}

extension Font {
    static func geist(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font {
        let name = switch weight {
        case .semibold, .bold, .heavy, .black: "Geist-SemiBold"
        case .medium: "Geist-Medium"
        default: "Geist-Regular"
        }
        return .custom(name, size: size, relativeTo: .body)
    }
    static func geistMono(_ size: CGFloat) -> Font { .custom("GeistMono-Regular", size: size) }
}

extension UIColor {
    convenience init(hex: UInt32, alpha: CGFloat = 1) {
        self.init(red: CGFloat((hex >> 16) & 0xff) / 255, green: CGFloat((hex >> 8) & 0xff) / 255, blue: CGFloat(hex & 0xff) / 255, alpha: alpha)
    }
}

/// The design's small segmented control (rounded track, raised selected pill).
struct Segmented<T: Hashable>: View {
    let options: [(T, String)]
    @Binding var selection: T
    var height: CGFloat = 32
    @Namespace private var ns

    var body: some View {
        HStack(spacing: 0) {
            ForEach(options, id: \.0) { value, label in
                Button {
                    withAnimation(.snappy(duration: 0.22)) { selection = value }
                } label: {
                    Text(label).font(.geist(13)).foregroundStyle(Theme.tx)
                        .frame(maxWidth: .infinity, minHeight: height)
                        .background {
                            if selection == value {
                                RoundedRectangle(cornerRadius: 7).fill(Theme.seg)
                                    .shadow(color: .black.opacity(0.14), radius: 1, y: 1)
                                    .matchedGeometryEffect(id: "sel", in: ns)
                            }
                        }
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
        .padding(2)
        .background(RoundedRectangle(cornerRadius: 9).fill(Theme.hover))
    }
}
