import AppKit
import CompanionCore

// 素材出问题时的收敛检查。
//
// 这几条不是「功能测试」，是「坏掉之后还讲不讲道理」：
// 文件没了、文件在但解不出来、动作素材缺失、动作播到一半被打断——
// 每一种都不该留下黑屏、卡住的动作层，或者一声不吭。

final class PetPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
}

@main struct PetDegradeChecks {
    @MainActor static func main() async throws {
        let argv = CommandLine.arguments
        let work = URL(fileURLWithPath: argv[1], isDirectory: true)
        let outPath = argv[2]
        let sourceAssets = URL(fileURLWithPath: argv[3], isDirectory: true)
        let goodVideo = sourceAssets.appendingPathComponent("idle-matched-clean.mov")

        NSApplication.shared.setActivationPolicy(.accessory)
        try? FileManager.default.createDirectory(at: work, withIntermediateDirectories: true)

        var checks: [String: Bool] = [:]
        var notes: [String: String] = [:]

        func wait(_ seconds: Double) async {
            try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
        }

        // MARK: 夹具
        //
        // 用符号链接指向真实素材，免得每个用例都拷一份 42 MB；假视频写随机字节，
        // 让它「文件存在、大小正常、但解不出来」——这才是最容易静默黑屏的那种坏法。

        let good = work.appendingPathComponent("good.mov")
        try? FileManager.default.removeItem(at: good)
        guard FileManager.default.fileExists(atPath: goodVideo.path) else {
            FileHandle.standardError.write(Data("缺少基准素材：\(goodVideo.path)\n".utf8))
            exit(2)
        }
        try FileManager.default.createSymbolicLink(at: good, withDestinationURL: goodVideo)

        let corrupt = work.appendingPathComponent("corrupt.mp4")
        var bytes = Data(count: 24 * 1024)
        bytes.withUnsafeMutableBytes { raw in
            for index in raw.indices { raw[index] = UInt8(truncatingIfNeeded: index &* 37 &+ 11) }
        }
        try bytes.write(to: corrupt)
        let missingName = "missing-idle.mp4"

        func makePack(_ name: String, ambient: [String]) throws -> URL {
            let dir = work.appendingPathComponent(name, isDirectory: true)
            try? FileManager.default.removeItem(at: dir)
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            let resolved = ambient.map { entry -> String in
                if entry == "good" { return good.path }
                if entry == "corrupt" { return corrupt.path }
                return entry
            }
            let pack: [String: Any] = [
                "format": 1,
                "name": "降级测试 \(name)",
                "greeting": ["测试问候"],
                "touches": ["嗯"],
                "scene": ["id": name, "ambient": resolved, "actions": []]
            ]
            try JSONSerialization.data(withJSONObject: pack)
                .write(to: dir.appendingPathComponent("pack.json"))
            return dir
        }

        func boot(_ dir: URL, dataName: String) throws -> PetController {
            setenv("LINGDESK_PET_ASSETS", dir.path, 1)
            let data = work.appendingPathComponent(dataName, isDirectory: true)
            try? FileManager.default.createDirectory(at: data, withIntermediateDirectories: true)
            setenv("LINGDESK_DATA_DIR", data.path, 1)
            var config = Settings()
            config.speakReplies = false
            try LocalStore().save(config, file: "settings.json")
            let controller = PetController()
            controller.show()
            return controller
        }

        func text(_ info: [String: Any], _ key: String) -> String { info[key] as? String ?? "" }
        func number(_ info: [String: Any], _ key: String) -> Double { info[key] as? Double ?? -1 }
        func topOpacity(_ info: [String: Any]) -> Double {
            ((info["idle.opacities"] as? [Double]) ?? []).max() ?? 0
        }

        // MARK: A. 声明了但文件不在 —— 要报出来，而且画面还在

        var controller = try boot(try makePack("a-partial", ambient: [missingName, "good"]), dataName: "data-a")
        await wait(1.5)
        var info = controller.diagnostics
        checks["A_health_degraded"] = text(info, "idle.health") == "degraded"
        checks["A_error_names_file"] = text(info, "idle.error").contains(missingName)
        checks["A_bubble_warns"] = text(info, "bubble.last").contains("缺失")
        checks["A_picture_still_there"] = topOpacity(info) >= 0.99
        checks["A_player_ready"] = text(info, "idle.status") == "readyToPlay"
        notes["A"] = "health=\(text(info, "idle.health")) err=\(text(info, "idle.error")) opacity=\(topOpacity(info)) status=\(text(info, "idle.status"))"
        // 动作层塞一个不存在的文件：它不该被提起来，否则就把待机画面盖住了。
        controller.probeMissingAction()
        await wait(0.5)
        checks["A_missing_action_keeps_layer_down"] = number(controller.diagnostics, "action.opacity") == 0
        controller.stop(); controller.hide()

        // MARK: B. 一个都不在 —— 不能只是「没找到素材」这种含糊话

        controller = try boot(try makePack("b-none", ambient: ["gone-1.mp4", "gone-2.mp4"]), dataName: "data-b")
        await wait(1.2)
        info = controller.diagnostics
        checks["B_bubble_names_missing"] = text(info, "bubble.last").contains("gone-1.mp4")
        checks["B_no_crash"] = controller.diagnostics["pack.name"] as? String == "降级测试 b-none"
        notes["B"] = text(info, "bubble.last")
        controller.stop(); controller.hide()

        // MARK: C. 文件在但解不出来 —— 前台坏了要退回上一段，不能停在空画面

        controller = try boot(try makePack("c-corrupt", ambient: ["good"]), dataName: "data-c")
        await wait(1.2)
        checks["C_boot_visible"] = topOpacity(controller.diagnostics) >= 0.99
        // 把待机切到「坏文件」：上一层还留着能播的那段，正好用来验证回退。
        controller.probeAmbientSwitch(to: [corrupt])
        await wait(1.0)
        info = controller.diagnostics
        checks["C_picture_after_failure"] = topOpacity(info) >= 0.99
        checks["C_player_ready_after_failure"] = text(info, "idle.status") == "readyToPlay"
        checks["C_health_degraded"] = text(info, "idle.health") == "degraded"
        checks["C_error_reported"] = !text(info, "idle.error").isEmpty
        // C_picture_after_failure 单独看可能是「本来就没切过去」，所以再数一次回退次数。
        checks["C_recovery_ran"] = (info["idle.recoveries"] as? Int ?? 0) >= 1
        notes["C"] = "err=\(text(info, "idle.error")) opacity=\(topOpacity(info)) status=\(text(info, "idle.status")) recoveries=\(info["idle.recoveries"] ?? "?")"
        controller.stop(); controller.hide()

        // MARK: D. 真实鲸鱼包：点击动作能起、能自己收回去

        controller = try boot(sourceAssets, dataName: "data-d")
        await wait(1.6)
        checks["D_character_loaded"] = controller.diagnostics["character.loaded"] as? Bool ?? false
        controller.simulateTap()
        await wait(0.8)
        info = controller.diagnostics
        checks["D_reaction_started"] = info["character.reaction"] as? Bool ?? false
        checks["D_reaction_left_pending"] = !(info["character.reactionPending"] as? Bool ?? true)
        // 动作片 7.96 秒；等它自然收尾，确认状态收敛回待机而不是卡在 reactionPlaying。
        await wait(8.6)
        info = controller.diagnostics
        checks["D_reaction_converged"] = !(info["character.reaction"] as? Bool ?? true)
        checks["D_character_playing_again"] = number(info, "character.rate") > 0
        notes["D"] = "reaction=\(info["character.reaction"] ?? "?") rate=\(number(info, "character.rate"))"
        controller.stop(); controller.hide()

        let payload: [String: Any] = ["checks": checks, "notes": notes]
        let data = try JSONSerialization.data(withJSONObject: payload, options: [.prettyPrinted, .sortedKeys])
        try data.write(to: URL(fileURLWithPath: outPath))
        print(String(decoding: data, as: UTF8.self))
        if checks.values.contains(false) { exit(1) }
    }
}
