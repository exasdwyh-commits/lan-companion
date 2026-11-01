import Foundation

@main struct PetNeuralSpeechChecks {
    @MainActor static func main() async throws {
        let speech = PetNeuralSpeech()
        var failed = false
        speech.speak("我在呀，今天也陪你一起。", voice: "zf_xiaoni") { failed = true }
        for _ in 0..<200 {
            if speech.isPlaying || failed { break }
            try await Task.sleep(nanoseconds: 100_000_000)
        }
        guard speech.isPlaying, !failed else { print("FAIL: neural playback"); exit(1) }
        speech.stop()
        guard !speech.isPlaying else { exit(1) }
        speech.speak("这句取消后不应播放。", voice: "zf_xiaoni") { failed = true }
        speech.stop()
        try await Task.sleep(nanoseconds: 1_500_000_000)
        guard !speech.isPlaying, !failed else { print("FAIL: cancelled playback"); exit(1) }
        print("PASS: real Kokoro synthesis → native AVAudioPlayer; stop and stale reply discarded")
    }
}
