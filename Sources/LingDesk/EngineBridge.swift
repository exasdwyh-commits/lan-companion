import CompanionCore
import Darwin
import Foundation

/// 管理 `engine_bridge.py` 子进程。
///
/// 桌面端不自己实现 WebRTC：引擎的会话只能靠信令建立，让 Swift 去做代价太大。
/// 这里只负责「起进程 → 送命令 → 收事件」，画质与帧率全部由引擎决定。
@MainActor
final class EngineBridge {
    enum Readiness: Equatable {
        case stopped
        case starting
        case ready(model: String)
        case failed(String)

        var label: String {
            switch self {
            case .stopped: return "未连接引擎"
            case .starting: return "正在连接引擎…"
            case .ready(let model): return "引擎就绪 · \(model)"
            case .failed(let reason): return "引擎不可用 · \(reason)"
            }
        }

        var isReady: Bool { if case .ready = self { return true }; return false }
    }

    private(set) var readiness: Readiness = .stopped
    private var process: Process?
    private var input: FileHandle?
    private var buffer = Data()
    private var wanted = false
    private var configuration: [String]?
    private var generation = UUID()
    private var stopping: Task<Void, Never>?
    private var outputHandles: [FileHandle] = []

    /// 每次状态变化回调，供界面刷新；同时把事件原样转给上层。
    var onReadiness: ((Readiness) -> Void)?
    var onEvent: ((EngineEvent) -> Void)?
    /// 桥的提示信息（例如断网后自动改用系统语音）。不影响就绪状态，只提示用户。
    var onNotice: ((String) -> Void)?

    /// 幂等启动：已经起来或正在起就不重复起，避免两个进程抢同一个引擎会话。
    /// 形象、TTS、音色都由桥转给引擎——引擎没在跑时也是桥负责拉起，参数只能从这里进。
    func start(paths: EnginePaths, avatar: String, tts: String, voice: String) {
        let arguments = ["-u", paths.script, "--base-url", paths.baseURL,
                         "--avatar", avatar, "--tts", tts, "--voice", voice]
        let next = [paths.python] + arguments
        if configuration == next, wanted, readiness != .stopped {
            if case .failed = readiness { /* Retry a broken connection. */ }
            else { return }
        }
        stop()
        wanted = true
        configuration = next
        let token = generation
        set(.starting)
        let barrier = stopping
        Task { [weak self] in
            await barrier?.value
            guard let self, self.generation == token, self.wanted else { return }
            self.launch(python: paths.python, arguments: arguments, token: token)
        }
    }

    private func launch(python: String, arguments: [String], token: UUID) {
        let task = Process()
        task.executableURL = URL(fileURLWithPath: python)
        task.arguments = arguments
        let stdout = Pipe()
        let stderr = Pipe()
        let stdin = Pipe()
        task.standardOutput = stdout
        task.standardError = stderr
        task.standardInput = stdin
        task.terminationHandler = { [weak self] finished in
            Task { @MainActor in
                guard let self, self.generation == token, self.process === finished else { return }
                let reason = finished.terminationStatus == 0
                    ? "桥进程已退出"
                    : "桥进程异常退出（code \(finished.terminationStatus)）"
                self.cleanup()
                if self.wanted { self.set(.failed(reason)) }
            }
        }

        stdout.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let chunk = handle.availableData
            guard !chunk.isEmpty else { return }
            Task { @MainActor in
                guard let self, self.generation == token else { return }
                self.consume(chunk)
            }
        }
        // stderr 只写日志文件，不进界面：里面是引擎与模型的调试输出。
        stderr.fileHandleForReading.readabilityHandler = { handle in
            let chunk = handle.availableData
            guard !chunk.isEmpty, let text = String(data: chunk, encoding: .utf8) else { return }
            FileHandle.standardError.write(text.data(using: .utf8) ?? Data())
        }

        outputHandles = [stdout.fileHandleForReading, stderr.fileHandleForReading]
        do {
            try task.run()
            process = task
            input = stdin.fileHandleForWriting
        } catch {
            cleanup()
            set(.failed(error.localizedDescription))
        }
    }

    func stop() {
        wanted = false
        configuration = nil
        generation = UUID()
        let old = process
        send(EngineCommand(op: "quit"))
        cleanup()
        let prior = stopping
        // 等旧桥收完录制、会话和自启引擎，再启动新桥，避免旧退出回调清掉新连接。
        stopping = Task {
            await prior?.value
            guard let old else { return }
            for _ in 0..<500 {
                if !old.isRunning { return }
                try? await Task.sleep(nanoseconds: 20_000_000)
            }
            if old.isRunning { old.terminate() }
            for _ in 0..<250 {
                if !old.isRunning { return }
                try? await Task.sleep(nanoseconds: 20_000_000)
            }
            if old.isRunning { kill(old.processIdentifier, SIGKILL) }
            while old.isRunning { try? await Task.sleep(nanoseconds: 20_000_000) }
        }
        set(.stopped)
    }

    func render(id: String, text: String, out: String) {
        send(EngineCommand(op: "render", id: id, text: text, out: out))
    }

    func cancel(id: String) {
        send(EngineCommand(op: "cancel", id: id))
    }

    // MARK: - 内部

    private func send(_ command: EngineCommand) {
        guard let input, let line = try? command.line() else { return }
        do { try input.write(contentsOf: line) }
        catch { set(.failed("无法把任务送给引擎：\(error.localizedDescription)")) }
    }

    /// 按行切分：一次读取可能拿到半行，也可能一次拿到多条事件。
    private func consume(_ chunk: Data) {
        buffer.append(chunk)
        while let newline = buffer.firstIndex(of: 0x0A) {
            let lineData = buffer[buffer.startIndex..<newline]
            buffer.removeSubrange(buffer.startIndex...newline)
            guard let line = String(data: lineData, encoding: .utf8)?
                .trimmingCharacters(in: .whitespacesAndNewlines), !line.isEmpty else { continue }
            guard let event = EngineEvent.decode(line) else { continue }
            if event.event == "ready" {
                set(.ready(model: event.model ?? "未知模型"))
            } else if event.event == "error", event.id == nil {
                // 起不来这类错误没有任务 id，属于连接级故障。
                set(.failed(event.message ?? "桥报告了未知错误"))
            } else if event.event == "notice", let text = event.message {
                onNotice?(text)
            }
            onEvent?(event)
        }
    }

    private func cleanup() {
        try? input?.close()
        input = nil
        for handle in outputHandles { handle.readabilityHandler = nil }
        outputHandles = []
        process = nil
        buffer.removeAll()
    }

    private func set(_ next: Readiness) {
        guard next != readiness else { return }
        readiness = next
        onReadiness?(next)
    }
}
