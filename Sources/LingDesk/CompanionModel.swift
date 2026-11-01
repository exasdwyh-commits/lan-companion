import AppKit
import AVFoundation
import CompanionCore
import SwiftUI
import UniformTypeIdentifiers

@MainActor
final class CompanionModel: NSObject, ObservableObject, AVSpeechSynthesizerDelegate {
    @Published var settings = Settings()
    @Published var messages: [ChatMessage] = []
    @Published var input = ""
    @Published var status = "先导入你的角色，也可以先连接本地模型聊天。"
    @Published var error: String?
    @Published var busy = false
    @Published var importing = false
    @Published var paused = false
    @Published var desktopEnabled = false
    @Published var showingSettings = false
    @Published var connectionStatus = "尚未检测本地模型"
    @Published var checkingConnection = false
    @Published var lastJob: URL?
    @Published var replyPlaying = false
    @Published var engineStatus = "口型引擎未连接"
    @Published var renderingID: UUID?
    let scene = SceneController()
    let engine = EngineBridge()
    let store: LocalStore?
    private let client = LocalModelClient()
    private let speech = AVSpeechSynthesizer()
    private var utterance: AVSpeechUtterance?
    private var replyTask: Task<Void, Never>?
    private var gate = ReplyGate()
    private var storageReady = false
    /// 引擎还在启动时收到的生成请求，等 ready 后补发，避免用户白等一条。
    private var queuedRender: ChatMessage?
    var lastReply: ChatMessage? { messages.last(where: { $0.role == "assistant" }) }
    var hasScene: Bool { asset(.idle) != nil || asset(.portrait) != nil }

    override init() {
        var initializationError: String?
        do { store = try LocalStore() } catch { store = nil; initializationError = error.localizedDescription }
        super.init()
        speech.delegate = self
        if let store {
            do {
                settings = try store.load(Settings.self, file: "settings.json", fallback: Settings())
                messages = try store.load([ChatMessage].self, file: "history.json", fallback: [])
                storageReady = true
            } catch { initializationError = "本地数据读取失败，已停止写入以保护原文件：\(error.localizedDescription)" }
        }
        if NSWorkspace.shared.accessibilityDisplayShouldReduceMotion { settings.staticScene = true }
        error = initializationError
        scene.onFinish = { [weak self] in
            guard let self else { return }
            self.replyPlaying = false; self.status = "我在这里。"; self.showIdle()
        }
        scene.onError = { [weak self] message in
            self?.error = message; self?.replyPlaying = false; self?.scene.setPaused(true)
        }
        engine.onReadiness = { [weak self] readiness in
            guard let self else { return }
            self.engineStatus = readiness.label
            if case .failed(let reason) = readiness {
                self.queuedRender = nil
                self.renderingID = nil
                self.error = "口型连接失败：\(reason)。可重连引擎或使用系统语音朗读。"
                self.status = "文字回复已保留 · 口型连接失败"
                self.showIdle()
            }
            if case .ready = readiness, let queued = self.queuedRender {
                self.queuedRender = nil
                self.renderReply(queued)
            }
        }
        engine.onNotice = { [weak self] text in
            // 提示发生在引擎就绪前，随后 ready 会覆盖 engineStatus，
            // 所以同时写进 status，用户还来得及看见。
            self?.engineStatus = text
            self?.status = text
        }
        engine.onEvent = { [weak self] event in
            guard let self else { return }
            switch event.event {
            case "accepted":
                guard event.id == self.renderingID?.uuidString else { return }
                self.status = "引擎正在生成口型…"
            case "speaking":
                guard event.id == self.renderingID?.uuidString else { return }
                self.status = "正在准备声音与画面…"
            case "done":
                self.finishRender(event)
            case "error":
                guard let id = event.id, UUID(uuidString: id) == self.renderingID else { return }
                self.renderingID = nil
                self.status = "回复已到 · 口型生成失败"
                self.error = "口型生成失败：\(event.message ?? "引擎没有说明原因")。文字已保留，可选择系统语音朗读。"
            default:
                break
            }
        }
        showIdle()
    }

    func asset(_ slot: AssetSlot) -> URL? { store?.asset(slot, packID: settings.packID) }

    func persist() {
        guard storageReady, let store else { return }
        do {
            try store.save(settings, file: "settings.json")
            try store.save(Array(messages.suffix(300)), file: "history.json")
        } catch { self.error = "保存失败：\(error.localizedDescription)" }
    }

    func saveSettings() {
        do { _ = try settings.endpoint("models") }
        catch { self.error = error.localizedDescription; return }
        persist(); showIdle(); showingSettings = false
    }

    func checkConnection() {
        guard !checkingConnection else { return }
        checkingConnection = true; connectionStatus = "正在检查本地服务…"
        let snapshot = settings
        Task {
            defer { checkingConnection = false }
            do {
                let models = try await client.models(settings: snapshot)
                connectionStatus = models.contains(snapshot.model)
                    ? "服务已连接，模型可用：\(snapshot.model)"
                    : "服务已连接；未找到所填模型。可用：\(models.joined(separator: ", "))"
            } catch { connectionStatus = "未连接：\(error.localizedDescription)" }
        }
    }

    func send() {
        let text = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !paused else { return }
        guard text.count <= 4000 else { error = "单条消息请控制在 4000 字以内。"; return }
        do { _ = try settings.endpoint("chat/completions") }
        catch { self.error = error.localizedDescription; return }
        cancel(silent: true)
        let id = gate.begin()
        input = ""; error = nil; busy = true; status = "想一想…"
        messages.append(ChatMessage(role: "user", content: text)); persist()
        let snapshot = settings
        let history = messages
        scene.load(asset(.think) ?? asset(.idle), paused: settings.staticScene)
        replyTask = Task {
            do {
                let text = try await client.reply(settings: snapshot, history: history)
                guard gate.accepts(id), !Task.isCancelled else { return }
                let reply = ChatMessage(role: "assistant", content: text, id: id)
                messages.append(reply)
                busy = false; persist(); showIdle()
                if settings.useEngine {
                    status = "回复已到 · 正在准备口型"
                    renderReply(reply)
                } else {
                    status = "回复已到 · 画面未对口型"
                    if settings.speakReplies { speak(text) }
                }
            } catch {
                guard gate.accepts(id), !Task.isCancelled else { return }
                busy = false; self.error = "回复失败：\(error.localizedDescription)"
                status = "文字已保留，可以重试。"; showIdle()
            }
        }
    }

    func retry() {
        guard let message = messages.last, message.role == "user", !busy, !paused else { return }
        input = message.content
        messages.removeLast()
        send()
    }

    func cancel(silent: Bool = false) {
        gate.cancel(); replyTask?.cancel(); replyTask = nil
        // 正在生成的这条要通知引擎打断，否则它会把整段话说完才停。
        if let id = renderingID {
            engine.cancel(id: id.uuidString); renderingID = nil
        }
        queuedRender = nil
        busy = false; replyPlaying = false
        utterance = nil; speech.stopSpeaking(at: .immediate)
        showIdle()
        if !silent { status = "已停止，文字保留在对话中。" }
    }

    func togglePause() {
        cancel(silent: true); paused.toggle(); showIdle()
        status = paused ? "已暂停陪伴" : "我在这里。"
    }

    func toggleDesktop() {
        guard hasScene else { error = "请先导入角色主图或待机视频。"; return }
        desktopEnabled.toggle()
        if desktopEnabled { scene.showDesktop(model: self) } else { scene.hideDesktop() }
    }

    func showIdle() { scene.load(asset(.idle), paused: paused || settings.staticScene) }

    func speak(_ text: String) {
        utterance = nil; speech.stopSpeaking(at: .immediate)
        let next = AVSpeechUtterance(string: text)
        next.voice = AVSpeechSynthesisVoice(language: "zh-CN")
        next.rate = AVSpeechUtteranceDefaultSpeechRate
        utterance = next
        speech.speak(next)
        status = "系统语音朗读 · 画面未对口型"
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        Task { @MainActor in
            guard self.utterance === utterance else { return }
            self.utterance = nil
            self.status = "我在这里 · 画面未对口型"
        }
    }

    func importAssets() {
        guard !importing else { return }
        let panel = NSOpenPanel()
        panel.title = "选择 Muse 素材文件夹"
        panel.canChooseDirectories = true; panel.canChooseFiles = false
        guard panel.runModal() == .OK, let folder = panel.url, let store else { return }
        importing = true; error = nil
        Task {
            defer { importing = false }
            do {
                for slot in AssetSlot.allCases {
                    let url = folder.appendingPathComponent(slot.rawValue)
                    guard FileManager.default.fileExists(atPath: url.path) else { continue }
                    if slot == .portrait {
                        guard NSImage(contentsOf: url) != nil else { throw CompanionError("主形象 PNG 无法读取。") }
                    } else { try await validateVideo(url) }
                }
                let id = try store.importPack(from: folder)
                cancel(silent: true)
                settings.packID = id
                if let avatar = try store.engineAvatar(packID: id) {
                    settings.engineAvatar = avatar
                    engine.stop()
                    if settings.useEngine { ensureEngine() }
                    status = "素材已导入，并绑定对应的说话形象。"
                } else {
                    settings.useEngine = false
                    engine.stop()
                    status = "素材已导入。尚未绑定说话形象，暂用系统语音；可在设置中指定引擎角色后开启口型。"
                }
                persist(); showIdle()
            } catch { self.error = "导入失败：\(error.localizedDescription)" }
        }
    }

    private func validateVideo(_ url: URL, needsAudio: Bool = false) async throws {
        let asset = AVURLAsset(url: url)
        let playable = try await asset.load(.isPlayable)
        let tracks = try await asset.loadTracks(withMediaType: .video)
        let duration = try await asset.load(.duration).seconds
        guard playable, !tracks.isEmpty, duration.isFinite, duration > 0, duration <= 600 else {
            throw CompanionError("\(url.lastPathComponent) 需要是可播放、有画面且不超过 10 分钟的视频。")
        }
        if needsAudio, try await asset.loadTracks(withMediaType: .audio).isEmpty {
            throw CompanionError("回复视频没有音轨，不能作为音画同步结果播放。")
        }
    }

    // MARK: - 口型生成

    /// 启动引擎（幂等）。路径优先用设置里填的，否则按仓库目录结构推断。
    @discardableResult
    func ensureEngine() -> Bool {
        guard settings.useEngine else {
            engineStatus = "口型引擎已关闭"
            return false
        }
        do { try EnginePaths.validateBaseURL(settings.engineBaseURL ?? "http://127.0.0.1:8010") }
        catch { self.error = error.localizedDescription; return false }
        guard let paths = EnginePaths.locate(explicitPython: settings.enginePython,
                                             explicitScript: settings.engineScript,
                                             baseURL: settings.engineBaseURL ?? "http://127.0.0.1:8010") else {
            engineStatus = "找不到引擎"
            error = "没找到 LiveTalking 的解释器或桥脚本。请在设置里填写 engine_bridge.py 与 .venv/bin/python 的路径。"
            return false
        }

        // 引擎没在跑不用管：桥会自己把它拉起来，拉好才报 ready。
        // 这里只负责在等待期间给界面一句准确的话。
        if let probe = EngineLauncher(baseURL: paths.baseURL), !probe.isListening {
            engineStatus = "正在启动口型引擎，约需 20 秒…"
        }
        engine.start(paths: paths, avatar: settings.engineAvatar,
                     tts: settings.engineTTS, voice: settings.engineVoice)
        return true
    }

    /// 把一条回复交给引擎出片，完成后自动播放。
    func renderReply(_ reply: ChatMessage) {
        guard !paused, let store else { return }
        guard reply.role == "assistant" else { return }
        guard ensureEngine() else { return }

        guard engine.readiness.isReady else {
            // 引擎冷启动要加载模型，先把请求挂起来，就绪后自动补发。
            queuedRender = reply
            status = "正在连接口型引擎，就绪后自动生成…"
            return
        }

        do {
            let target = try store.replyTarget(id: reply.id)
            cancel(silent: true)
            renderingID = reply.id
            status = "引擎正在生成口型…等待期间可以先看文字"
            scene.load(asset(.think) ?? asset(.idle), paused: settings.staticScene)
            engine.render(id: reply.id.uuidString, text: reply.content, out: target.path)
        } catch {
            renderingID = nil
            self.error = "无法创建回复视频目录：\(error.localizedDescription)"
        }
    }

    private func finishRender(_ event: EngineEvent) {
        guard let idText = event.id, let id = UUID(uuidString: idText), id == renderingID else { return }
        guard let path = event.video, FileManager.default.fileExists(atPath: path) else {
            renderingID = nil
            status = "回复已到 · 引擎没有返回视频"
            error = "引擎报告完成，但目标文件不存在：\(event.video ?? "路径为空")"
            return
        }
        let target = URL(fileURLWithPath: path)
        Task {
            do {
                try await validateVideo(target, needsAudio: true)
                guard self.renderingID == id, !self.paused else { return }
                self.renderingID = nil
                self.replyPlaying = true
                let seconds = event.seconds.map { String(format: "%.1f 秒", $0) } ?? "时长未知"
                self.status = "播放生成回复 · \(seconds)" + (event.stub == true ? " · 桩数据" : "")
                self.scene.load(target, loop: false, paused: false)
            } catch {
                guard self.renderingID == id else { return }
                self.renderingID = nil
                self.error = "回复视频校验失败：\(error.localizedDescription)"
                self.showIdle()
            }
        }
    }

    func openData() { if let store { NSWorkspace.shared.open(store.root) } }

    /// 退出时收尾。只关自己拉起来的引擎，用户手动起的留着。
    func shutdown() {
        cancel(silent: true)
        engine.stop()
    }

    func clearHistory() {
        let alert = NSAlert()
        alert.messageText = "开始新对话？"
        alert.informativeText = "当前对话会先备份到本地文件，再清空聊天。角色和视频素材不变。"
        alert.addButton(withTitle: "备份并清空"); alert.addButton(withTitle: "取消")
        guard alert.runModal() == .alertFirstButtonReturn, let store, storageReady else { return }
        do {
            try store.save(messages, file: "history-backup-\(UUID().uuidString).json")
            cancel(silent: true); messages = []; persist(); status = "新对话已开始。"
        } catch { self.error = error.localizedDescription }
    }
}
