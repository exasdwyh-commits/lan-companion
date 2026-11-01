import AppKit
import CompanionCore

// MARK: - 桌宠自己的设置面板
//
// 主程序那套设置界面在 SwiftUI 里，这台机器的工具链重编不了它；
// 桌宠要能独立填端点、密钥和角色设定，所以自带一个 AppKit 面板。

@MainActor
final class PetSettingsWindow {
    static let shared = PetSettingsWindow()

    private var window: NSWindow?
    private var urlField: NSTextField!
    private var modelField: NSTextField!
    private var keyField: NSSecureTextField!
    private var personaView: NSTextView!
    private var statusLabel: NSTextField!
    private var presetButton: NSPopUpButton!
    private var store: LocalStore?

    private let presets: [(String, String, String)] = [
        ("DeepSeek", "https://api.deepseek.com/v1", "deepseek-chat"),
        ("OpenRouter", "https://openrouter.ai/api/v1", ""),
        ("本机 Ollama", "http://127.0.0.1:11434/v1", "qwen3:8b"),
        ("本机 vLLM / Hermes", "http://127.0.0.1:8000/v1", ""),
        ("保持当前", "", ""),
    ]

    func present(store: LocalStore?) {
        self.store = store
        if window == nil { build() }
        load()
        window?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    private func build() {
        let rect = NSRect(x: 0, y: 0, width: 540, height: 430)
        let panel = NSWindow(contentRect: rect,
                             styleMask: [.titled, .closable], backing: .buffered, defer: false)
        panel.title = "桌宠设置"
        panel.isReleasedWhenClosed = false
        panel.center()

        let container = NSView(frame: rect)
        var y = rect.height - 46

        func label(_ text: String, at y: CGFloat) -> NSTextField {
            let field = NSTextField(labelWithString: text)
            field.frame = NSRect(x: 20, y: y, width: 100, height: 18)
            field.font = .systemFont(ofSize: 12)
            field.textColor = .secondaryLabelColor
            container.addSubview(field)
            return field
        }

        presetButton = NSPopUpButton(frame: NSRect(x: 130, y: y - 2, width: 200, height: 24))
        presetButton.addItems(withTitles: presets.map { $0.0 })
        presetButton.target = self
        presetButton.action = #selector(presetChanged)
        container.addSubview(presetButton)
        _ = label("快速填入", at: y + 4)
        y -= 42

        urlField = NSTextField(frame: NSRect(x: 130, y: y, width: 390, height: 24))
        container.addSubview(urlField)
        _ = label("服务地址", at: y + 4)
        y -= 42

        modelField = NSTextField(frame: NSRect(x: 130, y: y, width: 390, height: 24))
        container.addSubview(modelField)
        _ = label("模型名称", at: y + 4)
        y -= 42

        keyField = NSSecureTextField(frame: NSRect(x: 130, y: y, width: 390, height: 24))
        keyField.placeholderString = "本机服务可留空"
        container.addSubview(keyField)
        _ = label("API Key", at: y + 4)
        y -= 34

        _ = label("角色设定", at: y + 4)
        y -= 8
        let scroll = NSScrollView(frame: NSRect(x: 20, y: y - 96, width: 500, height: 100))
        scroll.hasVerticalScroller = true
        scroll.borderType = .bezelBorder
        personaView = NSTextView(frame: NSRect(x: 0, y: 0, width: 500, height: 100))
        personaView.isRichText = false
        personaView.font = .systemFont(ofSize: 12)
        scroll.documentView = personaView
        container.addSubview(scroll)
        y -= 116

        statusLabel = NSTextField(labelWithString: "")
        statusLabel.frame = NSRect(x: 20, y: y - 22, width: 500, height: 32)
        statusLabel.font = .systemFont(ofSize: 11)
        statusLabel.textColor = .secondaryLabelColor
        statusLabel.lineBreakMode = .byTruncatingTail
        container.addSubview(statusLabel)

        let testButton = NSButton(title: "测试连接", target: self, action: #selector(testConnection))
        testButton.bezelStyle = .rounded
        testButton.frame = NSRect(x: 20, y: 16, width: 92, height: 28)
        container.addSubview(testButton)

        let cancelButton = NSButton(title: "取消", target: self, action: #selector(close))
        cancelButton.bezelStyle = .rounded
        cancelButton.keyEquivalent = "\u{1b}"
        cancelButton.frame = NSRect(x: 348, y: 16, width: 84, height: 28)
        container.addSubview(cancelButton)

        let saveButton = NSButton(title: "保存", target: self, action: #selector(save))
        saveButton.bezelStyle = .rounded
        saveButton.keyEquivalent = "\r"
        saveButton.frame = NSRect(x: 436, y: 16, width: 84, height: 28)
        container.addSubview(saveButton)

        panel.contentView = container
        window = panel
    }

    private func load() {
        let config = (try? store?.load(Settings.self, file: "settings.json", fallback: Settings())) ?? Settings()
        urlField.stringValue = config.baseURL
        modelField.stringValue = config.model
        keyField.stringValue = config.apiKey
        personaView.string = config.persona
        presetButton.selectItem(at: presets.count - 1)
        statusLabel.stringValue = "密钥只写进本机的 settings.json（权限 0600）。"
    }

    private func currentSettings() -> Settings {
        var config = (try? store?.load(Settings.self, file: "settings.json", fallback: Settings())) ?? Settings()
        config.baseURL = urlField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        config.model = modelField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        config.apiKey = keyField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        let persona = personaView.string.trimmingCharacters(in: .whitespacesAndNewlines)
        if !persona.isEmpty { config.persona = persona }
        return config
    }

    @objc private func presetChanged() {
        let index = presetButton.indexOfSelectedItem
        guard presets.indices.contains(index) else { return }
        let (name, url, model) = presets[index]
        guard name != "保持当前" else { return }
        urlField.stringValue = url
        if !model.isEmpty { modelField.stringValue = model }
        statusLabel.stringValue = "已填好 \(name) 的地址，模型名按你的账号填。"
    }

    @objc private func testConnection() {
        let config = currentSettings()
        do { _ = try config.endpoint("models") }
        catch { statusLabel.stringValue = error.localizedDescription; return }
        statusLabel.stringValue = "正在连接…"
        Task { [weak self] in
            guard let self else { return }
            do {
                let models = try await LocalModelClient().models(settings: config)
                let preview = models.prefix(6).joined(separator: "、")
                self.statusLabel.stringValue = models.isEmpty
                    ? "连上了，但服务没有列出模型。"
                    : "连上了。可用：\(preview)\(models.count > 6 ? " …" : "")"
            } catch {
                self.statusLabel.stringValue = "没连上：\(error.localizedDescription)"
            }
        }
    }

    @objc private func save() {
        let config = currentSettings()
        do {
            _ = try config.endpoint("chat/completions")
            try store?.save(config, file: "settings.json")
            statusLabel.stringValue = "已保存。"
            window?.close()
        } catch {
            statusLabel.stringValue = "保存失败：\(error.localizedDescription)"
        }
    }

    @objc private func close() { window?.close() }
}
