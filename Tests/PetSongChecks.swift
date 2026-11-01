import AppKit
import CompanionCore

// 唱歌功能的检查：能不能播、歌词跟不跟得上、点一下停不停、听完给不给好感、
// 素材缺了会不会装作没事。
//
// 用一段 6 秒的合成音做夹具，跑完一轮十几秒；真实翻唱音频的听感另外验证
// （benchmarks/sing-2026-10-30/），这里只管行为和时序。

final class PetPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
}

@main struct PetSongChecks {
    @MainActor static func main() async throws {
        let argv = CommandLine.arguments
        let work = URL(fileURLWithPath: argv[1], isDirectory: true)
        let outPath = argv[2]
        NSApplication.shared.setActivationPolicy(.accessory)
        try? FileManager.default.createDirectory(at: work, withIntermediateDirectories: true)

        var checks: [String: Bool] = [:]
        var notes: [String: String] = [:]
        func wait(_ seconds: Double) async {
            try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
        }

        // 夹具：6 秒音频（三段不同音高，便于确认真的在往前走）+ 一首缺文件的歌。
        // 音频由 check-whale-songs.sh 先生成——测试进程里 exec 外部程序会被沙箱掐掉。
        let assets = work.appendingPathComponent("pack", isDirectory: true)
        let audio = assets.appendingPathComponent("songs/demo.m4a")
        guard FileManager.default.fileExists(atPath: audio.path) else {
            FileHandle.standardError.write(Data("缺少夹具音频：\(audio.path)\n".utf8))
            exit(2)
        }
        let songsDir = audio.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: songsDir, withIntermediateDirectories: true)

        let pack: [String: Any] = [
            "format": 1,
            "name": "唱歌测试",
            "greeting": ["测试"],
            "touches": ["嗯"],
            "idles": ["在听"],
            "affection": ["song": 3],
            "songLines": ["好听吗？"],
            "scene": ["id": "t", "ambient": [], "actions": []],
            "songs": [
                ["id": "demo", "title": "测试曲", "file": "songs/demo.m4a",
                 "credit": "测试音轨",
                 "lyrics": [["at": 0.0, "zh": "第一句"],
                            ["at": 1.4, "zh": "第二句"],
                            ["at": 2.8, "zh": "第三句"]]],
                ["id": "ghost", "title": "缺失曲", "file": "songs/nope.m4a"]
            ]
        ]
        try JSONSerialization.data(withJSONObject: pack)
            .write(to: assets.appendingPathComponent("pack.json"))

        let data = work.appendingPathComponent("data", isDirectory: true)
        try? FileManager.default.createDirectory(at: data, withIntermediateDirectories: true)
        setenv("LINGDESK_DATA_DIR", data.path, 1)
        setenv("LINGDESK_PET_ASSETS", assets.path, 1)
        var config = Settings()
        config.speakReplies = false
        try LocalStore().save(config, file: "settings.json")

        let controller = PetController()
        controller.show()
        await wait(1.0)

        func text(_ key: String) -> String { controller.diagnostics[key] as? String ?? "" }
        func number(_ key: String) -> Double { controller.diagnostics[key] as? Double ?? -1 }
        func flag(_ key: String) -> Bool { controller.diagnostics[key] as? Bool ?? false }
        /// 行号是 Int，不能走 number()——它按 Double 取，会永远拿到 -1。
        func line() -> Int { controller.diagnostics["song.line"] as? Int ?? -1 }

        let affinityBefore = controller.diagnostics["affinity"] as? Int ?? 0
        checks["S_songs_loaded"] = (controller.diagnostics["song.count"] as? Int) == 2
        checks["S_not_singing_at_boot"] = !flag("song.playing")

        // 1. 点歌：播得起来，位置在往前走
        guard let demo = controller.nextSong() else {
            FileHandle.standardError.write(Data("没有可选歌曲\n".utf8))
            exit(2)
        }
        checks["next_song_skips_missing"] = demo.id == "demo"
        controller.sing(demo)
        await wait(0.9)
        checks["S_plays"] = flag("song.playing")
        checks["S_position_advances"] = number("song.position") > 0.5
        checks["S_title_set"] = text("song.title") == "测试曲"
        notes["first"] = "pos=\(number("song.position")) line=\(line()) lyric=\(text("song.lineText"))"

        // 2. 歌词按时间码换行（1.4 秒那句）
        await wait(1.2)
        checks["S_lyric_switches"] = line() >= 1
        notes["lyric"] = "line=\(line()) text=\(text("song.lineText"))"

        // 3. 点一下停：收敛回待机，也不该算「听完」。
        //    注意点一下同时是一次「摸她」，好感会 +1，所以这里不拿好感当依据。
        controller.simulateTap()
        await wait(0.4)
        checks["S_tap_stops"] = !flag("song.playing")
        checks["S_tap_clears_title"] = text("song.title").isEmpty
        checks["S_interrupt_not_heard"] = (controller.diagnostics["song.heard"] as? Int ?? -1) == 0

        // 4. 本地意图：说「唱首歌」不过模型，直接开唱
        controller.simulateSend("唱首歌吧")
        await wait(0.6)
        checks["S_intent_plays"] = flag("song.playing")
        notes["intent"] = "playing=\(flag("song.playing")) title=\(text("song.title"))"
        controller.stopSinging()

        // 5. 问句不该被当成点歌
        controller.simulateSend("你会唱歌吗")
        await wait(0.3)
        checks["S_question_not_intent"] = !flag("song.playing")

        // 6. 听完：好感 +3、记进听过、唱完有话说
        await wait(0.4)
        let beforeFinish = controller.diagnostics["affinity"] as? Int ?? 0
        controller.sing(demo)
        await wait(6.8)
        checks["S_finished_reward"] = (controller.diagnostics["affinity"] as? Int ?? 0) == beforeFinish + 3
        checks["S_finished_recorded"] = (controller.diagnostics["song.heard"] as? Int ?? 0) >= 1
        checks["S_finished_converged"] = !flag("song.playing") && text("song.title").isEmpty
        notes["finish"] = "affinity=\(controller.diagnostics["affinity"] ?? "?") heard=\(controller.diagnostics["song.heard"] ?? "?") bubble=\(text("bubble.last"))"

        // 7. 素材缺了：报错、不留半播放状态
        guard let ghost = controller.song(withID: "ghost") else {
            FileHandle.standardError.write(Data("取不到缺失曲目\n".utf8))
            exit(2)
        }
        controller.sing(ghost)
        await wait(0.4)
        checks["S_missing_reported"] = text("bubble.last").contains("不在素材包")
        checks["S_missing_not_playing"] = !flag("song.playing")
        notes["missing"] = text("bubble.last")

        controller.stop()
        let payload: [String: Any] = ["checks": checks, "notes": notes]
        let out = try JSONSerialization.data(withJSONObject: payload, options: [.prettyPrinted, .sortedKeys])
        try out.write(to: URL(fileURLWithPath: outPath))
        print(String(decoding: out, as: UTF8.self))
        if checks.values.contains(false) { exit(1) }
    }
}
