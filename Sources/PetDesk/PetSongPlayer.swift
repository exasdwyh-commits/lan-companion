import AVFoundation
import Foundation

/// 唱歌：一段本地音频 + 一条歌词时间轴。
///
/// 不复用 TTS 的 AVAudioPlayer：语音是「说完就完」的一次性资源，歌是「可以暂停、
/// 要知道播到第几句、要被点击打断」的长音频，两者生命周期不一样。混在一起会让
/// `onFinishSpeaking`（等她说完好开麦克风）在唱歌结束时误触发。
///
/// 歌词的时间单位是秒，来自 pack.json 的 `lyrics[].at`。找不到当前行就保持上一行，
/// 不清空——清空会让歌词条闪一下。
@MainActor
final class PetSongPlayer: NSObject, AVAudioPlayerDelegate {
    private var player: AVAudioPlayer?
    private var ticker: Timer?
    private var lines: [(at: Double, text: String)] = []
    private(set) var songID: String?
    private(set) var title = ""
    private(set) var lineIndex = -1
    private(set) var lastError: String?

    /// 当前该显示的那句歌词。整行替换，不做逐字动画（逐字是说话，不是唱歌）。
    var onLine: ((String?) -> Void)?
    /// 自然播完才算。被打断不算——调用方要能区分这两件事。
    var onFinish: (() -> Void)?
    var onError: ((String) -> Void)?

    var isPlaying: Bool { player?.isPlaying == true }
    var hasSong: Bool { player != nil }
    var position: Double { player?.currentTime ?? 0 }
    var duration: Double { player?.duration ?? 0 }

    /// 起一首歌。失败返回 false 并回调 onError，不留半播放状态。
    @discardableResult
    func play(song: PetPack.Song, url: URL, volume: Float = 1.0) -> Bool {
        stop()
        // 先查文件，再交给 AVAudioPlayer。它失败时只给一个 nil，说不出原因，
        // 而「文件被删了」和「编码不支持」对用户是两句不同的话。
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: url.path, isDirectory: &isDirectory),
              !isDirectory.boolValue else {
            fail("找不到这首歌的音频：\(url.lastPathComponent)")
            return false
        }
        do {
            let audio = try AVAudioPlayer(contentsOf: url)
            audio.delegate = self
            audio.volume = min(max(volume, 0), 1)
            audio.prepareToPlay()
            guard audio.play() else {
                fail("《\(song.title)》无法播放")
                return false
            }
            player = audio
            songID = song.id
            title = song.title
            lineIndex = -1
            lastError = nil
            lines = (song.lyrics ?? [])
                .filter { $0.at.isFinite }
                .sorted { $0.at < $1.at }
                .map { (at: $0.at, text: $0.zh) }
            onLine?(nil)
            startTicking()
            return true
        } catch {
            fail("《\(song.title)》无法播放：\(error.localizedDescription)")
            return false
        }
    }

    func stop() {
        ticker?.invalidate(); ticker = nil
        player?.stop()
        player = nil
        songID = nil
        title = ""
        lineIndex = -1
        lines = []
    }

    /// 暂停保留进度，供「先别唱了 / 继续」用。
    func pause() {
        player?.pause()
        ticker?.invalidate(); ticker = nil
    }

    func resume() {
        guard let player, !player.isPlaying else { return }
        player.play()
        startTicking()
    }

    private func startTicking() {
        ticker?.invalidate()
        let timer = Timer(timeInterval: 0.1, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.tick() }
        }
        // .common：拖窗口、拉菜单时歌词不能停。
        RunLoop.main.add(timer, forMode: .common)
        ticker = timer
    }

    private func tick() {
        guard let player else { return }
        let now = player.currentTime
        guard now.isFinite, !lines.isEmpty else { return }
        var index = -1
        for (offset, line) in lines.enumerated() where now >= line.at { index = offset }
        guard index != lineIndex else { return }
        lineIndex = index
        onLine?(index >= 0 ? lines[index].text : nil)
    }

    func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        guard self.player === player else { return }
        stop()
        onFinish?()
    }

    func audioPlayerDecodeErrorDidOccur(_ player: AVAudioPlayer, error: Error?) {
        guard self.player === player else { return }
        stop()
        fail("这首歌解码失败：\(error?.localizedDescription ?? "未知原因")")
    }

    private func fail(_ message: String) {
        lastError = message
        onError?(message)
    }
}
