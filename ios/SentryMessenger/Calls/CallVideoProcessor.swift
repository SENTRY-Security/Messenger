import Foundation
import CoreImage
import CoreImage.CIFilterBuiltins
import CoreVideo
import Vision
import Metal
#if canImport(WebRTC)
import WebRTC
#endif

#if canImport(WebRTC)
/// Frame processor inserted between `RTCCameraVideoCapturer` and `RTCVideoSource`:
/// pixelates faces (or everything except faces) before the frame enters WebRTC,
/// so the **peer receives the already-blurred video** (privacy applied at source).
///
/// Native equivalent of web `face-blur.js`: Vision for on-device face detection
/// (no CDN / network), Core Image (`CIPixellate` + `CIBlendWithMask`) for the
/// mosaic. Modes: off / face (blur faces) / background (blur all but faces).
///
/// v1 — front-camera portrait tuned; Vision orientation/mirroring and the mosaic
/// scale may need on-device adjustment. Full app only.
final class CallVideoProcessor: NSObject, RTCVideoCapturerDelegate {
    enum Mode: String { case off, face, background }
    var mode: Mode = .off

    private weak var source: RTCVideoSource?
    private let ciContext: CIContext
    /// Face rects in pixel coords (Core Image bottom-left origin), padded.
    private var faceRects: [CGRect] = []
    private var frameCount = 0
    private let detectEvery = 6            // ~5 detections/sec at 30fps
    private var pool: CVPixelBufferPool?
    private var poolW = 0, poolH = 0
    /// Vision runs off the capture thread so it never stalls frame delivery.
    private let visionQueue = DispatchQueue(label: "red.sentry.call-blur.vision")
    private var detecting = false
    /// Cached face mask (rebuilt only when the detected faces change, not every
    /// frame — building a full-res bitmap per frame would drop frames).
    private var cachedMask: CIImage?
    private var maskExtent: CGRect = .zero
    private var maskDirty = true

    init(source: RTCVideoSource) {
        self.source = source
        if let device = MTLCreateSystemDefaultDevice() {
            ciContext = CIContext(mtlDevice: device)
        } else {
            ciContext = CIContext()
        }
        super.init()
    }

    // MARK: RTCVideoCapturerDelegate

    func capturer(_ capturer: RTCVideoCapturer, didCapture frame: RTCVideoFrame) {
        guard mode != .off, let rtcPB = frame.buffer as? RTCCVPixelBuffer else {
            source?.capturer(capturer, didCapture: frame); return
        }
        let pb = rtcPB.pixelBuffer
        frameCount &+= 1
        if frameCount % detectEvery == 0 { scheduleDetect(pb) }

        let ci = CIImage(cvPixelBuffer: pb)
        let extent = ci.extent
        let output: CIImage
        switch mode {
        case .off:
            source?.capturer(capturer, didCapture: frame); return
        case .face:
            guard !faceRects.isEmpty else { source?.capturer(capturer, didCapture: frame); return }
            output = blend(input: pixellate(ci), background: ci, mask: faceMask(extent))
        case .background:
            let pix = pixellate(ci)
            output = faceRects.isEmpty ? pix : blend(input: ci, background: pix, mask: faceMask(extent))
        }

        guard let outBuf = render(output, extent: extent) else {
            source?.capturer(capturer, didCapture: frame); return
        }
        let outFrame = RTCVideoFrame(buffer: RTCCVPixelBuffer(pixelBuffer: outBuf),
                                     rotation: frame.rotation, timeStampNs: frame.timeStampNs)
        source?.capturer(capturer, didCapture: outFrame)
    }

    // MARK: detection (async, cached)

    private func scheduleDetect(_ pb: CVPixelBuffer) {
        guard !detecting else { return }
        detecting = true
        let w = CVPixelBufferGetWidth(pb), h = CVPixelBufferGetHeight(pb)
        visionQueue.async { [weak self] in
            defer { self?.detecting = false }
            let req = VNDetectFaceRectanglesRequest()
            let handler = VNImageRequestHandler(cvPixelBuffer: pb, orientation: .up, options: [:])
            try? handler.perform([req])
            let obs = (req.results as? [VNFaceObservation]) ?? []
            let pad: CGFloat = 0.25
            let rects = obs.map { o -> CGRect in
                let bb = o.boundingBox   // normalized, bottom-left
                return CGRect(x: (bb.minX - bb.width * pad) * CGFloat(w),
                              y: (bb.minY - bb.height * pad) * CGFloat(h),
                              width: bb.width * (1 + 2 * pad) * CGFloat(w),
                              height: bb.height * (1 + 2 * pad) * CGFloat(h))
            }
            self?.faceRects = rects
            self?.maskDirty = true
        }
    }

    // MARK: Core Image

    private func pixellate(_ image: CIImage) -> CIImage {
        let f = CIFilter.pixellate()
        f.inputImage = image
        f.scale = 24
        f.center = CGPoint(x: image.extent.midX, y: image.extent.midY)
        return (f.outputImage ?? image).cropped(to: image.extent)
    }

    private func faceMask(_ extent: CGRect) -> CIImage {
        if let cached = cachedMask, maskExtent == extent, !maskDirty { return cached }
        let mask = buildFaceMask(extent)
        cachedMask = mask; maskExtent = extent; maskDirty = false
        return mask
    }

    private func buildFaceMask(_ extent: CGRect) -> CIImage {
        let w = max(1, Int(extent.width)), h = max(1, Int(extent.height))
        let cs = CGColorSpaceCreateDeviceGray()
        guard let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8,
                                  bytesPerRow: 0, space: cs,
                                  bitmapInfo: CGImageAlphaInfo.none.rawValue) else {
            return CIImage(color: .black).cropped(to: extent)
        }
        ctx.setFillColor(gray: 0, alpha: 1)
        ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
        ctx.setFillColor(gray: 1, alpha: 1)
        for r in faceRects { ctx.fillEllipse(in: r) }
        guard let cg = ctx.makeImage() else { return CIImage(color: .black).cropped(to: extent) }
        return CIImage(cgImage: cg)
    }

    private func blend(input: CIImage, background: CIImage, mask: CIImage) -> CIImage {
        let f = CIFilter.blendWithMask()
        f.inputImage = input
        f.backgroundImage = background
        f.maskImage = mask
        return (f.outputImage ?? background).cropped(to: background.extent)
    }

    private func render(_ image: CIImage, extent: CGRect) -> CVPixelBuffer? {
        let w = Int(extent.width), h = Int(extent.height)
        guard w > 0, h > 0 else { return nil }
        if pool == nil || poolW != w || poolH != h {
            let attrs: [String: Any] = [
                kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
                kCVPixelBufferWidthKey as String: w,
                kCVPixelBufferHeightKey as String: h,
                kCVPixelBufferIOSurfacePropertiesKey as String: [:],
            ]
            var newPool: CVPixelBufferPool?
            CVPixelBufferPoolCreate(nil, nil, attrs as CFDictionary, &newPool)
            pool = newPool; poolW = w; poolH = h
        }
        guard let pool else { return nil }
        var out: CVPixelBuffer?
        CVPixelBufferPoolCreatePixelBuffer(nil, pool, &out)
        guard let outBuf = out else { return nil }
        ciContext.render(image, to: outBuf)
        return outBuf
    }
}
#endif
