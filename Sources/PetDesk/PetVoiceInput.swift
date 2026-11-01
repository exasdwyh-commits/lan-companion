import Foundation
import AVFoundation
import Speech

/// Microphone input built to feel like a smart speaker rather than a form field.
///
/// Two things make it feel alive and both come from the same audio tap:
///   - dictation ends itself after a pause, so you never press "stop";
///   - a live level feed lets the pet shut up the instant you start talking.
///
/// Speech recognition is requested lazily. macOS shows two permission prompts
/// (microphone + speech) and popping them at launch, before the user has ever
/// asked the pet to listen, is the fastest way to get the app uninstalled.
@MainActor final class PetVoiceInput {
    enum Phase: String {
        case idle
        case listening
        /// Permission was refused or the recogniser has no Chinese support.
        case unavailable
    }

    /// `dictation` recognises one utterance and ends on silence.
    /// `monitor` only measures level — cheap enough to leave running for the
    /// few seconds of a follow-up window. Upgrade it with `beginDictation()`
    /// once the user actually speaks, which keeps the audio tap (and therefore
    /// the first syllable) instead of restarting the engine.
    enum Mode { case dictation, monitor }

    private let recogniser = SFSpeechRecognizer(locale: Locale(identifier: "zh-CN"))
    private let engine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var recognitionTask: SFSpeechRecognitionTask?
    private var silenceTimer: Timer?
    private var maxTimer: Timer?
    private var levelPoll: Timer?
    private var startedAt: Date?

    /// Raw level from the audio thread. Read by a timer on the main actor
    /// instead of hopping actors ~23 times a second for every buffer.
    private var rawLevel: Float = 0
    private var rawSpoke = false

    private(set) var phase: Phase = .idle
    private(set) var transcript = ""
    /// Smoothed 0...1 input level, for the mic meter.
    private(set) var level: Float = 0

    /// Raised above this and the user is deemed to be speaking.
    var vadThreshold: Float = 0.035
    /// Seconds of quiet that ends an utterance in dictation mode.
    var silenceTimeout: TimeInterval = 1.5
    /// Hard stop so an unattended mic cannot run all night.
    var maxDuration: TimeInterval = 30

    var onPhaseChange: ((Phase) -> Void)?
    /// Partial results, so the bubble can fill in as the user speaks.
    var onTranscript: ((String) -> Void)?
    var onFinal: ((String) -> Void)?
    var onFailure: ((String) -> Void)?
    /// Fires when the user becomes audible. Wired to cut off speech, and in
    /// monitor mode it is also the cue to start real recognition.
    var onVoiceActivity: (() -> Void)?

    private var mode: Mode = .dictation
    private var availabilityChecked = false

    // MARK: - availability

    /// nil when usable, otherwise a human-readable reason. Never prompts.
    func unavailabilityReason() -> String? {
        if recogniser == nil { return "这台 Mac 没有中文语音识别。" }
        if !recogniser!.supportsOnDeviceRecognition && !recogniser!.isAvailable {
            return "语音识别当前不可用。"
        }
        switch SFSpeechRecognizer.authorizationStatus() {
        case .authorized: return nil
        case .denied: return "语音识别权限被拒绝了。系统设置 → 隐私与安全性 → 语音识别 里可以改回来。"
        case .restricted: return "这台 Mac 不允许语音识别。"
        case .notDetermined: return nil      // prompting is the caller's job
        @unknown default: return nil
        }
    }

    /// Asks for both permissions. Only call this from a deliberate user action.
    ///
    /// Both calls are wrapped in a timeout: if the user never answers the
    /// system prompt the continuation would otherwise never resume and the
    /// whole feature would hang forever. "Not answered" is treated as refused.
    func requestPermission() async -> Bool {
        guard recogniser != nil else { return false }
        let speech = await withTimeout(seconds: 25, fallback: SFSpeechRecognizerAuthorizationStatus.denied) {
            await withCheckedContinuation { continuation in
                SFSpeechRecognizer.requestAuthorization { continuation.resume(returning: $0) }
            }
        }
        guard speech == .authorized else { return false }
        let mic = await withTimeout(seconds: 25, fallback: false) {
            await withCheckedContinuation { continuation in
                AVCaptureDevice.requestAccess(for: .audio) { continuation.resume(returning: $0) }
            }
        }
        availabilityChecked = true
        return mic
    }

    private func withTimeout<T>(seconds: Double, fallback: T,
                                _ body: @escaping () async -> T) async -> T {
        // Race the real call against a timer. Cancelling the group on timeout
        // leaves the continuation suspended, which leaks a small amount of
        // state — the alternative (hanging forever) is worse.
        return await withTaskGroup(of: T?.self) { group in
            group.addTask { await body() }
            group.addTask { try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000)); return nil }
            let first = await group.next()
            group.cancelAll()
            return first.flatMap { $0 } ?? fallback
        }
    }

    // MARK: - control

    /// Returns false when the mic could not open; `onFailure` then explains why.
    @discardableResult
    func start(mode wanted: Mode = .dictation) -> Bool {
        guard phase != .listening else { return true }
        if let reason = unavailabilityReason() {
            setPhase(.unavailable)
            onFailure?(reason)
            return false
        }
        guard SFSpeechRecognizer.authorizationStatus() == .authorized else {
            // Not prompted yet: let the caller drive the async permission flow.
            onFailure?(unavailabilityReason() ?? "语音识别还没授权。")
            return false
        }
        mode = wanted
        transcript = ""
        startedAt = Date()
        do {
            try installTap()
        } catch {
            onFailure?("麦克风打不开：\(error.localizedDescription)")
            return false
        }
        setPhase(.listening)
        if wanted == .dictation { beginDictation() }
        armTimers()
        return true
    }

    /// Attach a recogniser to the already-running tap.
    ///
    /// Called when monitor mode hears something. Reusing the tap matters:
    /// restarting the engine costs ~100 ms of audio, which is exactly the
    /// "她总听漏我第一句" complaint.
    func beginDictation() {
        guard phase == .listening, request == nil, let recogniser else { return }
        transcript = ""
        let req = SFSpeechAudioBufferRecognitionRequest()
        req.shouldReportPartialResults = true
        if recogniser.supportsOnDeviceRecognition {
            // Keep audio off Apple's servers where possible. It also works
            // offline, which matters for a companion that lives on a laptop.
            req.requiresOnDeviceRecognition = true
        }
        req.addsPunctuation = true
        request = req
        recognitionTask = recogniser.recognitionTask(with: req) { [weak self] result, error in
            Task { @MainActor [weak self] in self?.handle(result: result, error: error) }
        }
        armSilenceTimer()
    }

    func stop() {
        guard phase == .listening else { return }
        finish()
    }

    /// Ends the utterance and hands back whatever was recognised.
    private func finish() {
        silenceTimer?.invalidate(); silenceTimer = nil
        maxTimer?.invalidate(); maxTimer = nil
        levelPoll?.invalidate(); levelPoll = nil
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        request?.endAudio()
        request = nil
        recognitionTask?.cancel()
        recognitionTask = nil
        setPhase(.idle)
        let text = transcript.trimmingCharacters(in: .whitespacesAndNewlines)
        if !text.isEmpty { onFinal?(text) }
    }

    // MARK: - plumbing

    private func installTap() throws {
        let node = engine.inputNode
        let format = node.outputFormat(forBus: 0)
        node.removeTap(onBus: 0)
        node.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            // Audio thread: measure only. Touching main-actor state here would
            // mean ~23 actor hops per second for nothing.
            self?.measure(buffer)
        }
        engine.prepare()
        try engine.start()
        // Poll the measurement instead of being called by it. 20 Hz is plenty
        // for a meter and for barge-in, which only needs to feel instant.
        levelPoll = Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in self?.drainLevel() }
        }
    }

    private func measure(_ buffer: AVAudioPCMBuffer) {
        guard let channel = buffer.floatChannelData?.pointee else { return }
        let n = Int(buffer.frameLength)
        guard n > 0 else { return }
        var sum: Float = 0
        for i in 0..<n { sum += channel[i] * channel[i] }
        let rms = sqrt(sum / Float(n))
        rawLevel = rms
        rawSpoke = rms > vadThreshold
    }

    private func drainLevel() {
        // Smooth so the meter does not jitter and VAD does not flicker.
        level = level * 0.7 + rawLevel * 0.3
        if rawSpoke {
            onVoiceActivity?()
            if mode == .dictation { armSilenceTimer() }
        }
    }

    private func armSilenceTimer() {
        silenceTimer?.invalidate()
        silenceTimer = Timer.scheduledTimer(withTimeInterval: silenceTimeout, repeats: false) { [weak self] _ in
            Task { @MainActor [weak self] in self?.finish() }
        }
    }

    private func armTimers() {
        // The silence clock belongs to dictation (it is armed there, and again
        // on every syllable). Monitor mode just needs the hard cap.
        maxTimer = Timer.scheduledTimer(withTimeInterval: maxDuration, repeats: false) { [weak self] _ in
            Task { @MainActor [weak self] in self?.finish() }
        }
    }

    private func handle(result: SFSpeechRecognitionResult?, error: Error?) {
        guard let result else {
            if let error {
                let ns = error as NSError
                // 203/216 are "no speech yet" / "cancelled" — user-facing noise.
                if ns.domain == "kAFAssistantErrorDomain" && (ns.code == 203 || ns.code == 216) {
                    return
                }
                onFailure?(error.localizedDescription)
            }
            return
        }
        let text = result.bestTranscription.formattedString
        transcript = text
        onTranscript?(text)
        if result.isFinal { finish() }
    }

    private func setPhase(_ next: Phase) {
        guard phase != next else { return }
        phase = next
        onPhaseChange?(next)
    }

    func teardown() {
        silenceTimer?.invalidate(); silenceTimer = nil
        maxTimer?.invalidate(); maxTimer = nil
        levelPoll?.invalidate(); levelPoll = nil
        recognitionTask?.cancel(); recognitionTask = nil
        request?.endAudio(); request = nil
        engine.inputNode.removeTap(onBus: 0)
        if engine.isRunning { engine.stop() }
        setPhase(.idle)
    }
}
