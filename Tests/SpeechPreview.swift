import AppKit
import AVFoundation

@main struct SpeechPreview {
    static func main() throws {
        let args = CommandLine.arguments
        guard let identity = PetIdentity.load(from: URL(fileURLWithPath: args[1])) else { exit(1) }
        let utterance = identity.utterance("我在呀。今天也陪你一起，把想做的事情慢慢做好，好不好？")
        let synth = AVSpeechSynthesizer()
        var output: AVAudioFile?
        var frames: AVAudioFramePosition = 0
        print("voice=\(utterance.voice?.identifier ?? "default") pitch=\(utterance.pitchMultiplier) rate=\(utterance.rate)")
        synth.write(utterance) { buffer in
            guard let pcm = buffer as? AVAudioPCMBuffer else { return }
            if pcm.frameLength == 0 {
                output = nil
                print("frames=\(frames)")
                exit(frames > 0 ? 0 : 1)
            }
            do {
                if output == nil {
                    output = try AVAudioFile(forWriting: URL(fileURLWithPath: args[2]), settings: pcm.format.settings)
                }
                try output?.write(from: pcm)
                frames += AVAudioFramePosition(pcm.frameLength)
            } catch { print(error); exit(1) }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 30) { print("speech export timed out"); exit(1) }
        RunLoop.main.run()
    }
}
