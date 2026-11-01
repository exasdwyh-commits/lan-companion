import Foundation
import AVFoundation

/// Scene packs carry the character's identity; model credentials stay in local settings.
struct PetIdentity: Decodable {
    var name: String
    var persona: String
    var greeting: String
    var touches: [String]
    var scene: String
    var background: String?
    var character: String?
    var characterTransitionsAtLoopBoundary: Bool?
    var quietCharacter: String?
    var sleepScene: String?
    var quietAfterSeconds: Double?
    var sleepAfterSeconds: Double?
    var speechVoice: String?
    var speechPitch: Float?
    var speechRate: Float?
    var speechBackend: String?
    var neuralVoice: String?
    var neuralSpeed: Double?
    var neuralPitch: Double?
    /// Style prompt for Qwen3-TTS only ("温柔地/撒娇地"). Ignored by other engines.
    var neuralInstruct: String?
    /// Extra output trim in dB. Negative is quieter — a pet that talks all day
    /// should sit under the user's own media, not over it.
    var neuralGain: Double?
    /// Names that wake her when always-on listening is enabled.
    var wakeWords: [String]?
    /// Seconds the mic stays half-open after she speaks. 0 disables follow-up.
    var continuousSeconds: Double?

    /// "qwen3" / "edgetts" / "kokoro" / "auto" (default) / "system".
    var resolvedBackend: String {
        let value = (speechBackend ?? "auto").lowercased()
        return ["qwen3", "edgetts", "kokoro", "auto", "system"].contains(value) ? value : "auto"
    }

    /// Voice id forwarded to the worker, defaulted per backend.
    /// A voice from the wrong family is replaced rather than passed through.
    func neuralVoice(for backend: String) -> String {
        let value = neuralVoice ?? ""
        if backend == "kokoro" { return value.hasPrefix("z") ? value : "zf_xiaoxiao" }
        if backend == "system" { return value }
        // Qwen3 speaker ids are CamelCase English names. The worker allow-lists
        // them and falls back on its own, so we only need a sane default.
        if backend == "qwen3" { return value.isEmpty ? "Vivian" : value }
        if backend == "edgetts" { return value.hasPrefix("zh-") ? value : "zh-CN-XiaoxiaoNeural" }
        // "auto": pass the configured id through untouched. The worker tries each
        // engine in order and skips the ones that do not know this voice, so
        // rewriting it here would silently drop Qwen3 back to edge-tts.
        return value.isEmpty ? "Vivian" : value
    }

    var resolvedSpeed: Double {
        let value = neuralSpeed ?? 1.0
        return value.isFinite ? min(max(value, 0.6), 1.6) : 1.0
    }

    var resolvedPitch: Double {
        let value = neuralPitch ?? 1.0
        return value.isFinite ? min(max(value, 0.7), 1.4) : 1.0
    }

    /// Clamped to -30..+12 dB; anything wilder is a typo, not a preference.
    var resolvedGain: Double {
        let value = neuralGain ?? 0.0
        return value.isFinite ? min(max(value, -30.0), 12.0) : 0.0
    }

    func utterance(_ text: String) -> AVSpeechUtterance {
        let utterance = AVSpeechUtterance(string: text)
        utterance.voice = speechVoice.flatMap { AVSpeechSynthesisVoice(identifier: $0) }
            ?? AVSpeechSynthesisVoice(language: "zh-CN")
        let pitch = speechPitch ?? 0.95
        let rate = speechRate ?? AVSpeechUtteranceDefaultSpeechRate
        utterance.pitchMultiplier = pitch.isFinite ? min(max(pitch, 0.8), 1.4) : 0.95
        utterance.rate = rate.isFinite ? min(max(rate, 0.35), 0.6) : AVSpeechUtteranceDefaultSpeechRate
        return utterance
    }

    static func load(from root: URL?) -> PetIdentity? {
        guard let root, let data = try? Data(contentsOf: root.appendingPathComponent("character.json")),
              let identity = try? JSONDecoder().decode(Self.self, from: data),
              [identity.scene, identity.background, identity.character, identity.quietCharacter, identity.sleepScene].compactMap({ $0 }).allSatisfy({
                  !$0.isEmpty && !$0.hasPrefix(".") && URL(fileURLWithPath: $0).lastPathComponent == $0
              }) else { return nil }
        return identity
    }
}
