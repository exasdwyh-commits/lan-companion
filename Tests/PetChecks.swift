import AppKit
import AVFoundation
import CompanionCore

final class PetPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
}

@main struct PetChecks {
    @MainActor static func main() async throws {
        let args = CommandLine.arguments
        setenv("LINGDESK_DATA_DIR", args[1], 1)
        setenv("LINGDESK_PET_ASSETS", args[2], 1)
        let app = NSApplication.shared
        app.setActivationPolicy(.accessory)
        var settings = Settings()
        settings.baseURL = "http://127.0.0.1:\(args[3])/v1"
        settings.model = "fixture"; settings.speakReplies = false
        try LocalStore().save(settings, file: "settings.json")
        let controller = PetController()
        var checks: [String: Bool] = [:]
        func check(_ name: String, _ value: Bool) { checks[name] = value }
        func wait(_ seconds: Double) async { try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000)) }

        controller.show()
        check("static_scene_loaded", controller.diagnostics["scene.loaded"] as? Bool == true)
        controller.simulateSend("中文输入完整保留")
        await wait(1.8)
        check("chat_completed", controller.diagnostics["history"] as? Int == 2)
        check("reply_visible", (controller.diagnostics["bubble.text"] as? String)?.contains("中文输入完整保留") == true)
        controller.simulateSend("清空时应丢弃的回复")
        await wait(0.15)
        controller.clearHistory()
        await wait(1.2)
        check("clear_discards_inflight", controller.diagnostics["history"] as? Int == 0)
        check("clear_releases_busy", controller.diagnostics["busy"] as? Bool == false)
        controller.simulateSend("隐藏时应丢弃的回复")
        await wait(0.15)
        controller.hide()
        await wait(1.2)
        check("hidden_discards_inflight", controller.diagnostics["history"] as? Int == 0)
        check("hidden_pauses_scene", controller.diagnostics["scene.paused"] as? Bool == true)
        controller.show()
        check("show_resumes_scene", controller.diagnostics["scene.paused"] as? Bool == false)
        controller.simulateSend("停止时应丢弃的回复")
        await wait(0.15)
        controller.cancelReply()
        await wait(1.2)
        check("stop_discards_inflight", controller.diagnostics["history"] as? Int == 0)
        controller.hide()

        // Exercise the actual video branch as well as the new still scene.
        setenv("LINGDESK_PET_ASSETS", args[4], 1)
        let video = PetController()
        video.show(); await wait(1.5)
        check("video_started", (video.diagnostics["idle.rate"] as? Double ?? 0) > 0)
        video.hide(); await wait(0.1)
        check("video_paused", video.diagnostics["idle.rate"] as? Double == 0)
        video.show(); await wait(0.8)
        check("video_resumed_after_show", (video.diagnostics["idle.rate"] as? Double ?? 0) > 0)
        video.hide()

        let layers = StageView(frame: NSRect(x: 0, y: 0, width: 640, height: 360))
        let root = URL(fileURLWithPath: args[2])
        check("background_image_loaded", layers.loadBackground(root.appendingPathComponent("background.png")))
        check("transparent_character_loaded", layers.loadCharacter(root.appendingPathComponent("character.png")))
        layers.layoutSubtreeIfNeeded()
        let original = layers.characterFrame
        layers.moveCharacter(dx: -100, dy: 0)
        check("character_moves_independently", layers.characterFrame.minX < original.minX)
        layers.scaleCharacter(-0.15)
        check("character_scales_independently", layers.characterFrame.height < original.height)
        let placed = layers.characterFrame
        layers.setScenePaused(false)
        check("background_video_loaded", layers.loadBackground(URL(fileURLWithPath: args[6])))
        await wait(1.3)
        check("background_video_playing", layers.backgroundIsVideo && layers.backgroundRate > 0)
        check("background_swap_keeps_character", layers.hasCharacter && layers.characterFrame == placed)
        layers.setScenePaused(true)

        check("background_video_pauses", layers.backgroundRate == 0)
        layers.setScenePaused(false)
        await wait(0.4)
        check("background_video_resumes", layers.backgroundRate > 0)
        _ = layers.loadBackground(root.appendingPathComponent("background.png"))
        check("switch_to_image_stops_video", !layers.backgroundIsVideo && layers.backgroundRate == 0 && layers.characterFrame == placed)
        layers.setScenePaused(true)

        let motion = root.deletingLastPathComponent().appendingPathComponent("whale-video-test/character.mov")
        check("character_video_loaded", layers.loadCharacter(motion))
        layers.layoutSubtreeIfNeeded()
        layers.setScenePaused(false)
        await wait(1.2)
        let motionTime = layers.characterTime
        check("character_video_advances", layers.characterIsVideo && layers.characterRate > 0 && motionTime > 0)
        layers.setScenePaused(true)
        await wait(0.2)
        let pausedTime = layers.characterTime
        await wait(0.3)
        check("character_video_pauses", layers.characterRate == 0 && abs(layers.characterTime - pausedTime) < 0.05)
        layers.setScenePaused(false)
        await wait(6.8)
        check("character_video_loops", layers.characterRate > 0 && layers.characterTime > 0 && layers.characterTime < 6.1)
        check("character_video_survives_background_swap", layers.loadBackground(root.appendingPathComponent("background.png")) && layers.characterIsVideo && layers.characterRate > 0)
        _ = layers.loadCharacter(root.appendingPathComponent("character.png"))
        check("switch_to_still_stops_character_video", !layers.characterIsVideo && layers.characterRate == 0)
        layers.setScenePaused(true)

        let result: [String: Any] = ["checks": checks, "passed": checks.values.allSatisfy { $0 }, "fixture": true]
        let data = try JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys])
        try data.write(to: URL(fileURLWithPath: args[5]))
        print(String(data: data, encoding: .utf8)!)
        exit(checks.values.allSatisfy { $0 } ? 0 : 1)
    }
}
