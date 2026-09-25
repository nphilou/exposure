import SwiftUI
import UIKit

/// A UIScrollView-backed image page: pinch to 4×, double-tap to 2.5×, single tap callback.
/// Shows `placeholder` (the cached grid thumbnail) instantly, then swaps in `url` (the large preview).
struct ZoomableImage: UIViewRepresentable {
    let url: URL
    let original: URL
    let placeholder: URL
    let token: String?
    var onTap: () -> Void
    var onZoomChange: (Bool) -> Void

    func makeUIView(context: Context) -> ZoomScrollView {
        let v = ZoomScrollView()
        v.onTap = onTap; v.onZoomChange = onZoomChange
        v.original = original; v.load(url: url, placeholder: placeholder, token: token)
        return v
    }

    func updateUIView(_ v: ZoomScrollView, context: Context) {
        v.onTap = onTap; v.onZoomChange = onZoomChange
        v.original = original; v.load(url: url, placeholder: placeholder, token: token)
    }
}

final class ZoomScrollView: UIScrollView, UIScrollViewDelegate {
    private let imageView = UIImageView()
    private var current: URL?
    var original: URL?
    private var originalTask: Task<Void, Never>?
    private var token: String?
    private var hasOriginal = false   // don't let a late preview overwrite the full-res image
    private var task: Task<Void, Never>?
    var onTap: () -> Void = {}
    var onZoomChange: (Bool) -> Void = { _ in }
    private var wasZoomed = false

    override init(frame: CGRect) {
        super.init(frame: frame)
        delegate = self
        minimumZoomScale = 1; maximumZoomScale = 4
        showsVerticalScrollIndicator = false; showsHorizontalScrollIndicator = false
        alwaysBounceVertical = false; alwaysBounceHorizontal = false
        contentInsetAdjustmentBehavior = .never
        decelerationRate = .fast
        backgroundColor = .clear
        imageView.contentMode = .scaleAspectFit
        addSubview(imageView)

        let double = UITapGestureRecognizer(target: self, action: #selector(doubleTap(_:)))
        double.numberOfTapsRequired = 2
        let single = UITapGestureRecognizer(target: self, action: #selector(singleTap))
        single.require(toFail: double)
        addGestureRecognizer(double); addGestureRecognizer(single)
    }
    required init?(coder: NSCoder) { fatalError() }

    func load(url: URL, placeholder: URL, token: String?) {
        guard url != current else { return }
        current = url
        self.token = token
        task?.cancel(); originalTask?.cancel(); originalTask = nil; hasOriginal = false
        if let hit = ImagePipeline.shared.cached(url) { set(hit); return }
        if let ph = ImagePipeline.shared.cached(placeholder) { set(ph) }
        task = Task { [weak self] in
            if self?.imageView.image == nil, let ph = await ImagePipeline.shared.image(placeholder, token: token), !Task.isCancelled {
                self?.set(ph)
            }
            if let img = await ImagePipeline.shared.image(url, token: token), !Task.isCancelled, self?.hasOriginal == false { self?.set(img) }
        }
    }

    /// Swaps in the full-resolution file the first time the user zooms.
    private func loadOriginal() {
        guard let original else { return }
        let token = token
        originalTask = Task { [weak self] in
            if let img = await ImagePipeline.shared.image(original, token: token), !Task.isCancelled { self?.hasOriginal = true; self?.set(img) }
        }
    }

    private func set(_ img: UIImage) {
        imageView.image = img
        setNeedsLayout()
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        guard zoomScale == 1 else { return }
        imageView.frame = bounds
        contentSize = bounds.size
    }

    // Keep the image centred while zoomed out / smaller than the view.
    private func fittedImageRect() -> CGRect {
        guard let img = imageView.image, img.size.width > 0 else { return imageView.bounds }
        return AVMakeRect(aspectRatio: img.size, insideRect: imageView.bounds)
    }

    func viewForZooming(in scrollView: UIScrollView) -> UIView? { imageView }
    func scrollViewDidZoom(_ s: UIScrollView) {
        let zoomed = zoomScale > 1.01
        if zoomed != wasZoomed { wasZoomed = zoomed; onZoomChange(zoomed) }
        if zoomed, originalTask == nil { loadOriginal() }
    }

    @objc private func doubleTap(_ g: UITapGestureRecognizer) {
        if zoomScale > 1 { setZoomScale(1, animated: true); return }
        let p = g.location(in: imageView), scale: CGFloat = 2.5
        let size = CGSize(width: bounds.width / scale, height: bounds.height / scale)
        zoom(to: CGRect(x: p.x - size.width / 2, y: p.y - size.height / 2, width: size.width, height: size.height), animated: true)
    }
    @objc private func singleTap() { onTap() }
}

import AVFoundation
