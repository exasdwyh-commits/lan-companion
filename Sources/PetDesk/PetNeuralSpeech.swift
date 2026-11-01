import Foundation
import AVFoundation

/// One persistent worker keeps model weights warm; cancellation discards stale audio.
///
/// The worker owns engine choice (edge-tts → Kokoro fallback) and loudness, so a
/// failing backend never leaves the pet silent as long as *some* engine works.
@MainActor final class PetNeuralSpeech: NSObject, AVAudioPlayerDelegate {
    private var process: Process?
    private var input: FileHandle?
    private var outputPipe: Pipe?
    private var buffer = Data()
    private var pending: String?
    private var onError: (() -> Void)?
    private var player: AVAudioPlayer?
    var isPlaying: Bool { player?.isPlaying == true }
    /// True while a line is queued but the worker hasn't answered yet.
    ///
    /// Without this, diagnostics show `engine = none` both when speech never
    /// started *and* when it is still loading the model — and the second case
    /// looks exactly like a bug. Cold start is ~15s, so this is not rare.
    var isSynthesising: Bool { pending != nil }
    /// Engine that actually produced the last utterance, for diagnostics.
    private(set) var lastEngine: String?
    /// 实际用的解释器和权重目录。`engine` 只说「哪一层出声」，说不出「用的是谁家的
    /// Python 和哪份权重」——而换机器最容易坏的就是这两样，所以一并报出来。
    private(set) var lastPythonPath: String?
    private(set) var lastModelPath: String?
    /// Runs when an utterance finishes on its own — the cue to reopen the mic
    /// in continuous-talk mode. Not called when the user barges in, because
    /// `stop()` drops the callback: being interrupted is not finishing.
    var onFinishSpeaking: (() -> Void)?
    private let directory = FileManager.default.temporaryDirectory.appendingPathComponent("pet-tts-" + UUID().uuidString)

    func stop() {
        pending = nil
        onError = nil
        player?.stop()
        player = nil
    }

    func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        guard self.player === player else { return }
        self.player = nil
        let done = onFinishSpeaking
        onFinishSpeaking = nil
        done?()
    }

    /// Start the worker ahead of time. Qwen3 needs ~13s to load its weights,
    /// and paying that during the first reply makes the pet look broken.
    func warmUp() {
        guard process?.isRunning != true else { return }
        try? start()
    }

    func speak(_ text: String, engine: String, voice: String, speed: Double, pitch: Double,
               instruct: String = "", gain: Double = 0.0, onError: @escaping () -> Void) {
        stop()
        let id = UUID().uuidString.lowercased()
        do {
            if process?.isRunning != true { try start() }
            pending = id
            self.onError = onError
            var payload: [String: Any] = [
                "id": id, "text": text, "engine": engine, "voice": voice,
                "speed": speed.isFinite ? speed : 1.0,
                "pitch": pitch.isFinite ? pitch : 1.0,
            ]
            if gain.isFinite && abs(gain) > 0.01 { payload["gain"] = gain }
            if !instruct.isEmpty { payload["instruct"] = instruct }
            var data = try JSONSerialization.data(withJSONObject: payload)
            data.append(10)
            try input?.write(contentsOf: data)
        } catch { stop(); onError() }
    }

    /// 解释器解析顺序：显式覆盖 → 项目自带 → 隔壁 LiveTalking 的 venv。
    ///
    /// `.runtime/venv-tts` 是「运行时收口」之后的位置：桌宠只依赖自己项目里的
    /// Python，不再借用 LiveTalking 的环境。旧路径留着是因为有人 clone 下来还没跑
    /// `scripts/setup-runtime.sh`——能出声总比直接报错强。
    private static func locatePython(project: URL) -> String? {
        var candidates: [String] = []
        if let override = ProcessInfo.processInfo.environment["LINGDESK_TTS_PYTHON"] {
            candidates.append(override)
        }
        candidates.append(project.appendingPathComponent(".runtime/venv-tts/bin/python").path)
        candidates.append(project.deletingLastPathComponent()
            .appendingPathComponent("LiveTalking/.venv/bin/python").path)
        return candidates.first { FileManager.default.isExecutableFile(atPath: $0) }
    }

    private func start() throws {
        let project = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        let bundled = Bundle.main.resourceURL?.appendingPathComponent("pet_tts.py")
        let script = bundled.flatMap { FileManager.default.fileExists(atPath: $0.path) ? $0 : nil }
            ?? project.appendingPathComponent("scripts/pet_tts.py")
        guard let python = Self.locatePython(project: project),
              FileManager.default.fileExists(atPath: script.path) else {
            throw CocoaError(.fileNoSuchFile)
        }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        buffer.removeAll()
        let task = Process(), stdin = Pipe(), stdout = Pipe()
        task.executableURL = URL(fileURLWithPath: python)
        // 'auto' lets the worker fall back to the local model when offline.
        task.arguments = [script.path, directory.path, "--engine", "auto", "--warm"]
        // worker 被拷进 .app 之后 `__file__` 指向 Resources，自己找不到项目里的权重，
        // 所以路径由这边算好传过去。不清空原环境：worker 还要 PATH 里的 ffmpeg。
        var environment = ProcessInfo.processInfo.environment
        let model = project.appendingPathComponent(".runtime/models/qwen3-tts")
        if FileManager.default.fileExists(atPath: model.path) {
            environment["PET_TTS_MODEL"] = model.path
        }
        task.environment = environment
        lastPythonPath = python
        lastModelPath = environment["PET_TTS_MODEL"]
        task.standardInput = stdin; task.standardOutput = stdout
        task.standardError = FileHandle.nullDevice
        stdout.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            Task { @MainActor [weak self] in self?.consume(data) }
        }
        task.terminationHandler = { [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self, self.process === task else { return }
                self.outputPipe?.fileHandleForReading.readabilityHandler = nil
                self.process = nil
                let failure = self.onError
                self.stop()
                failure?()
            }
        }
        try task.run()
        process = task; input = stdin.fileHandleForWriting; outputPipe = stdout
    }

    private func consume(_ data: Data) {
        buffer.append(data)
        while let newline = buffer.firstIndex(of: 10) {
            let line = buffer.prefix(upTo: newline)
            buffer.removeSubrange(...newline)
            guard let result = try? JSONSerialization.jsonObject(with: line) as? [String: Any],
                  let id = result["id"] as? String, UUID(uuidString: id) != nil else { continue }
            // Output is confined to our own directory, regardless of worker response.
            let file = directory.appendingPathComponent(id + ".wav")
            defer { try? FileManager.default.removeItem(at: file) }
            guard id == pending else { continue }
            let failure = onError
            pending = nil; onError = nil
            do {
                guard result["error"] == nil else { throw CocoaError(.fileReadUnknown) }
                let url = resolvedURL(result["path"])
                guard let url else { throw CocoaError(.fileReadUnknown) }
                defer { try? FileManager.default.removeItem(at: url) }
                lastEngine = result["engine"] as? String
                player = try AVAudioPlayer(contentsOf: url)
                player?.volume = 1.0
                player?.delegate = self
                guard player?.play() == true else { throw CocoaError(.fileReadUnknown) }
            } catch { failure?() }
        }
    }

    /// Accepts the worker's path only when it points inside our private directory.
    /// Without this a hostile or buggy worker could make us open any file.
    private func resolvedURL(_ value: Any?) -> URL? {
        guard let path = value as? String, !path.isEmpty else { return nil }
        let url = URL(fileURLWithPath: path).standardizedFileURL
        let root = directory.standardizedFileURL
        guard url.path.hasPrefix(root.path + "/") else { return nil }
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        return url
    }

    deinit {
        outputPipe?.fileHandleForReading.readabilityHandler = nil
        process?.terminate()
        try? FileManager.default.removeItem(at: directory)
    }
}
