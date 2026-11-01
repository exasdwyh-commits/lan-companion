import AppKit
import SwiftUI

@main
struct LingDeskApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var delegate
    var body: some Scene { Settings { EmptyView() } }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private let model = CompanionModel()
    private var window: NSWindow!
    private var statusItem: NSStatusItem!
    private var observers: [NSObjectProtocol] = []

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 960, height: 720),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "灵伴 · 本地桌面陪伴"
        window.minSize = NSSize(width: 820, height: 660)
        window.isReleasedWhenClosed = false
        window.contentView = NSHostingView(rootView: CompanionView(model: model))
        window.center()
        installMenus()
        showWindow()
        observers.append(NotificationCenter.default.addObserver(forName: NSApplication.didChangeScreenParametersNotification,
                                                               object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in guard let self else { return }; self.model.scene.refreshScreen(model: self.model) }
        })
        let workspace = NSWorkspace.shared.notificationCenter
        observers.append(workspace.addObserver(forName: NSWorkspace.willSleepNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in guard let self else { return }; self.model.cancel(silent: true); self.model.scene.setPaused(true) }
        })
        observers.append(workspace.addObserver(forName: NSWorkspace.didWakeNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.model.showIdle() }
        })
        // 引擎冷启动要加载模型，20–40 秒。趁用户还没打字先并行预热，
        // 否则第一条消息要干等半分钟，看起来像卡住。模型可用性也一并探掉。
        model.ensureEngine()
        model.checkConnection()
    }

    private func item(_ title: String, _ action: Selector, key: String = "") -> NSMenuItem {
        let item = NSMenuItem(title: title, action: action, keyEquivalent: key); item.target = self; return item
    }

    private func installMenus() {
        let menu = NSMenu()
        menu.addItem(item("打开灵伴", #selector(showWindow), key: "0"))
        menu.addItem(item("设置…", #selector(settings), key: ","))
        menu.addItem(item("暂停 / 恢复陪伴", #selector(togglePause)))
        menu.addItem(item("关闭 / 开启桌面场景", #selector(toggleDesktop)))
        menu.addItem(.separator())
        menu.addItem(item("退出灵伴", #selector(quit), key: "q"))
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        statusItem.button?.image = NSImage(systemSymbolName: "leaf", accessibilityDescription: "灵伴")
        statusItem.menu = menu
        let root = NSMenu()
        let appItem = NSMenuItem(); appItem.submenu = menu.copy() as? NSMenu; root.addItem(appItem)
        let edit = NSMenuItem(title: "编辑", action: nil, keyEquivalent: "")
        let editMenu = NSMenu(title: "编辑")
        for (title, selector, key) in [("撤销", "undo:", "z"), ("剪切", "cut:", "x"), ("复制", "copy:", "c"), ("粘贴", "paste:", "v"), ("全选", "selectAll:", "a")] {
            editMenu.addItem(NSMenuItem(title: title, action: Selector(selector), keyEquivalent: key))
        }
        edit.submenu = editMenu; root.addItem(edit); NSApp.mainMenu = root
    }

    @objc func showWindow() { window.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true) }
    @objc func settings() { showWindow(); model.showingSettings = true }
    @objc func togglePause() { model.togglePause() }
    @objc func toggleDesktop() { model.toggleDesktop() }
    @objc func quit() { NSApp.terminate(nil) }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool { showWindow(); return true }
    func applicationWillTerminate(_ notification: Notification) { model.shutdown(); model.scene.hideDesktop(); model.persist() }
}
