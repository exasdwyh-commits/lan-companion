import AppKit
import CompanionCore

final class PetPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
}

@main struct PetModeChecks {
    @MainActor static func main() async throws {
        let args = CommandLine.arguments
        setenv("LINGDESK_DATA_DIR", args[1], 1)
        setenv("LINGDESK_PET_ASSETS", args[2], 1)
        NSApplication.shared.setActivationPolicy(.accessory)
        var config = Settings(); config.speakReplies = false
        try LocalStore().save(config, file: "settings.json")
        let controller = PetController()
        var checks: [String: Bool] = [:]
        func wait(_ seconds: Double) async { try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000)) }
        func flag(_ key: String) -> Bool { controller.diagnostics[key] as? Bool ?? false }
        func rate(_ key: String) -> Double { controller.diagnostics[key] as? Double ?? 0 }
        controller.show(); await wait(0.8)
        let normalFrame = controller.diagnostics["character.frame"] as? String
        checks["normal_boot"] = flag("character.loaded") && !flag("quiet") && !flag("asleep")
        controller.simulateInactivity(61); await wait(0.8)
        checks["quiet_after_one_minute"] = flag("quiet") && !flag("asleep") && rate("character.rate") > 0
        controller.simulateTap(); await wait(0.3)
        checks["quiet_tap_keeps_pose"] = flag("quiet") && !flag("character.reaction")
        controller.simulateInactivity(301); await wait(1.2)
        checks["sleep_after_five_minutes"] = flag("asleep") && flag("sleep.scene") && rate("sleep.rate") > 0
        checks["sleep_pauses_hidden_character"] = rate("character.rate") == 0
        controller.hide(); await wait(0.2)
        checks["hide_pauses_sleep"] = rate("sleep.rate") == 0
        controller.show(); await wait(0.4)
        checks["show_keeps_sleep_state"] = flag("asleep") && flag("sleep.scene") && rate("sleep.rate") > 0
        await wait(10.2)
        checks["sleep_still_playing_after_loop"] = flag("asleep") && rate("sleep.rate") > 0
        controller.simulateTap(); await wait(0.4)
        checks["tap_wakes"] = !flag("asleep") && !flag("sleep.scene") && rate("sleep.rate") == 0
        checks["wake_restores_quiet_character"] = flag("quiet") && rate("character.rate") > 0
        controller.returnToNormalMode(); await wait(0.4)
        checks["normal_restored"] = !flag("quiet") && rate("character.rate") > 0
        checks["normal_placement_restored"] = (controller.diagnostics["character.frame"] as? String) == normalFrame
        controller.enterSleep(); await wait(0.5)
        controller.simulateOpenComposer(); await wait(0.3)
        checks["composer_wakes_sleep"] = !flag("asleep") && !flag("sleep.scene") && flag("composer")
        controller.hide()
        let data = try JSONSerialization.data(withJSONObject: checks, options: [.prettyPrinted,.sortedKeys])
        try data.write(to: URL(fileURLWithPath: args[3]))
        print(String(decoding: data, as: UTF8.self))
        if checks.values.contains(false) { exit(1) }
    }
}
