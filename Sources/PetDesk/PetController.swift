import AppKit
import AVFoundation
import CompanionCore
import Speech
import UniformTypeIdentifiers

@MainActor
final class PetController: NSObject {
    private var panel: NSPanel!
    private var content: PetContentView!
    private let stage = PetStage()
    private let client = LocalModelClient()
    private let speech = AVSpeechSynthesizer()
    private let neuralSpeech = PetNeuralSpeech()
    private let voiceInput = PetVoiceInput()
    /// 唱歌走独立播放器：它要能报「唱到第几句」、能被点击打断、能暂停，
    /// 和「说完一句就结束」的 TTS 生命周期不一样。
    private let songPlayer = PetSongPlayer()
    private(set) var currentSong: PetPack.Song?
    private let store: LocalStore?

    private var history: [ChatMessage] = []
    private var busy = false
    private var muted = false
    private var asleep = false
    private var lastInteraction = Date()
    private var quietMode = false
    private var normalPlacement: [String: Double]?
    private var lastActionAt = Date.distantPast
    private var tapCount = 0

    private var typingTimer: Timer?
    private var hideTimer: Timer?
    private var idleTimer: Timer?
    private var typed = ""
    private var full = ""
    private var holdSeconds: TimeInterval = 6
    private var replyTask: Task<Void, Never>?
    private var replyGeneration = 0
    private var transcriptWindow: NSWindow?
    private var identity: PetIdentity?
    /// 内容包：角色说什么、播哪几段、解锁阈值全在这里，代码只做解释器。
    private var pack: PetPack?
    /// 相处出来的状态：好感度 / 看过哪些片段 / 上次见面是哪天。
    private var state = PetState()
    private var albumWindow: PetAlbumWindow?
    private var storyWindow: PetStoryWindow?
    private var historyFile: String { Bundle.main.object(forInfoDictionaryKey: "PetHistoryFile") as? String ?? "history-pet.json" }
    private var stateFile: String { identity == nil ? "pet-state.json" : historyFile.replacingOccurrences(of: ".json", with: "-state.json") }

    private var panelSize = NSSize(width: 640, height: 360)

    // MARK: - hands-free talk

    /// How long after she stops speaking the mic reopens on its own, so a
    /// conversation does not need a click per turn. 0 disables it.
    private var continuousWindow: TimeInterval = 12
    /// Set when she speaks; cleared the moment the user talks over her.
    private var awaitingFollowUp = false
    private var followUpDeadline: Date?
    private var followUpTimer: Timer?
    /// Wake words are matched case-insensitively against partial results.
    private var wakeWords: [String] = []
    /// Always-on listening. Off by default: it costs battery and privacy.
    private var wakeEnabled = false
    /// True while a recognition round came from the always-on ear, meaning the
    /// result must contain a wake word before it is worth answering.
    private var wantsWakeCheck = false

    override init() {
        store = try? LocalStore()
        super.init()
        identity = PetIdentity.load(from: assetRoot)
        if let loaded = PetPack.load(from: assetRoot) {
            pack = loaded
        } else if let root = assetRoot {
            // pack.json 缺失也要能跑：退回最小包，只用 idle-01 循环起来。
            var fallback = PetPack.minimal
            fallback.root = root
            pack = fallback
        }
        if let store {
            history = (try? store.load([ChatMessage].self, file: historyFile, fallback: [])) ?? []
            state = (try? store.load(PetState.self, file: stateFile, fallback: PetState())) ?? PetState()
        }
        if let url = originFile, let data = try? Data(contentsOf: url),
           let dict = try? JSONSerialization.jsonObject(with: data) as? [String: Double], let width = dict["w"], width.isFinite {
            let available = NSScreen.main?.visibleFrame.width ?? 900
            let w = min(max(width, 360), min(900, available))
            panelSize = NSSize(width: w, height: w * 9 / 16)
        }
        buildPanel()
    }

    // MARK: 窗口

    private func buildPanel() {
        let origin = restoredOrigin() ?? defaultOrigin()
        panel = PetPanel(contentRect: NSRect(origin: origin, size: panelSize),
                         // nonactivatingPanel：点击只让面板变成 key，不把整个 app 抢到前台。
                         // 桌宠是常驻在别人窗口之上的东西，一碰就抢焦点很烦。
                         styleMask: [.borderless, .nonactivatingPanel],
                         backing: .buffered, defer: false)
        panel.level = .floating
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.isReleasedWhenClosed = false
        panel.isMovableByWindowBackground = false
        panel.hidesOnDeactivate = false
        panel.becomesKeyOnlyIfNeeded = false
        // 跟着切到任何桌面和全屏空间一起去，否则一进全屏她就被关在门外。
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]

        content = PetContentView(frame: NSRect(origin: .zero, size: panelSize))
        content.layer?.borderWidth = 1
        content.layer?.borderColor = NSColor.white.withAlphaComponent(0.14).cgColor
        panel.contentView = content

        content.onClick = { [weak self] in self?.handleTap() }
        content.onDoubleClick = { [weak self] in self?.openComposer() }
        content.onSend = { [weak self] text in self?.send(text) }
        content.onMicTap = { [weak self] in self?.toggleMic() }
        content.onMute = { [weak self] in self?.toggleMute() }
        bindVoiceInput()
        content.onHide = { [weak self] in self?.hide() }
        content.onMenu = { [weak self] event in self?.showMenu(for: event) }
        content.onDragEnd = { [weak self] in self?.saveOrigin(); self?.savePlacement() }
        content.onSettings = { [weak self] in self?.menuSettings() }
        content.onHistory = { [weak self] in self?.showTranscript() }
        content.onCancel = { [weak self] in self?.cancelReply(); self?.showBubble("好，先停下来。", hold: 4) }
        content.onBackground = { [weak self] in self?.chooseBackground() }
        content.onBackgroundError = { [weak self] message in self?.showBubble(message, hold: 12) }
        panel.title = identity?.name ?? "桌面伙伴"

        stage.attach(idleA: content.stageViewIdleLayerA,
                     idleB: content.stageViewIdleLayerB,
                     action: content.stageViewActionLayer)
        stage.onError = { [weak self] message in
            self?.showBubble(message, hold: 20)
        }
        songPlayer.onLine = { [weak self] line in self?.content.showLyric(line) }
        songPlayer.onFinish = { [weak self] in self?.stopSinging(finished: true) }
        songPlayer.onError = { [weak self] message in
            guard let self else { return }
            // 播放器自己已经清干净了，这里只把界面状态收回待机。
            self.currentSong = nil
            self.content.showLyric(nil)
            self.setStatus(self.companionStatus)
            self.showBubble(message, hold: 20)
        }
    }

    func show() {
        panel.orderFrontRegardless()
        start()
    }

    func hide() {
        stop()
        panel.orderOut(nil)
    }

    func toggle() {
        if panel.isVisible { hide() } else { show() }
    }

    var isVisible: Bool { panel.isVisible }

    // MARK: 素材

    private var assetRoot: URL? {
        if let explicit = ProcessInfo.processInfo.environment["LINGDESK_PET_ASSETS"] {
            return URL(fileURLWithPath: explicit, isDirectory: true)
        }
        if let store {
            let local = store.root.appendingPathComponent("PetAssets", isDirectory: true)
            if FileManager.default.fileExists(atPath: local.path) { return local }
        }
        if let bundled = Bundle.main.resourceURL?.appendingPathComponent("PetAssets", isDirectory: true),
           FileManager.default.fileExists(atPath: bundled.path) { return bundled }
        for candidate in [FileManager.default.currentDirectoryPath,
                          URL(fileURLWithPath: CommandLine.arguments[0]).deletingLastPathComponent().path] {
            let url = URL(fileURLWithPath: candidate).appendingPathComponent("assets/malfoy-pack", isDirectory: true)
            if FileManager.default.fileExists(atPath: url.path) { return url }
        }
        return nil
    }

    private func clip(_ name: String) -> URL? {
        guard let root = assetRoot else { return nil }
        let url = root.appendingPathComponent("\(name).mp4")
        return FileManager.default.fileExists(atPath: url.path) ? url : nil
    }

    // MARK: 启动 / 停止

    func start() {
        stage.setPaused(false)
        content.setScenePaused(false)
        if let identity, let root = assetRoot {
            let background = root.appendingPathComponent(identity.background ?? identity.scene)
            guard content.hasScene || content.loadBackground(background) else {
                showBubble("场景图片无法读取，请检查素材包。", hold: 40)
                return
            }
            if let character = identity.character, !content.hasCharacter {
                guard content.loadCharacter(root.appendingPathComponent(character), alignReactions: identity.characterTransitionsAtLoopBoundary ?? false) else {
                    showBubble("人物需要透明 PNG 或兼容的透明 MOV 视频，请检查素材。", hold: 40)
                    return
                }
                if let placement = try? store?.load([String: Double].self, file: "deepsea-placement.json", fallback: [:]) {
                    content.restorePlacement(placement)
                }
            }
            content.setScenePaused(false)
            if identity.character == nil, let idle = clip("idle-01") { stage.loadIdle(idle) }
            setStatus(companionStatus)
        } else if let pack, !pack.ambientFiles.isEmpty {
            applyPack(pack)
        } else if let idle = clip("idle-01") {
            stage.loadIdle(idle)
        } else if let pack, !pack.missingAmbientNames.isEmpty {
            // 声明了待机素材但一个都不在：别只说「没找到素材」，要说清缺哪些。
            showBubble("待机素材全缺失：\(pack.missingAmbientNames.joined(separator: "、"))", hold: 30)
            return
        } else {
            showBubble("没找到素材。把 idle-01.mp4 放进 PetAssets 再叫我。", hold: 40)
            return
        }
        scheduleNextIdle()
        if asleep { setStatus("睡着了 · 点我唤醒"); return }
        if quietMode { setStatus("安静陪你") }
        registerVisit()
        let greeting = pack?.greeting?.randomElement()
            ?? identity?.greeting
            ?? PetLines.greeting().randomElement()
            ?? "……"
        // 素材有问题时先说问题：接着打招呼会把这条提示顶掉，等于没说过。
        if let warning = assetWarning {
            showBubble(warning, hold: 25)
            assetWarning = nil
        } else {
            showBubble(greeting, hold: 9)
        }
    }

    /// 按内容包把画面铺起来：静帧兜底 → 待机循环 → 状态文字。
    private func applyPack(_ pack: PetPack) {
        if !content.hasScene, let still = pack.file(pack.sceneValue.still) {
            _ = content.loadScene(still)
        }
        let ambient = pack.ambientFiles
        stage.loadAmbient(ambient)
        // 素材声明了但文件不在：pack.ambientFiles 会静默丢掉这些项，
        // 所以单独再报一次。这句要压过问候语，不然用户根本看不到。
        let missing = pack.missingAmbientNames
        if !missing.isEmpty {
            let message = "待机素材缺失，已跳过：\(missing.joined(separator: "、"))"
            assetWarning = message
            // 同步到舞台的健康度：自检读 idle.health 就能发现这件事，
            // 不必去猜「是不是渲染卡了」。
            stage.flagMissing(message)
        } else if ambient.isEmpty, !content.hasScene {
            assetWarning = "待机素材缺失：pack.json 的 scene.ambient 一个可用文件都没有。"
        }
        setStatus(companionStatus)
    }

    func stop() {
        cancelReply()
        typingTimer?.invalidate(); hideTimer?.invalidate(); idleTimer?.invalidate()
        typingTimer = nil; hideTimer = nil; idleTimer = nil
        speech.stopSpeaking(at: .immediate); neuralSpeech.stop()
        stage.setPaused(true)
        content.setScenePaused(true)
        content.hideComposer()
    }

    private func settings() throws -> Settings {
        var config = try store?.load(Settings.self, file: "settings.json", fallback: Settings()) ?? Settings()
        if let identity { config.persona = identity.persona }
        // 内容包里的 persona 优先级最高：换角色时它是跟着素材走的。
        if let persona = pack?.persona, !persona.isEmpty { config.persona = persona }
        return config
    }

    private var companionStatus: String {
        guard let pack else { return "陪着你" }
        return "\(pack.address(for: state.affinity) ?? "陪着你") · 好感 \(state.affinity)"
    }

    private func setStatus(_ text: String) {
        let name = pack?.displayName ?? identity?.name ?? "桌面伙伴"
        content.setStatus("\(name) · \(text)")
    }

    func cancelReply() {
        replyGeneration += 1
        replyTask?.cancel()
        replyTask = nil
        busy = false
        content.setBusy(false)
        setStatus(companionStatus)
        speech.stopSpeaking(at: .immediate); neuralSpeech.stop()
    }

    // MARK: 互动

    private func handleTap() {
        lastInteraction = Date()
        tapCount += 1
        // 唱歌时点一下就是「别唱了」——这是所有人对播放器的第一反应。
        if isSinging {
            stopSinging(reason: "……那我先不唱了。")
            return
        }
        guard !busy else { return }
        content.react()
        if asleep {
            wake()
            showBubble("……醒了。", hold: 4)
            return
        }
        // 两次点击挨太近就只说话不叠动作，否则画面会来回抽。
        if !quietMode, Date().timeIntervalSince(lastActionAt) > 1.2,
           let touch = pack?.file(pack?.sceneValue.touch) ?? clip("touch-01") {
            if content.hasCharacter { content.playCharacterReaction(touch) }
            else { stage.playOnce(touch) }
            lastActionAt = Date()
        }
        let lines = pack?.touches ?? identity?.touches ?? PetLines.touched()
        showBubble(lines.randomElement() ?? "我在。", hold: 5)
        // 摸她加好感，但带冷却：连点十下也只算一次。
        if let pack, Date().timeIntervalSince1970 - state.lastTouch >= pack.touchCooldown {
            state.lastTouch = Date().timeIntervalSince1970
            addAffinity(pack.touchValue)
        }
    }

    private func openComposer() {
        guard !busy else { return }
        if asleep { wake() }
        lastInteraction = Date()
        asleep = false
        speech.stopSpeaking(at: .immediate); neuralSpeech.stop()
        content.setScenePaused(false)
        setStatus("听你说")
        hideBubble()
        content.showComposer()
        forceActivate()
        // borderless 面板要显式把第一响应者交给输入框，
        // 光 makeKey 还不够：焦点可能还停在内容视图上，看起来像「点了打不了字」。
        panel.makeFirstResponder(content.composerField)
    }

    /// 让窗口真的能接收键盘。
    ///
    /// 键盘事件只会送到「前台且 key」的窗口，这是系统规则，绕不过去。
    /// `accessory` 策略的 app 在有真实点击时会被正常激活，但从终端/后台拉起的
    /// 进程可能拿不到激活权。这种时候退一步切成常规策略——宁可闪一下 Dock 图标，
    /// 也比「点了输入框却打不出字」强。
    private func forceActivate() {
        panel.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        NSRunningApplication.current.activate(options: [.activateAllWindows])
        guard !NSApp.isActive else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { [weak self] in
            guard let self, !NSApp.isActive else { return }
            NSApp.setActivationPolicy(.regular)
            NSApp.activate(ignoringOtherApps: true)
            self.panel.makeKeyAndOrderFront(nil)
            self.panel.makeFirstResponder(self.content.composerField)
        }
    }

    private func send(_ text: String) {
        let text = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !busy, !text.isEmpty else { return }
        // 本地就能办的先办：「唱首歌」不该等模型，不该花额度，也不该被拒绝。
        if handleSingIntent(text) {
            content.hideComposer()
            return
        }
        let config: Settings
        do { config = try settings(); _ = try config.endpoint("chat/completions") }
        catch {
            showBubble(error.localizedDescription, hold: 15)
            return
        }
        if asleep { wake() }
        busy = true
        lastInteraction = Date()
        speech.stopSpeaking(at: .immediate); neuralSpeech.stop()
        content.setBusy(true)
        setStatus("正在想 · 可点停止")
        content.hideComposer()
        showBubble("让我想想…", hold: 120)
        let requestHistory = history + [ChatMessage(role: "user", content: text)]
        replyGeneration += 1
        let generation = replyGeneration
        if let think = clip("idle-02") { stage.playOnce(think) }

        replyTask = Task { [weak self] in
            guard let self else { return }
            do {
                let answer = try await client.reply(settings: config, history: requestHistory)
                guard !Task.isCancelled, generation == replyGeneration, panel.isVisible else { return }
                busy = false
                replyTask = nil
                content.setBusy(false)
                setStatus(companionStatus)
                history = requestHistory
                history.append(ChatMessage(role: "assistant", content: answer))
                trimHistory()
                persistHistory()
                // 聊天也给好感度，但带冷却——否则连发「嗯」就能刷满。
                if let pack, Date().timeIntervalSince1970 - state.lastChat >= pack.chatCooldown {
                    state.lastChat = Date().timeIntervalSince1970
                    addAffinity(pack.chatValue)
                }
                showBubble(answer, hold: 11)
                if !muted && config.speakReplies { speak(answer) }
            } catch {
                guard !Task.isCancelled, generation == replyGeneration, panel.isVisible else { return }
                busy = false
                replyTask = nil
                content.setBusy(false)
                setStatus("连接未就绪 · 右上角设置")
                showBubble("聊天暂时接不上：\(friendly(error))\n点右上角 ⚙ 检查模型连接。", hold: 20)
            }
        }
    }

    // MARK: - 唱歌

    var hasSongs: Bool { !(pack?.songs ?? []).isEmpty }
    var isSinging: Bool { songPlayer.hasSong }
    func song(withID id: String) -> PetPack.Song? { (pack?.songs ?? []).first { $0.id == id } }

    /// 唱一首。唱歌和说话互斥：先把她正在说的话掐掉，再起歌。
    func sing(_ song: PetPack.Song) {
        guard let pack else { return }
        guard let url = pack.file(song.file) else {
            showBubble("《\(song.title)》的音频不在素材包里：\(song.file)", hold: 20)
            return
        }
        if asleep { wake() }
        speech.stopSpeaking(at: .immediate)
        neuralSpeech.stop()
        cancelFollowUpTimer()
        awaitingFollowUp = false
        content.isComposerMicOn = false
        hideBubble()
        content.hideComposer()
        guard songPlayer.play(song: song, url: url, volume: song.volume) else { return }
        currentSong = song
        lastInteraction = Date()
        lastActionAt = Date()
        setStatus("♪ \(song.title)")
        content.showLyric(song.lyrics?.first?.zh)
    }

    /// 点一首还没唱过的；都唱过就随机。这样连说两次「唱首歌」不会放同一首。
    ///
    /// 只挑**文件真的在**的：素材包可能换了、音频被删了，抽到一首唱不出来的
    /// 等于让「唱首歌」变成一次报错。菜单里仍然列出缺失的（点了会说缺什么），
    /// 但自动点歌不该踩到。
    func nextSong() -> PetPack.Song? {
        guard let pack else { return nil }
        let available = pack.availableSongs(affinity: state.affinity).filter { pack.file($0.file) != nil }
        guard !available.isEmpty else { return nil }
        let fresh = available.filter { !state.heardSong($0.id) }
        return (fresh.isEmpty ? available : fresh).randomElement()
    }

    /// 收尾。`finished` 区分「唱完了」和「被打断」——只有唱完才加好感、才记听过。
    func stopSinging(reason: String? = nil, finished: Bool = false) {
        let song = currentSong
        guard song != nil || songPlayer.hasSong else { return }
        songPlayer.stop()
        currentSong = nil
        content.showLyric(nil)
        setStatus(companionStatus)
        guard finished, let song else {
            if let reason { showBubble(reason, hold: 5) }
            return
        }
        state.markSong(song.id)
        persistState()
        if let pack {
            addAffinity(pack.songValue)
            showBubble((pack.songLines?.randomElement()) ?? "唱完了。《\(song.title)》", hold: 7)
        } else {
            showBubble("唱完了。《\(song.title)》", hold: 7)
        }
    }

    /// 「唱首歌」这类话不该过一遍模型：模型可能拒绝、可能回一句「我是 AI」，
    /// 还要等好几秒。音箱的做法是本地直接认。
    private func handleSingIntent(_ text: String) -> Bool {
        let compact = text.replacingOccurrences(of: " ", with: "")
        guard !compact.isEmpty else { return false }
        // 先判「别唱」，否则「别唱了」里的「唱」会把它当成点歌。
        if ["别唱", "不唱了", "停唱", "别放了"].contains(where: { compact.contains($0) }) {
            guard isSinging else {
                showBubble("我没在唱呀。", hold: 4)
                return true
            }
            stopSinging(reason: "好，不唱了。")
            return true
        }
        // 问句不算点歌：「你会唱歌吗」是在问，不是在点。
        guard !compact.hasSuffix("吗") && !compact.hasSuffix("？") && !compact.hasSuffix("?") else { return false }
        let asks = ["唱首歌", "唱一首", "唱歌", "来一首", "唱个", "点歌", "听你唱", "唱支"]
        guard asks.contains(where: { compact.contains($0) }), compact.count <= 16 else { return false }
        guard let song = nextSong() else {
            showBubble("素材包里还没有能唱的歌。", hold: 12)
            return true
        }
        sing(song)
        return true
    }

    // MARK: - 语音：像音箱那样对话
    //
    // 「音箱感」由三件事凑出来：不用点就能说、说完自己停、你一开口她就闭嘴。
    // 少任何一件，手感都会退回成一个输入框。

    private func bindVoiceInput() {
        voiceInput.onTranscript = { [weak self] text in
            guard let self, !text.isEmpty else { return }
            // Live caption, so a mis-heard line can be retaken immediately
            // instead of after a full round-trip through the model.
            self.showBubble(text, hold: 60)
        }
        voiceInput.onFinal = { [weak self] text in
            guard let self else { return }
            self.content.isComposerMicOn = false
            self.cancelFollowUpTimer()
            let wantedWake = self.wantsWakeCheck
            self.wantsWakeCheck = false
            self.awaitingFollowUp = false
            guard !text.isEmpty else { self.setStatus(self.companionStatus); return }
            guard wantedWake else { self.send(text); return }
            // Came from the always-on ear: only answer if she was addressed.
            guard self.matchesWake(text) else { return }
            let cleaned = self.stripWake(text)
            if cleaned.isEmpty {
                self.showBubble("在呢。", hold: 8)
                self.speak("在呢。")
                return
            }
            self.send(cleaned)
        }
        voiceInput.onVoiceActivity = { [weak self] in
            guard let self else { return }
            let wasWaiting = self.awaitingFollowUp
            let wasWake = self.wantsWakeCheck
            self.bargeIn()
            guard wasWaiting || wasWake else { return }
            // Inside the follow-up window, or the always-on ear heard someone:
            // neither needs her name said again.
            self.awaitingFollowUp = false
            self.content.isComposerMicOn = true
            if wasWake { self.setStatus("听着呢…") }
            self.voiceInput.beginDictation()
        }
        voiceInput.onFailure = { [weak self] message in
            guard let self else { return }
            self.content.isComposerMicOn = false
            self.showBubble(message, hold: 14)
        }
        // Her finishing a sentence opens the follow-up window.
        neuralSpeech.onFinishSpeaking = { [weak self] in self?.armFollowUp() }
        voiceInput.onPhaseChange = { [weak self] phase in
            guard let self, self.wakeEnabled, phase == .idle, !self.busy else { return }
            // Always-on listening: restart the ear after each round ends.
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { [weak self] in
                guard let self, self.wakeEnabled, !self.busy else { return }
                self.wantsWakeCheck = true
                self.voiceInput.start(mode: .monitor)
            }
        }
        wakeWords = identity?.wakeWords ?? []
        if let seconds = identity?.continuousSeconds, seconds >= 0 {
            continuousWindow = min(seconds, 60)
        }
    }

    // MARK: - always-on listening

    /// Wake words cost battery and keep the mic live, so this is opt-in and
    /// off by default. Documented rather than hidden.
    func setWakeEnabled(_ enabled: Bool) {
        wakeEnabled = enabled
        if enabled {
            wakeWords = identity?.wakeWords ?? []
            if wakeWords.isEmpty { wakeWords = [identity?.name ?? "喂"].filter { !$0.isEmpty } }
            Task { [weak self] in
                guard let self else { return }
                if SFSpeechRecognizer.authorizationStatus() != .authorized {
                    guard await self.voiceInput.requestPermission() else {
                        self.wakeEnabled = false
                        self.showBubble("要先允许麦克风和语音识别，才能一直听着。", hold: 14)
                        return
                    }
                }
                self.wantsWakeCheck = true
                self.voiceInput.start(mode: .monitor)
                self.setStatus("一直听着 · 喊她的名字")
            }
        } else {
            wantsWakeCheck = false
            voiceInput.stop()
            setStatus(companionStatus)
        }
    }

    private func matchesWake(_ text: String) -> Bool {
        guard !wakeWords.isEmpty else { return true }
        let flat = text.lowercased().replacingOccurrences(of: " ", with: "")
        return wakeWords.contains { flat.contains($0.lowercased().replacingOccurrences(of: " ", with: "")) }
    }

    /// Drop the wake word so the model sees "今天天气怎么样", not "澜 今天天气怎么样".
    private func stripWake(_ text: String) -> String {
        var out = text
        for word in wakeWords.sorted(by: { $0.count > $1.count }) {
            out = out.replacingOccurrences(of: word, with: "", options: .caseInsensitive)
        }
        return out.trimmingCharacters(in: .whitespacesAndNewlines)
            .trimmingCharacters(in: CharacterSet(charactersIn: "，,。、?？!！"))
    }

    /// Single entry point for the mic: composer button, status bar, and any
    /// future hotkey all land here so there is only one state machine.
    func toggleMic() {
        if voiceInput.phase == .listening {
            cancelFollowUpTimer()
            awaitingFollowUp = false
            voiceInput.stop()
            content.isComposerMicOn = false
            setStatus(companionStatus)
            return
        }
        Task { [weak self] in
            guard let self else { return }
            // Permission prompts are shown only from this deliberate action.
            // Asking at launch would burn both prompts before the user cares.
            if SFSpeechRecognizer.authorizationStatus() != .authorized {
                guard await voiceInput.requestPermission() else {
                    self.showBubble("要允许麦克风和语音识别，我才能听你说话。", hold: 14)
                    return
                }
            }
            guard self.voiceInput.unavailabilityReason() == nil else {
                self.showBubble(self.voiceInput.unavailabilityReason() ?? "这台 Mac 用不了语音识别。", hold: 14)
                return
            }
            if self.asleep { self.wake() }
            self.startListening(mode: .dictation)
        }
    }

    private func startListening(mode: PetVoiceInput.Mode) {
        guard !busy else { return }
        cancelFollowUpTimer()
        // Ears open only after the mouth shuts, or she transcribes herself.
        speech.stopSpeaking(at: .immediate)
        neuralSpeech.stop()
        lastInteraction = Date()
        content.setScenePaused(false)
        if mode == .dictation {
            content.showComposer()
            content.isComposerMicOn = true
            setStatus("听着呢…")
        }
        guard voiceInput.start(mode: mode) else {
            content.isComposerMicOn = false
            return
        }
    }

    /// The user started talking: stop whatever she was saying.
    private func bargeIn() {
        if speech.isSpeaking { speech.stopSpeaking(at: .immediate) }
        if neuralSpeech.isPlaying {
            neuralSpeech.stop()
            if !content.isBubbleVisible { setStatus("听着呢…") }
        }
        // 一开口就闭嘴，唱歌同理：她唱着的时候你说话，歌要停。
        if isSinging {
            stopSinging()
            if !content.isBubbleVisible { setStatus("听着呢…") }
        }
        awaitingFollowUp = false
    }

    /// After she speaks, leave the mic half-open for a while so a reply needs
    /// no click. Only level is measured here — running recognition for the
    /// whole window is not worth the battery to save one click.
    private func armFollowUp() {
        guard continuousWindow > 0, !muted, panel.isVisible, !busy else { return }
        awaitingFollowUp = true
        followUpDeadline = Date().addingTimeInterval(continuousWindow)
        setStatus("还想说什么，直接说")
        startListening(mode: .monitor)
        followUpTimer?.invalidate()
        followUpTimer = Timer.scheduledTimer(withTimeInterval: continuousWindow, repeats: false) { [weak self] _ in
            Task { @MainActor [weak self] in self?.closeFollowUp() }
        }
    }

    private func closeFollowUp() {
        guard awaitingFollowUp else { return }
        awaitingFollowUp = false
        if voiceInput.phase == .listening { voiceInput.stop() }
        content.isComposerMicOn = false
        setStatus(companionStatus)
    }

    private func cancelFollowUpTimer() {
        followUpTimer?.invalidate()
        followUpTimer = nil
    }

    private func friendly(_ error: Error) -> String {
        if let companion = error as? CompanionError { return companion.message }
        let ns = error as NSError
        if ns.domain == NSURLErrorDomain {
            switch ns.code {
            case NSURLErrorNotConnectedToInternet: return "这台 Mac 现在没联网。"
            case NSURLErrorCannotFindHost, NSURLErrorCannotConnectToHost: return "找不到服务地址，检查一下设置。"
            case NSURLErrorTimedOut: return "等太久了，服务没回应。"
            default: return "网络请求失败（\(ns.code)）。"
            }
        }
        return error.localizedDescription
    }

    private func trimHistory() {
        if history.count > 120 { history = Array(history.suffix(120)) }
    }

    private func persistHistory() {
        try? store?.save(Array(history.suffix(120)), file: historyFile)
    }

    // MARK: 好感度与解锁
    //
    // 一条数字串起五件事：场景、相册、章节、称呼、解锁提示。
    // 关键是所有获取途径都要有冷却或上限，否则连点就能刷满——那种数值是假的。

    private func persistState() {
        try? store?.save(state, file: stateFile)
    }

    private static func dayKey() -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.timeZone = .current
        return formatter.string(from: Date())
    }

    /// 一天只在第一次见到她时加，同一天反复开关不加。
    private func registerVisit() {
        let day = Self.dayKey()
        guard state.lastVisitDay != day else { return }
        let firstEver = state.lastVisitDay.isEmpty
        state.lastVisitDay = day
        persistState()
        guard !firstEver, let pack else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 3.0) { [weak self] in
            guard let self, panel.isVisible else { return }
            addAffinity(pack.dailyVisitValue, reason: "今天第一次见面")
        }
    }

    @discardableResult
    func addAffinity(_ delta: Int, reason: String? = nil) -> Int {
        guard let pack else { return state.affinity }
        let before = state.affinity
        state.affinity = min(max(state.affinity + delta, 0), pack.capValue)
        guard state.affinity != before else { return state.affinity }
        persistState()
        if !asleep { setStatus(companionStatus) }
        checkUnlocks(pack)
        return state.affinity
    }

    /// 阈值一到就提示一次，之后不再重复。提示走气泡，不挡画面。
    private func checkUnlocks(_ pack: PetPack) {
        var news: [String] = []
        for item in pack.album ?? [] {
            // unlockAt 为 0 的条目一开始就是解锁的，不值得弹一次。
            guard let need = item.unlockAt, need > 0, state.affinity >= need else { continue }
            let key = "album:\(item.id)"
            guard !state.notified.contains(key) else { continue }
            state.notified.append(key)
            news.append("新照片 · \(item.place ?? "相册")")
        }
        for chapter in pack.chapters ?? [] {
            guard let need = chapter.unlockAt, need > 0, state.affinity >= need else { continue }
            let key = "chapter:\(chapter.id)"
            guard !state.notified.contains(key) else { continue }
            state.notified.append(key)
            news.append("已解锁 · \(chapter.title)")
        }
        persistState()
        if let first = news.first { showBubble(first, hold: 5) }
    }

    func clearHistory() {
        cancelReply()
        history.removeAll()
        persistHistory()
        showBubble("刚才说的都忘了。", hold: 4)
    }

    // MARK: 气泡

    /// 最近一次说过的话。自检用它确认「失败时确实告诉了用户」，而不是只看有没有报错。
    private(set) var lastBubbleText = ""
    /// 装素材时发现的问题，留到问候之后再说，免得被顶掉。
    private var assetWarning: String?

    func showBubble(_ text: String, hold: TimeInterval = 6) {
        lastBubbleText = text
        typingTimer?.invalidate()
        hideTimer?.invalidate()
        typed = ""
        full = text
        holdSeconds = hold
        content.showBubble(" ")
        // 逐字吐，比整段弹出更像在说话。长句按比例加速，别让人干等。
        let perChar = max(0.012, min(0.034, 0.9 / Double(max(text.count, 1))))
        typingTimer = Timer.scheduledTimer(withTimeInterval: perChar, repeats: true) { [weak self] timer in
            MainActor.assumeIsolated {
                guard let self else { timer.invalidate(); return }
                guard !self.full.isEmpty else { timer.invalidate(); return }
                self.typed.append(self.full.removeFirst())
                self.content.showBubble(self.typed)
                if self.full.isEmpty {
                    timer.invalidate()
                    self.scheduleHide()
                }
            }
        }
    }

    func hideBubble() {
        hideTimer?.invalidate()
        typingTimer?.invalidate()
        content.hideBubble()
    }

    private func scheduleHide() {
        hideTimer?.invalidate()
        hideTimer = Timer.scheduledTimer(withTimeInterval: holdSeconds, repeats: false) { [weak self] _ in
            MainActor.assumeIsolated { self?.content.hideBubble() }
        }
    }

    // MARK: 空闲调度

    private func scheduleNextIdle() {
        idleTimer?.invalidate()
        idleTimer = Timer.scheduledTimer(withTimeInterval: Double.random(in: 14...26), repeats: false) {
            [weak self] _ in
            MainActor.assumeIsolated {
                guard let self else { return }
                self.idleBeat()
                self.scheduleNextIdle()
            }
        }
    }

    private func idleBeat() {
        guard !busy, !content.isComposerVisible else { return }
        let idleSeconds = Date().timeIntervalSince(lastInteraction)
        let sleepAfter = identity?.sleepAfterSeconds ?? 300
        if idleSeconds > sleepAfter {
            if !asleep { enterSleep() }
            return
        }
        if !asleep, !quietMode, idleSeconds > (identity?.quietAfterSeconds ?? 60) {
            enterQuietMode()
        }
        if quietMode { return }
        guard !asleep else { return }
        guard Date().timeIntervalSince(lastActionAt) > 7 else { return }
        let actions = pack?.actionFiles ?? ["idle-02", "idle-03"].compactMap { clip($0) }
        guard let pick = actions.randomElement() else { return }
        if content.hasCharacter { content.playCharacterReaction(pick) }
        else { stage.playOnce(pick) }
        lastActionAt = Date()
        if Int.random(in: 0..<4) == 0 {
            showBubble((pack?.idles ?? PetLines.idleNudge()).randomElement() ?? "……", hold: 4)
        }
    }

    func wake() {
        content.exitSleepScene()
        asleep = false
        lastInteraction = Date()
        if identity?.character == nil {
            if let pack, !pack.ambientFiles.isEmpty { stage.loadAmbient(pack.ambientFiles) }
            else { stage.loadIdle(clip("idle-01")) }
        }
        content.setScenePaused(false)
        setStatus(companionStatus)
    }

    func enterQuietMode() {
        guard !busy, !asleep, !quietMode, let root = assetRoot,
              let file = identity?.quietCharacter else { return }
        let previous = content.characterPlacement
        if content.loadCharacter(root.appendingPathComponent(file)) {
            normalPlacement = previous
            quietMode = true
            let placement = (try? store?.load([String: Double].self, file: "quiet-placement.json", fallback: [:])) ?? [:]
            content.restorePlacement(placement.isEmpty ? ["x": 0.5, "y": 0.5, "height": 1.0] : placement)
            setStatus("安静陪你")
        } else {
            // 以前这里什么都不说：安静形象文件坏了就是「到点了但没变化」。
            showBubble("安静形象加载失败：\(file)", hold: 20)
        }
    }

    func enterSleep() {
        guard !busy, !asleep else { return }
        speech.stopSpeaking(at: .immediate); neuralSpeech.stop()
        hideBubble()
        content.hideComposer()
        if let root = assetRoot, let file = identity?.sleepScene {
            // 睡姿视频缺失/读不出时以前是直接 return：点了「让她休息」毫无反应。
            guard content.enterSleepScene(root.appendingPathComponent(file)) else {
                showBubble("睡姿素材缺失或无法播放：\(file)", hold: 20)
                return
            }
            content.setScenePaused(false)
        } else {
            if let pack, let sleep = pack.file(pack.sceneValue.sleep) {
                stage.loadAmbient([sleep], sleepEndAt: pack.sceneValue.sleepEndAt ?? 5.0)
            } else if let sleep = clip("sleep-01") { stage.loadIdle(sleep) }
            content.setScenePaused(true)
        }
        asleep = true
        setStatus("睡着了 · 点我唤醒")
    }

    func returnToNormalMode() {
        if asleep { wake() }
        guard quietMode, let root = assetRoot, let identity, let file = identity.character else { return }
        if content.loadCharacter(root.appendingPathComponent(file), alignReactions: identity.characterTransitionsAtLoopBoundary ?? false) {
            quietMode = false
            if let normalPlacement { content.restorePlacement(normalPlacement) }
            normalPlacement = nil
            lastInteraction = Date()
            setStatus(companionStatus)
        } else {
            // 回不到正常形象就留在安静模式，但要说清楚，别让人以为点了没反应。
            showBubble("正常形象加载失败，先保持安静形象：\(file)", hold: 20)
        }
    }

    func simulateInactivity(_ seconds: TimeInterval) {
        lastInteraction = Date().addingTimeInterval(-seconds)
        idleBeat()
    }

    // MARK: 语音

    /// Backend comes from character.json: "edgetts" | "kokoro" | "auto" | "system".
    /// Anything but "system" goes through the neural worker, which picks the best
    /// engine it can and reports which one won.
    private func speak(_ text: String) {
        // 说话优先于唱歌：两句声音叠在一起谁都听不清。
        if isSinging { stopSinging() }
        speech.stopSpeaking(at: .immediate); neuralSpeech.stop()
        let backend = identity?.resolvedBackend ?? "auto"
        guard backend != "system" else { return speakWithSystemVoice(text) }
        let engine = backend == "kokoro" ? "kokoro" : (backend == "qwen3" ? "qwen3" : "auto")
        let fallbackVoice: String
        switch backend {
        case "kokoro": fallbackVoice = "zf_xiaoxiao"
        case "qwen3": fallbackVoice = "Vivian"
        default: fallbackVoice = "zh-CN-XiaoxiaoNeural"
        }
        neuralSpeech.speak(
            text,
            engine: engine,
            voice: identity?.neuralVoice(for: backend) ?? fallbackVoice,
            speed: identity?.resolvedSpeed ?? 1.0,
            pitch: identity?.resolvedPitch ?? 1.0,
            instruct: identity?.neuralInstruct ?? "",
            gain: identity?.resolvedGain ?? 0.0
        ) { [weak self] in
            // Every neural engine failed. Fall back to the built-in voice:
            // having a voice at all matters more than which engine supplies it.
            self?.speakWithSystemVoice(text)
        }
    }

    private func speakWithSystemVoice(_ text: String) {
        let utterance = identity?.utterance(text) ?? AVSpeechUtterance(string: text)
        if identity == nil {
            utterance.voice = AVSpeechSynthesisVoice(language: "zh-CN")
            utterance.pitchMultiplier = 0.95
        }
        speech.speak(utterance)
    }

    private func toggleMute() {
        muted.toggle()
        content.setMuted(muted)
        if muted { speech.stopSpeaking(at: .immediate); neuralSpeech.stop() }
        showBubble(muted ? "我不出声了。" : "嗯，说吧。", hold: 3)
    }

    // MARK: 菜单

    private func chooseBackground() {
        let picker = NSOpenPanel()
        picker.title = "选择独立背景 · 图片或循环视频"
        picker.allowedContentTypes = [.png, .jpeg, .heic, .mpeg4Movie, .quickTimeMovie]
        picker.canChooseDirectories = false
        picker.allowsMultipleSelection = false
        forceActivate()
        picker.beginSheetModal(for: panel) { [weak self] response in
            guard let self, response == .OK, let url = picker.url else { return }
            if !self.content.loadBackground(url) { self.showBubble("背景无法读取，请选择 PNG、JPG、MP4 或 MOV。", hold: 12) }
        }
    }

    private func savePlacement() {
        guard content.hasCharacter else { return }
        try? store?.save(content.characterPlacement, file: quietMode ? "quiet-placement.json" : "deepsea-placement.json")
    }

    @objc private func menuCharacterBigger() { content.scaleCharacter(0.08); savePlacement() }
    @objc private func menuCharacterSmaller() { content.scaleCharacter(-0.08); savePlacement() }
    @objc private func menuSing(_ item: NSMenuItem) {
        guard let id = item.representedObject as? String,
              let song = (pack?.songs ?? []).first(where: { $0.id == id }) else { return }
        sing(song)
    }
    @objc private func menuStopSong() { stopSinging(reason: "好，不唱了。") }

    @objc private func menuBackground() { chooseBackground() }
    @objc private func menuResetBackground() {
        guard let identity, let root = assetRoot else { return }
        _ = content.loadBackground(root.appendingPathComponent(identity.background ?? identity.scene))
    }

    private func showTranscript() {
        let window = transcriptWindow ?? NSWindow(contentRect: NSRect(x: 0, y: 0, width: 520, height: 420),
            styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.title = "\(identity?.name ?? "桌面伙伴") · 对话记录"
        let scroll = NSScrollView(frame: NSRect(x: 0, y: 0, width: 520, height: 420))
        scroll.autoresizingMask = [.width, .height]; scroll.hasVerticalScroller = true
        let text = NSTextView(frame: scroll.bounds)
        text.isEditable = false; text.isSelectable = true; text.isVerticallyResizable = true
        text.autoresizingMask = [.width]; text.textContainer?.widthTracksTextView = true
        text.font = .systemFont(ofSize: 15); text.textContainerInset = NSSize(width: 18, height: 18)
        text.string = history.isEmpty ? "还没有完成的对话。点击「聊一会」开始。" : history.map {
            "\($0.role == "user" ? "你" : identity?.name ?? "伙伴")\n\($0.content)"
        }.joined(separator: "\n\n")
        scroll.documentView = text; window.contentView = scroll
        if transcriptWindow == nil { window.center() }
        transcriptWindow = window
        NSApp.activate(ignoringOtherApps: true); window.makeKeyAndOrderFront(nil)
    }

    private func showMenu(for event: NSEvent) {
        let menu = NSMenu()
        func add(_ title: String, _ action: Selector) {
            let item = NSMenuItem(title: title, action: action, keyEquivalent: "")
            item.target = self
            menu.addItem(item)
        }
        add("说句话…", #selector(menuCompose))
        add(voiceInput.phase == .listening ? "不听了" : "用嘴说…", #selector(menuMic))
        if wakeEnabled {
            add("关掉「一直听着」", #selector(menuWakeOff))
        } else {
            add("一直听着（耗电）…", #selector(menuWakeOn))
        }
        add(muted ? "打开声音" : "静音", #selector(menuMute))
        if asleep { add("叫她起来", #selector(menuWake)) }
        else if identity?.sleepScene != nil { add("让她休息", #selector(menuSleep)) }
        if identity?.quietCharacter != nil {
            add(quietMode ? "恢复平常姿态" : "趴着陪我", quietMode ? #selector(menuNormal) : #selector(menuQuiet))
        }
        menu.addItem(.separator())
        add("相册…", #selector(menuAlbum))
        add("剧情…", #selector(menuStory))
        if let pack, !(pack.songs ?? []).isEmpty {
            // 点歌：列出当前好感度能唱的，已解锁的才可点，未解锁的写明门槛。
            let submenu = NSMenu()
            if isSinging {
                let stop = NSMenuItem(title: "别唱了", action: #selector(menuStopSong), keyEquivalent: "")
                stop.target = self
                submenu.addItem(stop)
                submenu.addItem(.separator())
            }
            for song in pack.songs ?? [] {
                let locked = state.affinity < (song.unlockAt ?? 0)
                let title = locked ? "\(song.title)（好感 \(song.unlockAt ?? 0) 解锁）" : song.title
                let item = NSMenuItem(title: title, action: locked ? nil : #selector(menuSing(_:)), keyEquivalent: "")
                item.target = self
                item.representedObject = song.id
                submenu.addItem(item)
            }
            let entry = NSMenuItem(title: "唱一首", action: nil, keyEquivalent: "")
            entry.submenu = submenu
            menu.addItem(entry)
        }
        menu.addItem(.separator())
        add("大一点", #selector(menuBigger))
        add("小一点", #selector(menuSmaller))
        if content.hasCharacter {
            menu.addItem(.separator())
            add("更换背景图片 / 视频…", #selector(menuBackground))
            add("恢复默认背景", #selector(menuResetBackground))
            add("人物放大", #selector(menuCharacterBigger))
            add("人物缩小", #selector(menuCharacterSmaller))
        }
        menu.addItem(.separator())
        add("设置…", #selector(menuSettings))
        add("忘掉刚才的对话", #selector(menuForget))
        menu.addItem(.separator())
        add("隐藏桌宠", #selector(menuHide))
        NSMenu.popUpContextMenu(menu, with: event, for: content)
    }

    @objc private func menuCompose() { openComposer() }
    @objc private func menuMic() { toggleMic() }
    @objc private func menuWakeOn() { setWakeEnabled(true) }
    @objc private func menuWakeOff() { setWakeEnabled(false) }
    @objc private func menuMute() { toggleMute() }
    @objc private func menuWake() { wake() }
    @objc private func menuSleep() { enterSleep() }
    @objc private func menuQuiet() { enterQuietMode() }
    @objc private func menuNormal() { returnToNormalMode() }
    @objc private func menuForget() { clearHistory() }
    @objc private func menuHide() { hide() }
    @objc private func menuAlbum() { openAlbum() }
    @objc private func menuStory() { openStory() }
    @objc private func menuBigger() { resize(80) }
    @objc private func menuSmaller() { resize(-80) }
    @objc private func menuSettings() {
        PetSettingsWindow.shared.present(store: store)
    }

    // MARK: 相册与剧情

    /// 自检用：直接播第一个有内容的章节，跳过点列表这一步。
    func playFirstChapterForTest() { storyWindow?.playFirst() }

    func openAlbum() {
        guard let pack else {
            showBubble("这套素材没有内容包（pack.json），相册用不了。", hold: 12)
            return
        }
        let window = albumWindow ?? PetAlbumWindow()
        albumWindow = window
        window.present(pack: pack, affinity: state.affinity)
    }

    func openStory() {
        guard let pack else {
            showBubble("这套素材没有内容包（pack.json），剧情用不了。", hold: 12)
            return
        }
        let window = storyWindow ?? PetStoryWindow()
        storyWindow = window
        window.present(pack: pack, state: state) { [weak self] chapter, finished in
            guard let self, finished else { return }
            let firstTime = !self.state.finished(chapter.id)
            self.state.markChapter(chapter.id)
            self.persistState()
            if firstTime { self.addAffinity(chapter.reward ?? pack.chapterReward) }
        }
    }

    // MARK: 自检（--selftest 用）
    //
    // 屏幕截图要走系统录屏权限，很多机器上直接不可用。
    // 桌宠的所有关键状态其实都在内存里，直接 dump 比截图更准。

    var diagnostics: [String: Any] {
        let idleDuration = stage.idlePlayer.currentItem?.duration.seconds ?? 0
        var info: [String: Any] = [:]
        info["window.visible"] = panel.isVisible
        info["window.frame"] = "\(Int(panel.frame.minX)),\(Int(panel.frame.minY)) \(Int(panel.frame.width))x\(Int(panel.frame.height))"
        info["window.level"] = Double(panel.level.rawValue)
        info["window.key"] = panel.isKeyWindow
        info["window.canKey"] = panel.canBecomeKey
        info["app.active"] = NSApp.isActive
        info["app.policy"] = NSApp.activationPolicy().rawValue
        info["idle.hasItem"] = stage.idlePlayer.currentItem != nil
        info["idle.rate"] = Double(stage.idlePlayer.rate)
        info["idle.status"] = stage.idleStatus
        info["idle.duration"] = idleDuration.isFinite ? idleDuration : 0
        info["action.opacity"] = Double(stage.actionOpacity)
        info["action.rate"] = Double(stage.actionPlayer.rate)
        info["bubble.visible"] = content.isBubbleVisible
        info["tap.count"] = tapCount
        info["bubble.text"] = content.currentBubbleText
        info["composer"] = content.isComposerVisible
        info["busy"] = busy
        info["asleep"] = asleep
        info["quiet"] = quietMode
        info["sleep.scene"] = content.sleepSceneActive
        info["sleep.rate"] = Double(content.sleepSceneRate)
        info["scene.loaded"] = content.hasScene
        info["scene.paused"] = content.scenePaused
        info["character.loaded"] = content.hasCharacter
        info["character.video"] = content.characterIsVideo
        info["character.reaction"] = content.reactionPlaying
        info["character.reactionRate"] = Double(content.reactionRate)
        info["character.reactionPending"] = content.reactionPending
        info["character.reactionWait"] = content.reactionWait
        info["character.rate"] = Double(content.characterRate)
        info["character.time"] = content.characterTime.isFinite ? content.characterTime : 0
        info["character.frame"] = NSStringFromRect(content.characterFrame)
        info["background.video"] = content.backgroundIsVideo
        info["background.rate"] = Double(content.backgroundRate)
        info["reply.generation"] = replyGeneration
        info["history"] = history.count
        info["assets"] = assetRoot?.path ?? "none"
        info["pack.available"] = pack != nil
        info["pack.name"] = pack?.displayName ?? "none"
        info["pack.ambient"] = pack?.ambientFiles.count ?? 0
        info["pack.actions"] = pack?.actionFiles.count ?? 0
        info["pack.clips"] = pack?.clips?.count ?? 0
        info["pack.chapters"] = pack?.chapters?.count ?? 0
        info["pack.album"] = pack?.album?.count ?? 0
        info["affinity"] = state.affinity
        info["affinity.address"] = pack?.address(for: state.affinity) ?? ""
        info["idle.swaps"] = stage.swaps
        info["idle.frozen"] = stage.isFrozen
        info["idle.minCoverage"] = stage.minCoverage
        // 素材健康度：ok / degraded / empty。degraded 时 idle.error 会有原因，
        // 这样「画面不动」能区分成「素材坏了」和「播放器卡了」。
        info["idle.health"] = stage.healthName
        info["idle.error"] = stage.lastErrorMessage
        info["idle.recoveries"] = stage.recoveries
        info["bubble.last"] = lastBubbleText
        // 唱歌：playing/title/line 三个一起看才分得清「没播」和「播了但没歌词」。
        info["song.count"] = pack?.songs?.count ?? 0
        info["song.playing"] = songPlayer.isPlaying
        info["song.title"] = currentSong?.title ?? ""
        info["song.position"] = songPlayer.position.isFinite ? songPlayer.position : 0
        info["song.duration"] = songPlayer.duration.isFinite ? songPlayer.duration : 0
        info["song.line"] = songPlayer.lineIndex
        info["song.lineText"] = content.lyricText
        info["song.error"] = songPlayer.lastError ?? ""
        info["song.heard"] = state.heardSongs.count
        info["windows"] = NSApp.windows.filter(\.isVisible).map(\.title)
        // 只记可见窗口会掩盖「窗口被 orderOut 掉了」和「窗口压根没建」的区别，
        // 排查面板问题时把全部窗口连同可见位一起写出来。
        info["windows.all"] = NSApp.windows.map { "\($0.title):\($0.isVisible ? "on" : "off"):\($0.occlusionState.contains(.visible) ? "occ" : "-")" }
        info["story.playing"] = storyWindow?.isPlaying ?? false
        info["story.caption"] = storyWindow?.playerCaption ?? ""
        info["story.choice"] = storyWindow?.choiceVisible ?? false
        info["idle.opacities"] = stage.ambientOpacities.map { $0.isFinite ? $0 : 0 }
        let backend = identity?.resolvedBackend ?? "auto"
        info["speech.backend"] = backend
        info["speech.voice"] = identity?.neuralVoice(for: backend) ?? "none"
        // Which engine actually produced the last line — 'auto' can fall back,
        // so the configured backend and the used one are not always the same.
        info["speech.engine"] = neuralSpeech.lastEngine ?? "none"
        // `engine == none` is ambiguous on its own: it means either "nothing
        // was ever spoken" or "the worker is still loading". Cold start is
        // ~15s, so a selftest snapshot taken at 10s would always read "none"
        // and look like a failure. This flag disambiguates it.
        info["speech.pending"] = neuralSpeech.isSynthesising
        info["speech.playing"] = neuralSpeech.isPlaying
        info["speech.gain"] = identity?.resolvedGain ?? 0.0
        info["speech.instruct"] = identity?.neuralInstruct ?? ""
        // 收口后这两个应该在项目自己的 .runtime 里。还在 ../LiveTalking 说明
        // 要么没跑 setup-runtime.sh，要么换机器时漏搬了运行时。
        info["speech.python"] = neuralSpeech.lastPythonPath ?? ""
        info["speech.model"] = neuralSpeech.lastModelPath ?? ""
        // Mic side. 'usable' answers "could this machine listen at all",
        // separate from whether anything is listening right now.
        info["voice.phase"] = voiceInput.phase.rawValue
        info["voice.usable"] = voiceInput.unavailabilityReason() == nil
        info["voice.reason"] = voiceInput.unavailabilityReason() ?? ""
        info["voice.level"] = voiceInput.level.isFinite ? voiceInput.level : 0
        info["voice.followUp"] = awaitingFollowUp
        info["voice.wake"] = wakeEnabled
        info["voice.words"] = wakeWords
        return info
    }

    func simulateTap() { handleTap() }
    func simulateSend(_ text: String) { send(text) }
    /// 往动作层塞一个一定不存在的文件：验证它不会被提起来、也不会把待机画面压掉。
    func probeMissingAction() {
        stage.playOnce(URL(fileURLWithPath: "/tmp/lingdesk-probe-\(UUID().uuidString).mp4"))
    }
    /// 自检用：把待机切到给定素材，用来验证坏文件不会把画面切成黑的。
    func probeAmbientSwitch(to urls: [URL]) {
        stage.loadAmbient(urls)
    }
    func simulateOpenComposer() { openComposer() }
    /// Ask for mic permission and listen for `seconds`, printing whatever was
    /// understood. Lets the whole ASR path be tested without a chat round-trip.
    func listenForTest(seconds: TimeInterval = 8, wake: Bool = false, outPath: String? = nil) {
        // Write to a file as well as stdout: launched via `open --args` there
        // is no terminal attached, and stdout goes nowhere.
        func emit(_ line: String) {
            print(line)
            guard let outPath, let data = (line + "\n").data(using: .utf8) else { return }
            let url = URL(fileURLWithPath: outPath)
            if let handle = try? FileHandle(forWritingTo: url) {
                handle.seekToEndOfFile(); handle.write(data); try? handle.close()
            } else {
                try? data.write(to: url)
            }
        }
        emit("[listen] entered seconds=\(seconds) wake=\(wake) out=\(outPath ?? "-")")
        Task { [weak self] in
            guard let self else { return }
            emit("[listen] auth status = \(SFSpeechRecognizer.authorizationStatus().rawValue)")
            if wake {
                self.setWakeEnabled(true)
                emit("[listen] wake mode armed")
                return
            }
            if SFSpeechRecognizer.authorizationStatus() != .authorized {
                guard await self.voiceInput.requestPermission() else {
                    emit("{\"listen\": {\"ok\": false, \"error\": \"permission denied\"}}")
                    return
                }
                emit("[listen] permission granted")
            }
            self.voiceInput.maxDuration = seconds
            self.voiceInput.onTranscript = { text in emit("[listen] partial: \(text)") }
            self.voiceInput.onFinal = { text in
                emit("{\"listen\": {\"ok\": true, \"text\": \(Self.jsonString(text))}}")
            }
            self.voiceInput.onFailure = { message in
                emit("{\"listen\": {\"ok\": false, \"error\": \(Self.jsonString(message))}}")
            }
            guard self.voiceInput.start(mode: .dictation) else {
                emit("{\"listen\": {\"ok\": false, \"error\": \"start failed\"}}")
                return
            }
            let info = self.diagnostics
            emit("[listen] phase=\(info["voice.phase"] ?? "?") usable=\(info["voice.usable"] ?? "?") reason=\(info["voice.reason"] ?? "")")
        }
    }

    private static func jsonString(_ value: String) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: [value]),
              let text = String(data: data, encoding: .utf8) else { return "\"\"" }
        return text.dropFirst().dropLast().description
    }
    /// Speak one line without a chat round-trip, so TTS can be checked on its own.
    func simulateSpeak(_ text: String) { speak(text) }
    /// Preload the TTS worker so the first reply does not wait on a 2.4 GB load.
    func warmSpeech() { neuralSpeech.warmUp() }

    // MARK: 尺寸与位置

    private func resize(_ delta: CGFloat) {
        let current = panel.frame
        let width = min(max(current.width + delta, 260), 900)
        let height = width * 9 / 16
        var frame = NSRect(x: current.origin.x, y: current.maxY - height, width: width, height: height)
        if let screen = panel.screen ?? NSScreen.main {
            let area = screen.visibleFrame
            frame.origin.x = min(max(frame.origin.x, area.minX), area.maxX - width)
            frame.origin.y = min(max(frame.origin.y, area.minY), area.maxY - height)
        }
        panel.setFrame(frame, display: true, animate: true)
        content.frame = NSRect(origin: .zero, size: frame.size)
        content.layoutSubtreeIfNeeded()
        saveOrigin()
    }

    private var originFile: URL? { store?.root.appendingPathComponent(identity == nil ? "pet-window.json" : "deepsea-window.json") }

    private func saveOrigin() {
        guard let url = originFile else { return }
        let payload: [String: Double] = ["x": Double(panel.frame.origin.x),
                                         "y": Double(panel.frame.origin.y),
                                         "w": Double(panel.frame.width)]
        if let data = try? JSONSerialization.data(withJSONObject: payload) {
            try? data.write(to: url)
        }
    }

    private func restoredOrigin() -> NSPoint? {
        guard let url = originFile,
              let data = try? Data(contentsOf: url),
              let dict = try? JSONSerialization.jsonObject(with: data) as? [String: Double],
              let x = dict["x"], let y = dict["y"] else { return nil }
        // 换过显示器/分辨率后旧坐标可能落在屏幕外，落到外面就回默认位置。
        let rect = NSRect(x: x, y: y, width: panelSize.width, height: panelSize.height)
        guard NSScreen.screens.contains(where: { $0.visibleFrame.intersects(rect) }) else { return nil }
        return NSPoint(x: x, y: y)
    }

    private func defaultOrigin() -> NSPoint {
        guard let screen = NSScreen.main else { return NSPoint(x: 200, y: 200) }
        let area = screen.visibleFrame
        return NSPoint(x: area.maxX - panelSize.width - 32, y: area.minY + 32)
    }
}

// MARK: - 本地台词

enum PetLines {
    static func touched() -> [String] {
        ["……有事？",
         "别碰，书签会掉。",
         "嗯。",
         "你手怎么这么凉。",
         "这一页还没看完。",
         "再摸就收费了。"]
    }

    static func greeting() -> [String] {
        let hour = Calendar.current.component(.hour, from: Date())
        switch hour {
        case 5..<9:   return ["这么早就醒了。", "窗外的光有点吵。"]
        case 9..<12:  return ["上午好。书还没翻完。", "坐吧，别站着。"]
        case 12..<18: return ["下午了，你才想起我。", "壁炉的火还凑合。"]
        case 18..<23: return ["天黑了。", "一天又过去了，你干了什么？"]
        default:      return ["这个点还不睡？", "灯快灭了。"]
        }
    }

    static func idleNudge() -> [String] {
        ["……", "你安静得有点过分。", "我在。", "翻页声比说话好听。"]
    }
}
