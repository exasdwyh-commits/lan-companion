import AppKit
import AVFoundation

// MARK: - 气泡

final class BubbleView: NSView {
    private let label = NSTextField(wrappingLabelWithString: "")
    private let maxWidth: CGFloat = 400
    private let padH: CGFloat = 13
    private let padV: CGFloat = 9

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        wantsLayer = true
        layer?.backgroundColor = NSColor.black.withAlphaComponent(0.58).cgColor
        layer?.cornerRadius = 12
        layer?.borderWidth = 1
        layer?.borderColor = NSColor.white.withAlphaComponent(0.10).cgColor
        label.font = NSFont(name: "Songti SC", size: 13.5) ?? .systemFont(ofSize: 13.5)
        label.textColor = .white
        label.isEditable = false
        label.isSelectable = false
        label.drawsBackground = false
        label.isBezeled = false
        label.maximumNumberOfLines = 7
        label.lineBreakMode = .byTruncatingTail
        addSubview(label)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) not supported") }

    func setText(_ text: String) {
        label.stringValue = text.isEmpty ? " " : text
        needsLayout = true
    }

    var textValue: String { label.stringValue }

    /// 按给定最大宽度算高度：先算文字块，再补内边距。
    func fittedSize(maxWidth limit: CGFloat) -> NSSize {
        let width = min(maxWidth, limit - padH * 2)
        let attr: [NSAttributedString.Key: Any] = [.font: label.font as Any]
        let rect = (label.stringValue as NSString).boundingRect(
            with: NSSize(width: width, height: .greatestFiniteMagnitude),
            options: [.usesLineFragmentOrigin, .usesFontLeading],
            attributes: attr)
        // 最多 7 行，超了就截断，不能让气泡吃掉整个窗口。
        let lineHeight = rect.height / max(1, ceil(rect.height / (label.font?.pointSize ?? 13) / 1.35))
        let height = min(ceil(rect.height), ceil(lineHeight * 7)) + padV * 2
        return NSSize(width: ceil(rect.width) + padH * 2, height: max(height, 22))
    }

    override func layout() {
        super.layout()
        label.frame = NSRect(x: padH, y: padV, width: bounds.width - padH * 2, height: bounds.height - padV * 2)
    }
}

// MARK: - 输入条

final class ComposerView: NSView, NSTextFieldDelegate {
    let field = NSTextField()
    private let sendButton = NSButton()
    private let micButton = NSButton()
    private let closeButton = NSButton()
    var onSend: ((String) -> Void)?
    var onClose: (() -> Void)?
    /// Toggled by the controller; the mic runs itself and reports back.
    var onMicTap: (() -> Void)?
    var isMicOn = false { didSet { refreshMic() } }

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        wantsLayer = true
        layer?.backgroundColor = NSColor.black.withAlphaComponent(0.62).cgColor
        layer?.cornerRadius = 12
        layer?.borderWidth = 1
        layer?.borderColor = NSColor.white.withAlphaComponent(0.12).cgColor

        field.isBezeled = false
        field.drawsBackground = false
        field.focusRingType = .none
        field.font = .systemFont(ofSize: 13)
        field.textColor = .white
        field.placeholderString = "和她说句话…"
        field.setAccessibilityLabel("聊天输入")
        field.delegate = self
        field.target = self
        field.action = #selector(submit)
        field.cell?.sendsActionOnEndEditing = false
        addSubview(field)

        sendButton.title = "说"
        sendButton.setAccessibilityLabel("发送消息")
        sendButton.bezelStyle = .inline
        sendButton.isBordered = false
        sendButton.font = .systemFont(ofSize: 12, weight: .medium)
        sendButton.contentTintColor = .white
        sendButton.target = self
        sendButton.action = #selector(submit)
        addSubview(sendButton)

        micButton.image = NSImage(systemSymbolName: "mic", accessibilityDescription: "说话")
        micButton.imagePosition = .imageOnly
        micButton.bezelStyle = .inline
        micButton.isBordered = false
        micButton.contentTintColor = NSColor.white.withAlphaComponent(0.85)
        micButton.toolTip = "点一下说话，说完自动发送"
        micButton.target = self
        micButton.action = #selector(tapMic)
        addSubview(micButton)

        closeButton.title = "✕"
        closeButton.setAccessibilityLabel("收起输入")
        closeButton.bezelStyle = .inline
        closeButton.isBordered = false
        closeButton.font = .systemFont(ofSize: 10)
        closeButton.contentTintColor = NSColor.white.withAlphaComponent(0.55)
        closeButton.target = self
        closeButton.action = #selector(close)
        addSubview(closeButton)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) not supported") }

    override func layout() {
        super.layout()
        let h = bounds.height
        closeButton.frame = NSRect(x: bounds.width - 24, y: (h - 16) / 2, width: 16, height: 16)
        micButton.frame = NSRect(x: bounds.width - 56, y: (h - 20) / 2, width: 26, height: 20)
        sendButton.frame = NSRect(x: bounds.width - 92, y: (h - 20) / 2, width: 34, height: 20)
        field.frame = NSRect(x: 12, y: (h - 18) / 2, width: bounds.width - 108, height: 18)
    }

    @objc private func tapMic() { onMicTap?() }

    private func refreshMic() {
        micButton.image = NSImage(systemSymbolName: isMicOn ? "mic.fill" : "mic",
                                  accessibilityDescription: "说话")
        micButton.contentTintColor = isMicOn
            ? .systemRed
            : NSColor.white.withAlphaComponent(0.85)
    }

    func focusField() {
        window?.makeFirstResponder(field)
    }

    @objc private func submit() {
        let text = field.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        field.stringValue = ""
        onSend?(text)
    }

    @objc private func close() { onClose?() }

    func controlTextDidEndEditing(_ obj: Notification) {
        // 回车交给 action；这里只处理失焦，不做自动发送。
    }
}

// MARK: - 内容视图

final class PetContentView: NSView {
    private let stageView = StageView(frame: .zero)
    private let bubble = BubbleView(frame: .zero)
    private let composer = ComposerView(frame: .zero)
    private let muteButton = NSButton()
    private let hideButton = NSButton()
    private let chatButton = NSButton(title: "聊一会", target: nil, action: nil)
    private let settingsButton = NSButton(title: "⚙", target: nil, action: nil)
    private let historyButton = NSButton(title: "对话", target: nil, action: nil)
    private let backgroundButton = NSButton(title: "换背景", target: nil, action: nil)
    private let statusLabel = NSTextField(labelWithString: "桌面伙伴 · 陪着你")
    /// 歌词条。和气泡分开：气泡是逐字打出来的（像说话），歌词是整行替换（像 KTV）。
    private let lyricLabel = NSTextField(labelWithString: "")
    private var tracking: NSTrackingArea?
    private var pendingClick: DispatchWorkItem?
    private var bubbleVisible = false
    private var composerVisible = false
    private var hovering = false

    var onClick: (() -> Void)?
    var onDoubleClick: (() -> Void)?
    var onSend: ((String) -> Void)?
    /// Mic button in the composer. Also raised by the status-bar item and by
    /// holding Space, so routing it through the controller keeps one path.
    var onMicTap: (() -> Void)? { didSet { composer.onMicTap = { [weak self] in self?.onMicTap?() } } }
    var onMute: (() -> Void)?
    var onHide: (() -> Void)?
    var onMenu: ((NSEvent) -> Void)?
    var onDragEnd: (() -> Void)?
    var onSettings: (() -> Void)?
    var onHistory: (() -> Void)?
    var onCancel: (() -> Void)?
    var onBackground: (() -> Void)?
    var onBackgroundError: ((String) -> Void)?
    private var busy = false

    var stageViewIdleLayerA: AVPlayerLayer { stageView.idleLayerA }
    var stageViewIdleLayerB: AVPlayerLayer { stageView.idleLayerB }
    var stageViewActionLayer: AVPlayerLayer { stageView.actionLayer }
    var composerField: NSTextField { composer.field }
    /// Drives the mic button's filled/red state while listening.
    var isComposerMicOn: Bool {
        get { composer.isMicOn }
        set { composer.isMicOn = newValue }
    }
    var sleepSceneActive: Bool { stageView.sleepSceneActive }
    var sleepSceneRate: Float { stageView.sleepSceneRate }
    @discardableResult
    func enterSleepScene(_ url: URL) -> Bool { stageView.enterSleepScene(url) }
    func exitSleepScene() { stageView.exitSleepScene() }
    var hasScene: Bool { stageView.hasScene }
    var scenePaused: Bool { stageView.scenePaused }
    var hasCharacter: Bool { stageView.hasCharacter }
    var characterPlacement: [String: Double] { stageView.placement }
    var characterFrame: CGRect { stageView.characterFrame }
    var backgroundRate: Float { stageView.backgroundRate }
    var backgroundIsVideo: Bool { stageView.backgroundIsVideo }
    var characterIsVideo: Bool { stageView.characterIsVideo }
    var characterRate: Float { stageView.characterRate }
    var characterTime: Double { stageView.characterTime }
    func restorePlacement(_ value: [String: Double]) { stageView.restorePlacement(value) }
    func scaleCharacter(_ delta: CGFloat) { stageView.scaleCharacter(delta) }
    func loadCharacter(_ url: URL, alignReactions: Bool = false) -> Bool { stageView.loadCharacter(url, alignReactions: alignReactions) }
    func loadBackground(_ url: URL) -> Bool { stageView.loadBackground(url) }
    func loadScene(_ url: URL) -> Bool { stageView.loadScene(url) }
    func setScenePaused(_ paused: Bool) { stageView.setScenePaused(paused) }
    func react() { stageView.react() }
    var reactionPlaying: Bool { stageView.reactionPlaying }
    var reactionPending: Bool { stageView.reactionPending }
    var reactionWait: Double { stageView.lastReactionWaitSeconds }
    var reactionRate: Float { stageView.reactionRate }
    @discardableResult
    func playCharacterReaction(_ url: URL) -> Bool { stageView.playCharacterReaction(url) }

    func setStatus(_ text: String) { statusLabel.stringValue = text }
    func setBusy(_ value: Bool) {
        busy = value
        chatButton.title = value ? "停止" : "聊一会"
        chatButton.setAccessibilityLabel(value ? "停止回复" : "打开聊天")
        needsLayout = true
    }

    private var didDrag = false
    private var draggingCharacter = false
    private var dragAnchor: NSPoint?

    override var isFlipped: Bool { true }

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        wantsLayer = true
        layer?.cornerRadius = 18
        layer?.masksToBounds = true
        layer?.backgroundColor = NSColor.black.cgColor

        addSubview(stageView)
        addSubview(bubble)
        addSubview(composer)

        for (button, symbol, tint) in [(muteButton, "speaker.wave.2.fill", NSColor.white),
                                       (hideButton, "xmark", NSColor.white)] {
            button.image = NSImage(systemSymbolName: symbol, accessibilityDescription: nil)
            button.isBordered = false
            button.bezelStyle = .inline
            button.contentTintColor = tint.withAlphaComponent(0.9)
            button.wantsLayer = true
            button.layer?.backgroundColor = NSColor.black.withAlphaComponent(0.45).cgColor
            button.layer?.cornerRadius = 11
            button.isHidden = false
            addSubview(button)
        }
        muteButton.target = self
        muteButton.action = #selector(toggleMute)
        hideButton.target = self
        hideButton.action = #selector(hidePet)
        muteButton.setAccessibilityLabel("静音")
        hideButton.setAccessibilityLabel("隐藏桌宠")
        for button in [chatButton, settingsButton, historyButton, backgroundButton] {
            button.isBordered = false
            button.contentTintColor = .white
            button.font = .systemFont(ofSize: 12, weight: .medium)
            button.wantsLayer = true
            button.layer?.cornerRadius = 12
            button.layer?.backgroundColor = NSColor(calibratedRed: 0.06, green: 0.17, blue: 0.25, alpha: 0.86).cgColor
            button.target = self
            addSubview(button)
        }
        chatButton.action = #selector(chat)
        chatButton.setAccessibilityLabel("打开聊天")
        settingsButton.action = #selector(settings)
        settingsButton.setAccessibilityLabel("连接设置")
        historyButton.action = #selector(history)
        historyButton.setAccessibilityLabel("查看完整对话")
        backgroundButton.action = #selector(changeBackground)
        backgroundButton.setAccessibilityLabel("更换背景图片或视频")
        stageView.onBackgroundError = { [weak self] message in self?.onBackgroundError?(message) }
        statusLabel.font = .systemFont(ofSize: 11, weight: .medium)
        statusLabel.textColor = .white
        statusLabel.wantsLayer = true
        statusLabel.layer?.backgroundColor = NSColor.black.withAlphaComponent(0.55).cgColor
        statusLabel.layer?.cornerRadius = 8
        statusLabel.lineBreakMode = .byTruncatingTail
        addSubview(statusLabel)

        bubble.isHidden = true
        composer.isHidden = true
        composer.onSend = { [weak self] text in self?.onSend?(text) }
        composer.onClose = { [weak self] in self?.hideComposer() }

        lyricLabel.font = .systemFont(ofSize: 15, weight: .semibold)
        lyricLabel.textColor = .white
        lyricLabel.alignment = .center
        lyricLabel.wantsLayer = true
        lyricLabel.layer?.backgroundColor = NSColor.black.withAlphaComponent(0.52).cgColor
        lyricLabel.layer?.cornerRadius = 10
        lyricLabel.lineBreakMode = .byTruncatingTail
        lyricLabel.drawsBackground = false
        lyricLabel.isHidden = true
        addSubview(lyricLabel)
    }

    /// 歌词。传 nil 收起。只换字，不重排——重排会让整条歌词每句都跳一下。
    func showLyric(_ text: String?) {
        let value = (text ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let hidden = value.isEmpty
        if lyricLabel.isHidden != hidden { lyricLabel.isHidden = hidden }
        if !hidden, lyricLabel.stringValue != value { lyricLabel.stringValue = value }
        if hidden { lyricLabel.stringValue = "" }
    }

    var lyricText: String { lyricLabel.isHidden ? "" : lyricLabel.stringValue }

    required init?(coder: NSCoder) { fatalError("init(coder:) not supported") }

    override func layout() {
        super.layout()
        stageView.frame = bounds
        bubble.layoutSubtreeIfNeeded()

        if bubbleVisible {
            let size = bubble.fittedSize(maxWidth: max(160, bounds.width * 0.45))
            bubble.frame = NSRect(x: 16, y: 52, width: size.width, height: size.height)
        }
        if composerVisible {
            composer.frame = NSRect(x: 12, y: bounds.height - 46, width: bounds.width - 24, height: 36)
        }
        muteButton.frame = NSRect(x: bounds.width - 60, y: 10, width: 22, height: 22)
        hideButton.frame = NSRect(x: bounds.width - 32, y: 10, width: 22, height: 22)
        settingsButton.frame = NSRect(x: bounds.width - 88, y: 10, width: 22, height: 22)
        chatButton.frame = NSRect(x: bounds.width - 94, y: bounds.height - 40, width: 78, height: 26)
        historyButton.frame = NSRect(x: bounds.width - 154, y: bounds.height - 40, width: 52, height: 26)
        statusLabel.frame = NSRect(x: 16, y: 16, width: min(240, bounds.width - 116), height: 21)
        // 歌词贴在底边上方：不挡人物的脸（人物默认在中上部），也不压底部按钮。
        if !lyricLabel.isHidden {
            let width = min(bounds.width - 48, 520)
            let height: CGFloat = 26
            let y = composerVisible ? bounds.height - 84 : bounds.height - 56
            lyricLabel.frame = NSRect(x: (bounds.width - width) / 2, y: y, width: width, height: height)
        }
        chatButton.isHidden = composerVisible && !busy
        historyButton.isHidden = composerVisible
        backgroundButton.frame = NSRect(x: 16, y: bounds.height - 40, width: 78, height: 26)
        backgroundButton.isHidden = composerVisible || !hasCharacter
    }

    // MARK: 气泡 / 输入条

    func showBubble(_ text: String) {
        bubble.setText(text)
        if !bubbleVisible {
            bubbleVisible = true
            bubble.isHidden = false
        }
        needsLayout = true
    }

    func hideBubble() {
        bubbleVisible = false
        bubble.isHidden = true
    }

    func showComposer() {
        hideBubble()
        composerVisible = true
        composer.isHidden = false
        needsLayout = true
    }

    func hideComposer() {
        composerVisible = false
        composer.isHidden = true
        composer.field.stringValue = ""
        needsLayout = true
    }

    var isComposerVisible: Bool { composerVisible }
    var currentBubbleText: String { bubble.textValue }
    var isBubbleVisible: Bool { bubbleVisible }

    func setMuted(_ muted: Bool) {
        muteButton.image = NSImage(systemSymbolName: muted ? "speaker.slash.fill" : "speaker.wave.2.fill",
                                   accessibilityDescription: nil)
        muteButton.setAccessibilityLabel(muted ? "打开声音" : "静音")
    }

    // MARK: 鼠标

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let tracking { removeTrackingArea(tracking) }
        let area = NSTrackingArea(rect: bounds,
                                  options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect],
                                  owner: self, userInfo: nil)
        addTrackingArea(area)
        tracking = area
    }

    override func mouseEntered(with event: NSEvent) {
        hovering = true
        muteButton.isHidden = false
        hideButton.isHidden = false
    }

    override func mouseExited(with event: NSEvent) {
        hovering = false
        muteButton.isHidden = false
        hideButton.isHidden = false
    }

    override func mouseDown(with event: NSEvent) {
        dragAnchor = window?.convertPoint(toScreen: event.locationInWindow)
        let point = stageView.convert(event.locationInWindow, from: nil)
        draggingCharacter = stageView.hasCharacter && !stageView.sleepSceneActive && stageView.characterFrame.contains(point)
        if event.clickCount >= 2 {
            pendingClick?.cancel()
            pendingClick = nil
            onDoubleClick?()
            return
        }
        // 单点要等双击判定窗口过去：否则双击会先冒一句台词，再弹出输入条。
        let shouldReact = stageView.sleepSceneActive || !stageView.hasCharacter || draggingCharacter
        let item = DispatchWorkItem { [weak self] in if shouldReact { self?.onClick?() } }
        pendingClick = item
        DispatchQueue.main.asyncAfter(deadline: .now() + NSEvent.doubleClickInterval + 0.02, execute: item)
    }

    override func mouseDragged(with event: NSEvent) {
        pendingClick?.cancel()
        pendingClick = nil
        guard let window else { return }
        didDrag = true
        let point = window.convertPoint(toScreen: event.locationInWindow)
        let previous = dragAnchor ?? point
        let dx = point.x - previous.x
        let dy = point.y - previous.y
        dragAnchor = point
        if draggingCharacter {
            stageView.moveCharacter(dx: dx, dy: dy)
            return
        }
        let origin = window.frame.origin
        window.setFrameOrigin(NSPoint(x: origin.x + dx, y: origin.y + dy))
    }

    override func mouseUp(with event: NSEvent) {
        guard didDrag else { return }
        didDrag = false
        onDragEnd?()
    }

    override func rightMouseDown(with event: NSEvent) {
        onMenu?(event)
    }

    @objc private func toggleMute() { onMute?() }
    @objc private func hidePet() { onHide?() }
    @objc private func chat() { if busy { onCancel?() } else { onDoubleClick?() } }
    @objc private func settings() { onSettings?() }
    @objc private func history() { onHistory?() }
    @objc private func changeBackground() { onBackground?() }
}
