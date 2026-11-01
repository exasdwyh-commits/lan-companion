import AppKit
import AVFoundation
@main struct WhaleReactionChecks {
    @MainActor static func main() async throws {
        NSApplication.shared.setActivationPolicy(.accessory)
        let root = URL(fileURLWithPath: CommandLine.arguments[1])
        let view = StageView(frame: NSRect(x: 0, y: 0, width: 640, height: 360))
        let window = NSWindow(contentRect: view.frame, styleMask: [.borderless], backing: .buffered, defer: false)
        window.contentView = view
        window.orderFrontRegardless()
        var checks: [String: Bool] = [:]
        func wait(_ seconds: Double) async { try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000)) }
        checks["background"] = view.loadBackground(root.appendingPathComponent("background.png"))
        checks["idle_character"] = view.loadCharacter(root.appendingPathComponent("idle-matched.mov"), alignReactions: true)
        view.layoutSubtreeIfNeeded()
        view.setScenePaused(false)
        await wait(0.8)
        let frame = view.characterFrame
        checks["start_reaction"] = view.playCharacterReaction(root.appendingPathComponent("touch-matched.mov"))
        await wait(0.1)
        checks["pending_keeps_idle_moving"] = view.reactionPending && view.characterRate > 0 && view.reactionRate == 0
        view.setScenePaused(true)
        await wait(0.1)
        checks["pending_stays_paused_when_hidden"] = view.reactionPending && view.characterRate == 0 && view.reactionRate == 0
        view.setScenePaused(false)
        await wait(2.4)
        checks["entry_at_loop_anchor"] = view.lastReactionEntryIdleTime < 1.0 / 24 || view.lastReactionEntryIdleTime >= view.lastReactionEntryIdleDuration - 1.0 / 24
        checks["wait_within_one_idle_cycle_plus_decode"] = view.lastReactionWaitSeconds < 2.3
        checks["reaction_visible_instead_of_idle"] = view.reactionVisible && view.reactionRate > 0
        checks["repeat_tap_does_not_restart"] = !view.playCharacterReaction(root.appendingPathComponent("touch-matched.mov"))
        checks["placement_kept"] = frame == view.characterFrame
        checks["idle_anchor_held_during_reaction"] = view.characterRate == 0 && view.characterTime < 0.05
        view.setScenePaused(true)
        await wait(0.2)
        checks["hidden_pauses_reaction"] = view.reactionRate == 0 && view.reactionPlaying
        view.setScenePaused(false)
        await wait(0.3)
        checks["show_resumes_reaction"] = view.reactionRate > 0
        await wait(7.7)
        checks["completion_restores_idle"] = !view.reactionPlaying && !view.reactionVisible && view.characterRate > 0
        checks["can_trigger_again"] = view.playCharacterReaction(root.appendingPathComponent("touch-matched.mov"))
        view.setScenePaused(true)
        let data = try JSONSerialization.data(withJSONObject: checks, options: [.prettyPrinted, .sortedKeys])
        print(String(decoding: data, as: UTF8.self))
        try data.write(to: URL(fileURLWithPath: CommandLine.arguments[2]))
        window.orderOut(nil)
        if checks.values.contains(false) { exit(1) }
    }
}
