import AppKit
import CompanionCore

// borderless 的 NSPanel 默认不能成为 key window，
// 不覆写的话输入框点进去也打不了字。
final class PetPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
}

@MainActor
final class PetAppDelegate: NSObject, NSApplicationDelegate {
    let controller = PetController()
    private var statusItem: NSStatusItem?

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        controller.show()
        installStatusItem()
    }

    private func installStatusItem() {
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        item.button?.image = NSImage(systemSymbolName: "sparkles", accessibilityDescription: "桌宠")
        let menu = NSMenu()
        let show = NSMenuItem(title: "显示 / 隐藏桌宠", action: #selector(toggle), keyEquivalent: "")
        show.target = self
        menu.addItem(show)
        let mic = NSMenuItem(title: "用嘴说…", action: #selector(startMic), keyEquivalent: "")
        mic.target = self
        menu.addItem(mic)
        let album = NSMenuItem(title: "相册…", action: #selector(openAlbum), keyEquivalent: "")
        album.target = self
        menu.addItem(album)
        let story = NSMenuItem(title: "剧情…", action: #selector(openStory), keyEquivalent: "")
        story.target = self
        menu.addItem(story)
        let settings = NSMenuItem(title: "设置…", action: #selector(openSettings), keyEquivalent: ",")
        settings.target = self
        menu.addItem(settings)
        menu.addItem(.separator())
        let quit = NSMenuItem(title: "退出", action: #selector(quit), keyEquivalent: "q")
        quit.target = self
        menu.addItem(quit)
        item.menu = menu
        statusItem = item
    }

    @objc private func toggle() { controller.toggle() }
    @objc private func startMic() { controller.toggleMic() }
    @objc private func openAlbum() { controller.openAlbum() }
    @objc private func openStory() { controller.openStory() }

    @objc private func openSettings() {
        PetSettingsWindow.shared.present(store: try? LocalStore())
    }

    @objc private func quit() { NSApp.terminate(nil) }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        controller.show()
        return true
    }
    func applicationWillTerminate(_ notification: Notification) { controller.stop() }
}

/// 无头自检：走一遍 启动 → 点击 → 输入 → 回复，把每一步的真实状态写进 JSON。
@MainActor
enum PetSelfTest {
    /// 递归把 NaN / inf 换成 0：JSON 写不了这两个值，遇到就整段崩掉。
    static func clean(_ value: Any) -> Any {
        switch value {
        case let number as Double: return number.isFinite ? number : 0
        case let number as Float: return number.isFinite ? Double(number) : 0
        case let list as [Double]: return list.map { $0.isFinite ? $0 : 0 }
        case let list as [Any]: return list.map { clean($0) }
        case let dict as [String: Any]: return dict.mapValues { clean($0) }
        default: return value
        }
    }

    static func run(controller: PetController) {
        let args = CommandLine.arguments
        let out = args.firstIndex(of: "--out").flatMap { index -> String? in
            args.indices.contains(index + 1) ? args[index + 1] : nil
        } ?? "/tmp/pet-selftest.json"
        let message = args.firstIndex(of: "--say").flatMap { index -> String? in
            args.indices.contains(index + 1) ? args[index + 1] : nil
        } ?? "你在看什么书"

        var records: [[String: Any]] = []
        func record(_ tag: String) {
            records.append(["tag": tag, "at": Date().timeIntervalSince1970, "state": controller.diagnostics])
        }

        DispatchQueue.main.asyncAfter(deadline: .now() + 3.0) {
            record("boot")
            controller.simulateTap()
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
                record("afterTap")
                controller.simulateOpenComposer()
                // 等一拍再看：makeKey / 交第一响应者都是下一轮 runloop 才生效，
                // 立刻读 window.key 会永远是 false，误判成“输入框打不了字”。
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) {
                    record("composerOpen")
                    controller.simulateSend(message)
                    DispatchQueue.main.asyncAfter(deadline: .now() + 8.0) {
                        record("afterReply")
                        // 再等一轮待机交接（idle-01 是 14 秒，交接点在 13.4 秒），
                        // 确认交叉淡化真的跑过、且两层不会同时为 0（那就是黑帧）。
                        DispatchQueue.main.asyncAfter(deadline: .now() + 7.5) {
                            record("idleSwap")
                            // 面板不截图，靠窗口标题和数量确认真的开出来了。
                            controller.openAlbum()
                            controller.openStory()
                            if CommandLine.arguments.contains("--story") {
                                controller.playFirstChapterForTest()
                            }
                            DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
                                record("panels")
                                // 剧情播放器要跑一会儿才看得到字幕和选择框，最后再记一笔。
                                DispatchQueue.main.asyncAfter(deadline: .now() + 5.2) {
                                    record("story")
                                    // JSON 序列化遇到 NaN / inf 会直接抛异常把进程带走，
                                    // 而 diagnostics 里有一堆 CGFloat / CMTime 派生值，
                                    // 没有 item 时就是 NaN。统一过一遍再写。
                                    let payload: [String: Any] = ["records": records.map { Self.clean($0) }]
                                    if let data = try? JSONSerialization.data(withJSONObject: payload,
                                                                              options: [.prettyPrinted, .sortedKeys]) {
                                        try? data.write(to: URL(fileURLWithPath: out))
                                    }
                                    NSApp.terminate(nil)
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

// 顶层代码在 Swift 5 语言模式下不带 MainActor 隔离，
// 而 NSApplication / PetController 都是主线程隔离的，这里显式声明一次。
MainActor.assumeIsolated {
    // 走 `open` 启动时环境变量不会带进来，所以数据目录和素材目录
    // 也要能用命令行参数指定，自检和换素材包都靠它。
    let argv = CommandLine.arguments
    func value(after flag: String) -> String? {
        guard let index = argv.firstIndex(of: flag), argv.indices.contains(index + 1) else { return nil }
        return argv[index + 1]
    }
    if let data = value(after: "--data") { setenv("LINGDESK_DATA_DIR", data, 1) }
    if let assets = value(after: "--assets") { setenv("LINGDESK_PET_ASSETS", assets, 1) }
    // Diagnostics print as they go. With block buffering an abort loses every
    // line printed so far, which turns a crash into a silent no-output mystery.
    setvbuf(stdout, nil, _IONBF, 0)

    let app = NSApplication.shared
    let delegate = PetAppDelegate()
    app.delegate = delegate
    if argv.contains("--selftest") {
        PetSelfTest.run(controller: delegate.controller)
    }
    // Start the TTS worker in the background regardless of mode. It used to be
    // skipped for --selftest, which meant the selftest always measured the
    // *cold* path (worker loading ~2.4 GB) while a real user hits the warm one.
    // The two are not the same thing, and only one of them is what people feel.
    DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) {
        delegate.controller.warmSpeech()
    }
    // `--say "台词"`：只走一次语音，把实际用上的引擎打出来。
    // 语音依赖外部 worker，靠聊天回复去间接触发太慢也太脆，单独给个入口。
    if let text = value(after: "--say") {
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
            delegate.controller.simulateSpeak(text)
            // 26s, not 12: Qwen3 loads ~2.4 GB on first use and needs about 13s
            // before it makes a sound. Measuring at 12s reads "none" and looks
            // like a failure when it is just cold-start.
            DispatchQueue.main.asyncAfter(deadline: .now() + 26.0) {
                let info = delegate.controller.diagnostics
                // python / model 是「用的是谁家的解释器和哪份权重」。engine 对了但路径
                // 指着别的项目，换台机器就散架——这两条是给 check-whale-voice.sh 看的。
                let out: [String: Any] = [
                    "backend": info["speech.backend"] ?? NSNull(),
                    "voice": info["speech.voice"] ?? NSNull(),
                    "engine": info["speech.engine"] ?? NSNull(),
                    "python": info["speech.python"] ?? NSNull(),
                    "model": info["speech.model"] ?? NSNull(),
                ]
                if let data = try? JSONSerialization.data(withJSONObject: PetSelfTest.clean(out),
                                                          options: [.sortedKeys]) {
                    FileHandle.standardOutput.write(data)
                    FileHandle.standardOutput.write("\n".data(using: .utf8)!)
                }
                NSApp.terminate(nil)
            }
        }
    }
    // `--check-assets`：只验「素材坏了会怎样」，不等聊天和语音。
    // 3 秒足够跑完 启动 → 加载待机 → 塞一个缺失的动作素材。
    // 打印的是诊断字段里能直接判真假的那几项，脚本据此判断有没有静默黑屏。
    if argv.contains("--check-assets") {
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) {
            delegate.controller.probeMissingAction()
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 3.2) {
            let info = delegate.controller.diagnostics
            let keys = ["idle.health", "idle.error", "idle.status", "idle.swaps",
                        "idle.opacities", "action.opacity", "bubble.last",
                        "character.video", "character.reaction", "character.reactionPending",
                        "sleep.scene"]
            var out: [String: Any] = [:]
            for key in keys { out[key] = info[key] ?? NSNull() }
            if let data = try? JSONSerialization.data(withJSONObject: PetSelfTest.clean(out),
                                                      options: [.sortedKeys]) {
                FileHandle.standardOutput.write(data)
                FileHandle.standardOutput.write("\n".data(using: .utf8)!)
            }
            NSApp.terminate(nil)
        }
    }
    // `--check-song`：用正式内容包真播一遍歌，看时间码和歌词有没有往前走。
    // 和 check-whale-songs.sh 的区别是那个跑的是临时夹具包；这里验的是
    // assets/whale-video-test/pack.json 里真实登记的那首。
    if argv.contains("--check-song") {
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
            if let song = delegate.controller.nextSong() {
                delegate.controller.sing(song)
            }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 4.0) {
            let info = delegate.controller.diagnostics
            let keys = ["song.count", "song.playing", "song.title", "song.duration",
                        "song.position", "song.line", "song.lineText", "song.error"]
            var out: [String: Any] = [:]
            for key in keys { out[key] = info[key] ?? NSNull() }
            if let data = try? JSONSerialization.data(withJSONObject: PetSelfTest.clean(out),
                                                      options: [.sortedKeys]) {
                FileHandle.standardOutput.write(data)
                FileHandle.standardOutput.write("\n".data(using: .utf8)!)
            }
            NSApp.terminate(nil)
        }
    }
    // `--listen [秒数]`：请求麦克风权限、听一小段、把识别结果打出来。
    // 语音识别要用户授权，没法在无头自检里验证，只能给一个真跑一遍的入口。
    if argv.contains("--listen") {
        let seconds = Double(value(after: "--listen") ?? "8") ?? 8
        let wake = argv.contains("--wake")
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
            delegate.controller.listenForTest(seconds: seconds, wake: wake,
                                              outPath: value(after: "--out"))
            // Generous: the permission prompt may need a human click, and the
            // request itself times out at 25s. Cutting this short turns
            // "waiting for the user" into "silently killed with no output".
            DispatchQueue.main.asyncAfter(deadline: .now() + seconds + 34.0) {
                NSApp.terminate(nil)
            }
        }
    }
    app.run()
}
