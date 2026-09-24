import SwiftUI

/// Swipe-up info panel: file name, gear, exposure, taken date and the versions of the photo.
struct InfoSheet: View {
    let photo: Photo
    let current: Version.Key?
    let select: (Version.Key) -> Void

    var body: some View {
        let p = photo
        VStack(alignment: .leading, spacing: 0) {
            Capsule().fill(.white.opacity(0.2)).frame(width: 36, height: 5).frame(maxWidth: .infinity).padding(.top, 8).padding(.bottom, 18)
            Text(p.name).font(.geist(21, .semibold)).kerning(-0.4)
            let gear = [p.camera, p.lens].compactMap { $0 }.joined(separator: " · ")
            if !gear.isEmpty { Text(gear).font(.geist(14)).foregroundStyle(Theme.viewerTx.opacity(0.6)).padding(.top, 5) }
            let stats = [p.focal.map { "\(Int($0.rounded())) mm" }, p.fnum.map { "f/\($0.formatted())" }, p.shutter, p.iso.map { "ISO \($0)" }].compactMap { $0 }
            if !stats.isEmpty {
                HStack {
                    ForEach(Array(stats.enumerated()), id: \.offset) { i, s in
                        if i > 0 { Spacer() }
                        Text(s)
                    }
                }
                .font(.geist(16)).monospacedDigit().padding(.top, 20)
            }
            Rectangle().fill(.white.opacity(0.08)).frame(height: 1).padding(.top, 20).padding(.bottom, 16)
            Text("Taken").font(.geist(12)).foregroundStyle(Theme.viewerTx.opacity(0.45))
            Text("\(Fmt.weekday.string(from: p.takenAt)), \(Fmt.time.string(from: p.takenAt))").font(.geist(15)).padding(.top, 4)
            Text("Versions").font(.geist(12)).foregroundStyle(Theme.viewerTx.opacity(0.45)).padding(.top, 16)
            VStack(spacing: 0) {
                ForEach(p.versions, id: \.key) { v in
                    Button { select(v.key) } label: {
                        HStack(spacing: 12) {
                            Circle().fill(Theme.viewerTx).frame(width: 7, height: 7).opacity(v.key == current ? 1 : 0).frame(width: 10)
                            Text(v.label).font(.geist(15))
                            Spacer()
                            Text("\(v.fmt) · \(v.sizeLabel)").font(.geist(13)).foregroundStyle(Theme.viewerTx.opacity(0.5))
                        }
                        .padding(.vertical, 10)
                        .overlay(alignment: .bottom) { Rectangle().fill(.white.opacity(0.06)).frame(height: 1) }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.top, 6)
            Spacer(minLength: 0)
        }
        .foregroundStyle(Theme.viewerTx)
        .padding(.horizontal, 22).padding(.bottom, 40)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(UnevenRoundedRectangle(topLeadingRadius: 22, topTrailingRadius: 22).fill(Theme.sheet))
    }
}
