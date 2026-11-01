import AppKit
import AVFoundation

// MARK: - 相册
//
// 相册是最便宜的一块留存：不需要新动画，只要几张图 + 阈值。
// 解锁条件全在 pack.json 里，这里只负责渲染和数数。

@MainActor
final class PetAlbumWindow: NSObject, NSWindowDelegate {
    private var window: NSWindow?
    private var viewer: NSWindow?
    private var pack: PetPack?
    private var selectedImageURL: URL?

    func present(pack: PetPack, affinity: Int) {
        self.pack = pack
        let items = pack.album ?? []
        let unlockedCount = items.filter { affinity >= ($0.unlockAt ?? 0) }.count

        let columns = min(3, max(1, items.count))
        let cellW: CGFloat = 186
        let cellH: CGFloat = 152
        let rows = max(1, Int(ceil(Double(items.count) / Double(columns))))
        let width = CGFloat(columns) * cellW + 32
        let height = CGFloat(rows) * cellH + 40
        let visibleHeight = min(height, min(760, (NSScreen.main?.visibleFrame.height ?? 900) - 100))

        let win = window ?? NSWindow(contentRect: NSRect(x: 0, y: 0, width: width, height: height),
                                     styleMask: [.titled, .closable], backing: .buffered, defer: false)
        window = win
        win.title = "相册 · \(unlockedCount) / \(items.count)"
        win.isReleasedWhenClosed = false
        win.delegate = self
        win.backgroundColor = NSColor(white: 0.09, alpha: 1)
        win.setContentSize(NSSize(width: width, height: visibleHeight))

        let container = NSView(frame: NSRect(x: 0, y: 0, width: width, height: height))
        container.wantsLayer = true
        container.layer?.backgroundColor = NSColor(white: 0.09, alpha: 1).cgColor

        if items.isEmpty {
            let empty = NSTextField(wrappingLabelWithString:
                "这套素材还没有相册。\n在 pack.json 的 album 里加一条、配上图片就会出现。")
            empty.textColor = NSColor(white: 0.72, alpha: 1)
            empty.font = .systemFont(ofSize: 12.5)
            empty.alignment = .center
            empty.frame = NSRect(x: 24, y: height / 2 - 30, width: width - 48, height: 60)
            container.addSubview(empty)
        }

        for (index, item) in items.enumerated() {
            let column = index % columns
            let row = index / columns
            let cell = PetAlbumCell(item: item,
                                    unlocked: affinity >= (item.unlockAt ?? 0),
                                    root: pack.root)
            cell.frame = NSRect(x: 16 + CGFloat(column) * cellW,
                                y: height - 20 - CGFloat(row + 1) * cellH,
                                width: cellW - 8, height: cellH - 10)
            cell.onOpen = { [weak self] chosen in self?.showFull(chosen, pack: pack) }
            container.addSubview(cell)
        }

        let scroll = NSScrollView(frame: NSRect(x: 0, y: 0, width: width, height: visibleHeight))
        scroll.hasVerticalScroller = height > visibleHeight
        scroll.autohidesScrollers = true
        scroll.drawsBackground = false
        scroll.documentView = container
        win.contentView = scroll
        // AppKit's document origin is at the bottom; open at the first cards.
        scroll.contentView.scroll(to: NSPoint(x: 0, y: max(0, height - visibleHeight)))
        scroll.reflectScrolledClipView(scroll.contentView)
        win.center()
        NSApp.activate(ignoringOtherApps: true)
        win.makeKeyAndOrderFront(nil)
    }

    /// 大图：一张图 + 一句台词 + 地点和日期。
    private func showFull(_ item: PetPack.AlbumItem, pack: PetPack) {
        guard let url = pack.file(item.file), let image = NSImage(contentsOf: url) else {
            NSSound.beep()
            return
        }
        selectedImageURL = url
        let maxSide: CGFloat = min(1000, (NSScreen.main?.visibleFrame.width ?? 1200) - 100)
        let ratio = image.size.width / max(image.size.height, 1)
        let w = ratio >= 1 ? maxSide : maxSide * ratio
        let h = min(ratio >= 1 ? maxSide / ratio : maxSide,
                    (NSScreen.main?.visibleFrame.height ?? 900) - 180)

        let win = viewer ?? NSWindow(contentRect: NSRect(x: 0, y: 0, width: w, height: h + 84),
                                     styleMask: [.titled, .closable], backing: .buffered, defer: false)
        viewer = win
        win.title = item.place ?? "相册"
        win.isReleasedWhenClosed = false
        win.backgroundColor = NSColor(white: 0.08, alpha: 1)
        win.setContentSize(NSSize(width: w, height: h + 84))

        let container = NSView(frame: NSRect(x: 0, y: 0, width: w, height: h + 84))
        let view = NSImageView(frame: NSRect(x: 0, y: 84, width: w, height: h))
        view.image = image
        view.imageScaling = .scaleProportionallyUpOrDown
        container.addSubview(view)

        let text = NSTextField(wrappingLabelWithString: item.zh ?? "")
        text.textColor = .white
        text.font = NSFont(name: "Songti SC", size: 13) ?? .systemFont(ofSize: 13)
        text.frame = NSRect(x: 16, y: 44, width: w - 32, height: 32)
        container.addSubview(text)

        let meta = NSTextField(labelWithString: [item.date, item.place].compactMap { $0 }.joined(separator: "   "))
        meta.textColor = NSColor(white: 0.6, alpha: 1)
        meta.font = .systemFont(ofSize: 11)
        meta.frame = NSRect(x: 16, y: 20, width: w - 148, height: 16)
        container.addSubview(meta)

        let save = NSButton(title: "保存壁纸…", target: self, action: #selector(saveWallpaper))
        save.bezelStyle = .rounded
        save.frame = NSRect(x: w - 120, y: 13, width: 104, height: 28)
        container.addSubview(save)

        win.contentView = container
        win.center()
        win.makeKeyAndOrderFront(nil)
    }

    @objc private func saveWallpaper() {
        guard let source = selectedImageURL, let viewer else { return }
        let panel = NSSavePanel()
        panel.title = "保存壁纸"
        panel.nameFieldStringValue = source.lastPathComponent
        panel.beginSheetModal(for: viewer) { response in
            guard response == .OK, let destination = panel.url else { return }
            do {
                // Atomic write also handles an existing file after Save Panel confirmation.
                let data = try Data(contentsOf: source)
                try data.write(to: destination, options: .atomic)
            } catch {
                NSAlert(error: error).runModal()
            }
        }
    }

    func windowWillClose(_ notification: Notification) {
        if (notification.object as? NSWindow) === viewer { viewer = nil }
        if (notification.object as? NSWindow) === window { window = nil }
    }
}

final class PetAlbumCell: NSView {
    var onOpen: ((PetPack.AlbumItem) -> Void)?
    private let item: PetPack.AlbumItem
    private let unlocked: Bool
    private let imageView = NSImageView()
    private let caption = NSTextField(labelWithString: "")

    init(item: PetPack.AlbumItem, unlocked: Bool, root: URL?) {
        self.item = item
        self.unlocked = unlocked
        super.init(frame: .zero)
        wantsLayer = true
        layer?.cornerRadius = 8
        layer?.backgroundColor = NSColor(white: 0.14, alpha: 1).cgColor
        layer?.borderWidth = 1
        layer?.borderColor = NSColor.white.withAlphaComponent(unlocked ? 0.16 : 0.07).cgColor

        imageView.imageScaling = .scaleProportionallyUpOrDown
        imageView.alphaValue = unlocked ? 1 : 0.16
        if let root {
            let url = root.appendingPathComponent(item.file)
            if FileManager.default.fileExists(atPath: url.path) {
                imageView.image = NSImage(contentsOf: url)
            }
        }
        addSubview(imageView)

        caption.font = .systemFont(ofSize: 10.5)
        caption.textColor = NSColor(white: unlocked ? 0.92 : 0.55, alpha: 1)
        caption.lineBreakMode = .byTruncatingTail
        caption.stringValue = unlocked
            ? (item.place ?? item.zh ?? "")
            : "好感度 \(item.unlockAt ?? 0) 解锁"
        toolTip = [item.place, item.zh].compactMap { $0 }.joined(separator: "\n")
        addSubview(caption)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) not supported") }

    override func layout() {
        super.layout()
        imageView.frame = NSRect(x: 6, y: 24, width: bounds.width - 12, height: bounds.height - 30)
        caption.frame = NSRect(x: 8, y: 6, width: bounds.width - 16, height: 14)
    }

    override func mouseDown(with event: NSEvent) {
        guard unlocked else { NSSound.beep(); return }
        onOpen?(item)
    }
}

// MARK: - 剧情

@MainActor
final class PetStoryWindow: NSObject, NSWindowDelegate {
    private var window: NSWindow?
    private var player: PetPlayerWindow?
    private var pack: PetPack?
    private var onFinish: ((PetPack.Chapter, Bool) -> Void)?

    func present(pack: PetPack, state: PetState,
                 onFinish: @escaping (PetPack.Chapter, Bool) -> Void) {
        self.pack = pack
        self.onFinish = onFinish
        let chapters = pack.chapters ?? []
        let width: CGFloat = 430
        let rowH: CGFloat = 58
        let height = max(CGFloat(chapters.count) * rowH + 40, 170)

        let win = window ?? NSWindow(contentRect: NSRect(x: 0, y: 0, width: width, height: height),
                                     styleMask: [.titled, .closable], backing: .buffered, defer: false)
        window = win
        win.title = "剧情"
        win.isReleasedWhenClosed = false
        win.delegate = self
        win.backgroundColor = NSColor(white: 0.09, alpha: 1)
        win.setContentSize(NSSize(width: width, height: height))

        let container = NSView(frame: NSRect(x: 0, y: 0, width: width, height: height))
        container.wantsLayer = true
        container.layer?.backgroundColor = NSColor(white: 0.09, alpha: 1).cgColor

        if chapters.isEmpty {
            let empty = NSTextField(wrappingLabelWithString:
                "这套素材还没有剧情片段。\n在 pack.json 里写 clips 和 chapters，这里就会出现章节列表。")
            empty.textColor = NSColor(white: 0.72, alpha: 1)
            empty.font = .systemFont(ofSize: 12.5)
            empty.alignment = .center
            empty.frame = NSRect(x: 24, y: height / 2 - 30, width: width - 48, height: 60)
            container.addSubview(empty)
        }

        for (index, chapter) in chapters.enumerated() {
            let row = PetStoryRow(chapter: chapter, state: state,
                                  hasFlow: !(chapter.flow ?? []).isEmpty)
            row.frame = NSRect(x: 14, y: CGFloat(chapters.count - 1 - index) * rowH + 20,
                               width: width - 28, height: rowH - 10)
            row.onPlay = { [weak self] chosen in
                self?.window?.orderOut(nil)
                let player = self?.player ?? PetPlayerWindow()
                self?.player = player
                player.present(chapter: chosen, pack: pack, state: state) { [weak self] finished in
                    self?.player = nil
                    onFinish(chosen, finished)
                }
            }
            container.addSubview(row)
        }

        win.contentView = container
        win.center()
        NSApp.activate(ignoringOtherApps: true)
        win.makeKeyAndOrderFront(nil)
    }

    /// 自检用：直接播第一个有内容的章节，跳过「点一行」这一步。
    func playFirst() {
        guard let pack, let onFinish,
              let chapter = (pack.chapters ?? []).first(where: { !($0.flow ?? []).isEmpty }) else { return }
        window?.orderOut(nil)
        let player = self.player ?? PetPlayerWindow()
        self.player = player
        player.present(chapter: chapter, pack: pack, state: PetState()) { [weak self] finished in
            self?.player = nil
            onFinish(chapter, finished)
        }
    }

    var playerCaption: String { player?.captionText ?? "" }
    var choiceVisible: Bool { player?.choiceVisible ?? false }
    var isPlaying: Bool { player != nil }

    func windowWillClose(_ notification: Notification) { window = nil }
}

final class PetStoryRow: NSView {
    var onPlay: ((PetPack.Chapter) -> Void)?
    private let chapter: PetPack.Chapter
    private let locked: Bool
    private let hasFlow: Bool
    private let titleLabel = NSTextField(labelWithString: "")
    private let subLabel = NSTextField(labelWithString: "")
    private let tagLabel = NSTextField(labelWithString: "")

    init(chapter: PetPack.Chapter, state: PetState, hasFlow: Bool) {
        self.chapter = chapter
        self.hasFlow = hasFlow
        let need = chapter.unlockAt ?? 0
        self.locked = need > 0 && state.affinity < need
        super.init(frame: .zero)
        wantsLayer = true
        layer?.cornerRadius = 8
        layer?.backgroundColor = NSColor(white: locked ? 0.11 : 0.16, alpha: 1).cgColor

        titleLabel.stringValue = chapter.title
        titleLabel.font = .systemFont(ofSize: 13, weight: .medium)
        titleLabel.textColor = NSColor(white: locked ? 0.45 : 0.95, alpha: 1)
        titleLabel.lineBreakMode = .byTruncatingTail
        addSubview(titleLabel)

        let watched = state.finished(chapter.id)
        let subtitle: String
        if !hasFlow {
            subtitle = chapter.pending ?? "敬请期待"
        } else if locked {
            subtitle = "好感度 \(need) 解锁"
        } else if watched {
            subtitle = "已看完 · 可重温"
        } else {
            subtitle = chapter.titleEn ?? "可观看"
        }
        subLabel.stringValue = subtitle
        subLabel.font = .systemFont(ofSize: 11)
        subLabel.textColor = NSColor(white: 0.58, alpha: 1)
        subLabel.lineBreakMode = .byTruncatingTail
        addSubview(subLabel)

        tagLabel.stringValue = hasFlow ? (locked ? "锁定" : "播放") : "—"
        tagLabel.font = .systemFont(ofSize: 11, weight: .medium)
        tagLabel.alignment = .right
        tagLabel.textColor = NSColor(white: locked || !hasFlow ? 0.4 : 0.78, alpha: 1)
        addSubview(tagLabel)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) not supported") }

    override func layout() {
        super.layout()
        titleLabel.frame = NSRect(x: 14, y: bounds.height - 30, width: bounds.width - 90, height: 18)
        subLabel.frame = NSRect(x: 14, y: 8, width: bounds.width - 28, height: 14)
        tagLabel.frame = NSRect(x: bounds.width - 72, y: bounds.height - 30, width: 56, height: 18)
    }

    override func mouseDown(with event: NSEvent) {
        guard hasFlow, !locked else { NSSound.beep(); return }
        onPlay?(chapter)
    }
}

// MARK: - 播放器
//
// 台词按视频时间码显示，不用 TTS 合成。这一条决定了「演出」能不能做准：
// 什么时候开口、停多久，都由分镜决定，而不是等语音合成。

final class PlayerCanvas: NSView {
    var onEscape: (() -> Void)?
    var onSkip: (() -> Void)?
    override var acceptsFirstResponder: Bool { true }

    override func keyDown(with event: NSEvent) {
        switch event.keyCode {
        case 53: onEscape?()          // Esc
        case 49: onSkip?()            // 空格
        default: super.keyDown(with: event)
        }
    }

    override func cancelOperation(_ sender: Any?) { onEscape?() }
}

@MainActor
final class PetPlayerWindow: NSObject, NSWindowDelegate {
    private var window: NSWindow?
    private let player = AVPlayer()
    private let canvas = PlayerCanvas()
    private let videoLayer = AVPlayerLayer()
    /// 静帧镜头用。和 videoLayer 同一块区域，谁在前谁出镜。
    private let stillView = NSImageView()
    private let caption = NSTextField(wrappingLabelWithString: "")
    private let hint = NSTextField(labelWithString: "Esc 关闭 · 空格跳过")
    private let choiceBar = NSView()
    private var timeObserver: Any?
    private var pack: PetPack?
    private var chapter: PetPack.Chapter?
    private var onDone: ((Bool) -> Void)?

    private var stepIndex = 0
    private var caps: [PetPack.Cap] = []
    private var picked: String?
    private var pendingChoice = false
    private var clipEnded = false
    private var finished = false
    private var choiceTimer: Timer?
    private var secondsLeft = 12
    private var videoHeight: CGFloat = 506
    /// 当前镜头是静帧。静帧靠 Timer 推进，不走 AVPlayer 的时间观察者。
    private var inStill = false
    private var stillTimer: Timer?

    func present(chapter: PetPack.Chapter, pack: PetPack, state: PetState,
                 onDone: @escaping (Bool) -> Void) {
        self.pack = pack
        self.chapter = chapter
        self.onDone = onDone
        stepIndex = 0
        picked = nil
        finished = false
        clipEnded = false
        caps = []
        stopStill()

        let width: CGFloat = 900
        videoHeight = width * 9 / 16
        let height = videoHeight + 96

        let win = window ?? NSWindow(contentRect: NSRect(x: 0, y: 0, width: width, height: height),
                                     styleMask: [.titled, .closable], backing: .buffered, defer: false)
        window = win
        win.title = chapter.title
        win.isReleasedWhenClosed = false
        win.delegate = self
        win.backgroundColor = .black
        win.setContentSize(NSSize(width: width, height: height))

        canvas.frame = NSRect(x: 0, y: 0, width: width, height: height)
        canvas.wantsLayer = true
        canvas.layer?.backgroundColor = NSColor.black.cgColor
        canvas.onEscape = { [weak self] in self?.close() }
        canvas.onSkip = { [weak self] in self?.skip() }

        videoLayer.player = player
        videoLayer.videoGravity = .resizeAspect
        videoLayer.frame = NSRect(x: 0, y: 96, width: width, height: videoHeight)
        canvas.layer?.addSublayer(videoLayer)

        stillView.frame = NSRect(x: 0, y: 96, width: width, height: videoHeight)
        stillView.imageScaling = .scaleProportionallyUpOrDown
        stillView.imageFrameStyle = .none
        stillView.wantsLayer = true
        stillView.layer?.backgroundColor = NSColor.black.cgColor
        stillView.isHidden = true
        canvas.addSubview(stillView)

        caption.font = NSFont(name: "Songti SC", size: 15) ?? .systemFont(ofSize: 15)
        caption.textColor = .white
        caption.alignment = .center
        caption.frame = NSRect(x: 40, y: 40, width: width - 80, height: 46)
        canvas.addSubview(caption)

        hint.font = .systemFont(ofSize: 10)
        hint.textColor = NSColor(white: 0.45, alpha: 1)
        hint.alignment = .center
        hint.frame = NSRect(x: 40, y: 14, width: width - 80, height: 14)
        canvas.addSubview(hint)

        choiceBar.frame = NSRect(x: 0, y: 96, width: width, height: videoHeight)
        choiceBar.wantsLayer = true
        choiceBar.layer?.backgroundColor = NSColor.black.withAlphaComponent(0.76).cgColor
        choiceBar.isHidden = true
        canvas.addSubview(choiceBar)

        win.contentView = canvas
        win.center()
        NSApp.activate(ignoringOtherApps: true)
        win.makeKeyAndOrderFront(nil)
        win.makeFirstResponder(canvas)

        installObserver()
        advance()
    }

    // MARK: 流程

    private func advance() {
        guard let chapter else { return }
        let flow = chapter.flow ?? []
        guard stepIndex < flow.count else { return finish() }
        let step = flow[stepIndex]
        stepIndex += 1

        if let branch = step.branch {
            let key = picked ?? "A"
            guard let clipID = branch[key] ?? branch["A"] ?? branch.values.first else { return advance() }
            return playClip(clipID, choiceAfter: false)
        }
        guard let clipID = step.clip else { return advance() }
        playClip(clipID, choiceAfter: step.then == "choice")
    }

    private func playClip(_ id: String, choiceAfter: Bool) {
        guard let pack, let clip = pack.clip(id) else { return missingClip(id) }
        pendingChoice = choiceAfter
        clipEnded = false
        caps = []
        caption.stringValue = ""

        // 静帧优先：写了 image 就按图文剧演，不看视频。
        if let url = pack.file(clip.image), let image = NSImage(contentsOf: url) {
            return playStill(image, clip: clip)
        }
        guard let url = pack.file(clip.file) else { return missingClip(id) }
        caps = clip.caps ?? []
        stopStill()
        player.replaceCurrentItem(with: AVPlayerItem(url: url))
        player.seek(to: .zero)
        player.play()
    }

    private func missingClip(_ id: String) {
        // 素材缺失不该让整段剧情卡死：跳过这一段继续往下。
        hint.stringValue = "缺少片段 \(id)，已跳过"
        advance()
    }

    private func playStill(_ image: NSImage, clip: PetPack.Clip) {
        player.pause()
        player.replaceCurrentItem(with: nil)
        inStill = true
        stillView.image = image
        stillView.isHidden = false
        caption.stringValue = clip.text ?? clip.caps?.first?.zh ?? ""
        hint.stringValue = "Esc 关闭 · 空格跳过"

        stillTimer?.invalidate()
        let hold = clip.hold
        let timer = Timer(timeInterval: hold, repeats: false) { [weak self] timer in
            timer.invalidate()
            MainActor.assumeIsolated { self?.stepFinished() }
        }
        RunLoop.main.add(timer, forMode: .common)
        stillTimer = timer
    }

    private func stopStill() {
        stillTimer?.invalidate()
        stillTimer = nil
        inStill = false
        stillView.isHidden = true
        stillView.image = nil
    }

    /// 一个镜头演完的共同收尾：要么弹选择，要么往下走。
    private func stepFinished() {
        guard !clipEnded else { return }
        clipEnded = true
        if inStill { stopStill() } else { player.pause() }
        if pendingChoice {
            pendingChoice = false
            showChoice()
        } else {
            advance()
        }
    }

    private func installObserver() {
        if let timeObserver { player.removeTimeObserver(timeObserver) }
        timeObserver = player.addPeriodicTimeObserver(forInterval: CMTime(value: 1, timescale: 10),
                                                      queue: .main) { [weak self] time in
            MainActor.assumeIsolated { self?.tick(time.seconds) }
        }
    }

    private func tick(_ seconds: Double) {
        // 静帧镜头没有时间码，台词一次性给完，交给 Timer 推进。
        guard !inStill else { return }
        let active = caps.first { seconds >= $0.from && seconds < $0.to }
        let text = active?.zh ?? ""
        if caption.stringValue != text { caption.stringValue = text }

        guard let item = player.currentItem else { return }
        let duration = item.duration.seconds
        guard duration.isFinite, duration > 0 else { return }

        if seconds >= duration - 0.06 {
            stepFinished()
        } else if seconds < duration - 0.25 {
            clipEnded = false
        }
    }

    private func skip() {
        guard choiceBar.isHidden else { return }
        stepFinished()
    }

    // MARK: 选择

    private func showChoice() {
        guard let chapter else { return advance() }
        let choices = chapter.choices
        choiceBar.isHidden = false
        for sub in choiceBar.subviews { sub.removeFromSuperview() }

        let prompt = NSTextField(labelWithString: choices?.prompt ?? "她在等你的回答")
        prompt.textColor = .white
        prompt.font = .systemFont(ofSize: 14)
        prompt.alignment = .center
        prompt.frame = NSRect(x: 40, y: choiceBar.bounds.height / 2 + 40,
                              width: choiceBar.bounds.width - 80, height: 22)
        choiceBar.addSubview(prompt)

        let options: [(String, String?)] = [("A", choices?.a), ("B", choices?.b)]
        for (index, option) in options.enumerated() {
            let button = NSButton(title: option.1 ?? option.0, target: self, action: #selector(pickOption(_:)))
            button.tag = index
            button.bezelStyle = .rounded
            button.font = .systemFont(ofSize: 13)
            button.frame = NSRect(x: 80, y: choiceBar.bounds.height / 2 - 10 - CGFloat(index) * 44,
                                  width: choiceBar.bounds.width - 160, height: 34)
            choiceBar.addSubview(button)
        }

        let countdown = NSTextField(labelWithString: "")
        countdown.textColor = NSColor(white: 0.6, alpha: 1)
        countdown.font = .systemFont(ofSize: 11)
        countdown.alignment = .center
        countdown.frame = NSRect(x: 40, y: 20, width: choiceBar.bounds.width - 80, height: 16)
        choiceBar.addSubview(countdown)

        secondsLeft = 12
        countdown.stringValue = "\(secondsLeft) 秒后沉默即选 A"
        choiceTimer?.invalidate()
        let timer = Timer(timeInterval: 1, repeats: true) { [weak self] timer in
            MainActor.assumeIsolated {
                guard let self else { timer.invalidate(); return }
                self.secondsLeft -= 1
                countdown.stringValue = "\(max(self.secondsLeft, 0)) 秒后沉默即选 A"
                if self.secondsLeft <= 0 {
                    timer.invalidate()
                    // 沉默也是一种回答：不判负，按 A 继续。
                    self.choose("A")
                }
            }
        }
        RunLoop.main.add(timer, forMode: .common)
        choiceTimer = timer
    }

    @objc private func pickOption(_ sender: NSButton) { choose(sender.tag == 1 ? "B" : "A") }

    private func choose(_ key: String) {
        choiceTimer?.invalidate(); choiceTimer = nil
        picked = key
        choiceBar.isHidden = true
        clipEnded = false
        advance()
    }

    // MARK: 收尾

    private func finish() {
        guard !finished else { return }
        finished = true
        player.pause()
        stopStill()
        choiceTimer?.invalidate(); choiceTimer = nil
        let done = onDone
        onDone = nil
        window?.orderOut(nil)
        window = nil
        done?(true)
    }

    var captionText: String { caption.stringValue }
    var choiceVisible: Bool { !choiceBar.isHidden }

    func close() {
        let done = onDone
        onDone = nil
        finished = true
        player.pause()
        stopStill()
        choiceTimer?.invalidate(); choiceTimer = nil
        window?.orderOut(nil)
        window = nil
        done?(false)
    }

    func windowWillClose(_ notification: Notification) {
        let done = onDone
        onDone = nil
        if !finished {
            finished = true
            player.pause()
            // 直接点关闭也要停掉静帧计时器，否则 Timer 会继续往下走流程。
            stopStill()
            choiceTimer?.invalidate(); choiceTimer = nil
            done?(false)
        }
        window = nil
    }
}
