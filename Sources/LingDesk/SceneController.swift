import AppKit
import AVFoundation
import SwiftUI

@MainActor
final class SceneController: ObservableObject {
    let player = AVQueuePlayer()
    let previewPlayer = AVQueuePlayer()
    private var loopers: [AVPlayerLooper] = []
    private var completion: NSObjectProtocol?
    private var failure: NSObjectProtocol?
    private var statusObservation: NSKeyValueObservation?
    private var window: DesktopWindow?
    var onFinish: (() -> Void)?
    var onError: ((String) -> Void)?

    init() {
        player.automaticallyWaitsToMinimizeStalling = true
        previewPlayer.isMuted = true
    }

    func load(_ url: URL?, loop: Bool = true, paused: Bool = false) {
        clearObservers()
        loopers.removeAll()
        player.removeAllItems(); previewPlayer.removeAllItems()
        guard let url else { return }
        let item = AVPlayerItem(url: url)
        let previewItem = AVPlayerItem(url: url)
        player.isMuted = loop // Every source clip is silent; only generated replies carry audio.
        if loop {
            loopers = [AVPlayerLooper(player: player, templateItem: item),
                       AVPlayerLooper(player: previewPlayer, templateItem: previewItem)]
        } else {
            player.insert(item, after: nil); previewPlayer.insert(previewItem, after: nil)
            completion = NotificationCenter.default.addObserver(forName: .AVPlayerItemDidPlayToEndTime,
                                                                object: item, queue: .main) { [weak self] _ in
                Task { @MainActor in self?.onFinish?() }
            }
        }
        if let actualItem = player.currentItem {
            statusObservation = actualItem.observe(\.status, options: [.new]) { [weak self] item, _ in
                if item.status == .failed {
                    Task { @MainActor in self?.onError?("视频无法解码，请导出 H.264 / AAC 的普通 MP4。") }
                }
            }
            failure = NotificationCenter.default.addObserver(forName: .AVPlayerItemFailedToPlayToEndTime,
                                                             object: actualItem, queue: .main) { [weak self] _ in
                Task { @MainActor in self?.onError?("视频播放中断，请检查素材编码。") }
            }
        }
        if !paused { player.play(); previewPlayer.play() }
    }

    func setPaused(_ paused: Bool) {
        if paused { player.pause(); previewPlayer.pause() }
        else { player.play(); previewPlayer.play() }
    }

    func showDesktop(model: CompanionModel) {
        guard let screen = NSScreen.screens.first else { return }
        if window == nil {
            let window = DesktopWindow(contentRect: screen.frame, styleMask: .borderless, backing: .buffered, defer: false)
            // Above the system wallpaper, below Finder's desktop icons and ordinary apps.
            window.level = NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.desktopWindow)) + 1)
            window.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle]
            window.ignoresMouseEvents = true
            window.isReleasedWhenClosed = false
            window.hasShadow = false
            window.contentView = NSHostingView(rootView: SceneCanvas(model: model, wallpaper: true))
            self.window = window
        }
        window?.setFrame(screen.frame, display: true)
        window?.orderFrontRegardless()
    }

    func hideDesktop() { window?.orderOut(nil) }
    func refreshScreen(model: CompanionModel) { if model.desktopEnabled { showDesktop(model: model) } }

    private func clearObservers() {
        if let completion { NotificationCenter.default.removeObserver(completion) }
        if let failure { NotificationCenter.default.removeObserver(failure) }
        completion = nil; failure = nil; statusObservation = nil
    }
}

final class DesktopWindow: NSWindow {
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
}

final class VideoSurface: NSView {
    let videoLayer = AVPlayerLayer()
    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        wantsLayer = true
        layer?.backgroundColor = NSColor.black.cgColor
        videoLayer.videoGravity = .resizeAspect // Preserve face: no automatic crop.
        layer?.addSublayer(videoLayer)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) not supported") }
    override func layout() { super.layout(); videoLayer.frame = bounds }
}

struct PlayerSurface: NSViewRepresentable {
    let player: AVPlayer
    func makeNSView(context: Context) -> VideoSurface {
        let view = VideoSurface(); view.videoLayer.player = player; return view
    }
    func updateNSView(_ view: VideoSurface, context: Context) { view.videoLayer.player = player }
}
