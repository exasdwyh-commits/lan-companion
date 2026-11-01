import AppKit
import SwiftUI
import CompanionCore

struct SceneCanvas: View {
    @ObservedObject var model: CompanionModel
    var wallpaper = false
    var body: some View {
        ZStack {
            Color(red: 0.10, green: 0.15, blue: 0.14)
            if model.replyPlaying || (model.asset(.idle) != nil && (!model.settings.staticScene || model.asset(.portrait) == nil)) {
                PlayerSurface(player: wallpaper ? model.scene.player : model.scene.previewPlayer)
            } else if let url = model.asset(.portrait), let image = NSImage(contentsOf: url) {
                Image(nsImage: image).resizable().scaledToFit()
            } else if !wallpaper {
                VStack(spacing: 16) {
                    Image(systemName: "person.crop.rectangle").font(.system(size: 42, weight: .ultraLight))
                    Text("留一个位置，等她到来").font(.title3)
                    Text("导入 Muse 制作的主图与视频\n这里才会出现你的角色，不使用假人占位。")
                        .font(.callout).multilineTextAlignment(.center).lineSpacing(5)
                    Button("导入角色素材…") { model.importAssets() }.disabled(model.importing)
                }.foregroundStyle(.white.opacity(0.9)).padding(28)
            }
        }.accessibilityLabel(wallpaper ? "角色桌面背景" : "角色素材预览")
    }
}

struct CompanionView: View {
    @ObservedObject var model: CompanionModel
    @FocusState private var inputFocused: Bool
    var body: some View {
        HSplitView {
            VStack(alignment: .leading, spacing: 18) {
                HStack {
                    Text("灵伴").font(.system(size: 28, weight: .medium))
                    Spacer()
                    Text("本机运行").font(.caption).foregroundStyle(.secondary)
                }
                Text("一个安静的桌面伙伴").foregroundStyle(.secondary)
                SceneCanvas(model: model).aspectRatio(16 / 10, contentMode: .fit)
                    .clipShape(RoundedRectangle(cornerRadius: 14))
                HStack {
                    Button(model.desktopEnabled ? "关闭桌面场景" : "开启桌面场景", systemImage: "desktopcomputer") { model.toggleDesktop() }
                        .disabled(!model.hasScene)
                    Spacer()
                    Button(model.paused ? "恢复陪伴" : "暂停陪伴", systemImage: model.paused ? "play" : "pause") { model.togglePause() }
                }
                Label(model.status, systemImage: model.busy ? "ellipsis.bubble" : "leaf")
                    .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                Label(model.engineStatus, systemImage: "waveform")
                    .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                Divider()
                Text("角色素材").font(.headline)
                ForEach([AssetSlot.portrait, .idle, .talk], id: \.self) { slot in
                    HStack {
                        Image(systemName: model.asset(slot) == nil ? "circle" : "checkmark.circle.fill")
                            .foregroundStyle(model.asset(slot) == nil ? Color.secondary : Color.accentColor)
                        Text(slot.label)
                        Spacer()
                        Text(model.asset(slot) == nil ? "待导入" : "已导入").font(.caption).foregroundStyle(.secondary)
                    }
                }
                HStack {
                    Button(model.importing ? "正在检查素材…" : "导入文件夹…") { model.importAssets() }.disabled(model.importing)
                    Button("设置…") { model.showingSettings = true }
                }
                Text("待机片段静音循环；回复由本地引擎生成带口型的视频后整段播放。\n桌面层不接收鼠标点击，退出后恢复原桌面。")
                    .font(.caption).foregroundStyle(.secondary).lineSpacing(4)
                Spacer(minLength: 0)
            }.padding(24).frame(minWidth: 350, idealWidth: 400, maxWidth: 470)

            VStack(spacing: 0) {
                HStack {
                    Text("说说今天的事").font(.title3).fontWeight(.medium)
                    Spacer()
                    Menu {
                        Button("重新生成口型") {
                            if let reply = model.lastReply { model.renderReply(reply) }
                        }.disabled(model.lastReply == nil || model.paused)
                        Button("系统语音朗读上一条") {
                            if let reply = model.lastReply { model.speak(reply.content) }
                        }.disabled(model.lastReply == nil || model.paused)
                        Button("连接口型引擎") { model.ensureEngine() }
                        Divider()
                        Button("打开本地数据") { model.openData() }
                        Button("开始新对话…") { model.clearHistory() }
                    } label: { Image(systemName: "ellipsis.circle").accessibilityLabel("口型与本地数据") }
                    .menuStyle(.borderlessButton).frame(width: 24)
                }.padding(24)
                Divider()
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 18) {
                            if model.messages.isEmpty {
                                VStack(alignment: .leading, spacing: 12) {
                                    Text("从一句问候开始").font(.headline)
                                    Text("先在设置里连接本地模型。聊天记录只保存在这台 Mac；未接通模型时，不会用预设台词冒充回复。")
                                        .foregroundStyle(.secondary).lineSpacing(5)
                                    Button("检查本地模型") { model.showingSettings = true }
                                }.padding(.vertical, 28)
                            }
                            ForEach(model.messages) { message in
                                VStack(alignment: .leading, spacing: 7) {
                                    Text(message.role == "user" ? "你" : "灵儿").font(.caption).foregroundStyle(.secondary)
                                    Text(message.content).textSelection(.enabled).lineSpacing(5)
                                }.padding(14).frame(maxWidth: .infinity, alignment: .leading)
                                    .background(message.role == "user" ? Color.accentColor.opacity(0.07) : Color.primary.opacity(0.035))
                                    .clipShape(RoundedRectangle(cornerRadius: 12)).id(message.id)
                            }
                            if model.busy { HStack { ProgressView().controlSize(.small); Text("想一想…可以随时停止").foregroundStyle(.secondary) } }
                            Color.clear.frame(height: 1).id("bottom")
                        }.padding(20)
                    }.onChange(of: model.messages.count) { proxy.scrollTo("bottom", anchor: .bottom) }
                }
                if let error = model.error {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(error).font(.callout).textSelection(.enabled)
                        HStack {
                            if model.messages.last?.role == "user", !model.busy {
                                Button("重试回复") { model.retry() }.disabled(model.paused)
                            }
                            Button("知道了") { model.error = nil }
                        }
                    }.padding(14).frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color.orange.opacity(0.12))
                }
                Divider()
                VStack(alignment: .leading, spacing: 10) {
                    HStack(alignment: .bottom) {
                        TextField(model.paused ? "恢复陪伴后再发送" : "和她说句话…", text: $model.input, axis: .vertical)
                            .textFieldStyle(.plain).lineLimit(1...5).focused($inputFocused)
                            .onSubmit { model.send() }.disabled(model.paused)
                            .accessibilityLabel("聊天输入")
                        Button("发送") { model.send() }.buttonStyle(.borderedProminent)
                            .disabled(model.paused || model.input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                    HStack {
                        Text("文字对话 · 系统语音可在设置关闭").font(.caption).foregroundStyle(.secondary)
                        Spacer()
                        Button("停止") { model.cancel() }.keyboardShortcut(.escape, modifiers: [])
                    }
                }.padding(20)
            }.frame(minWidth: 370, maxWidth: .infinity)
        }.frame(minWidth: 800, minHeight: 630)
            .tint(Color(red: 0.22, green: 0.45, blue: 0.38))
            .sheet(isPresented: $model.showingSettings) { SettingsView(model: model) }
            .onAppear { inputFocused = true }
    }
}

@MainActor
final class SettingsDraft: ObservableObject {
    @Published var value: CompanionCore.Settings
    @Published var error: String?
    init(_ value: CompanionCore.Settings) { self.value = value }
}

struct SettingsView: View {
    @ObservedObject var model: CompanionModel
    @StateObject private var form: SettingsDraft
    init(model: CompanionModel) { self.model = model; _form = StateObject(wrappedValue: SettingsDraft(model.settings)) }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("让她在本机运行").font(.title2)
            Text("连接已启动的 Ollama / MLX-LM OpenAI 兼容服务，不填写 API Key，也不会自动下载模型。")
                .foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            Form {
                TextField("服务地址", text: $form.value.baseURL)
                TextField("模型名称", text: $form.value.model)
                VStack(alignment: .leading) {
                    Text("角色设定")
                    TextEditor(text: $form.value.persona).frame(height: 95).border(Color.secondary.opacity(0.2))
                }
                Toggle("使用 Mac 系统语音朗读回复", isOn: $form.value.speakReplies)
                    .disabled(form.value.useEngine)
                Toggle("静态场景 / 减少动态效果", isOn: $form.value.staticScene)
                Toggle("用本地引擎生成口型", isOn: $form.value.useEngine)
                if form.value.useEngine {
                    TextField("引擎角色标识", text: $form.value.engineAvatar)
                    Picker("音色引擎", selection: Binding(
                        get: { form.value.engineTTS },
                        set: { next in
                            form.value.engineTTS = next
                            // 两套引擎的音色名互不通用，换引擎必须同时换音色，
                            // 否则会把系统的 Tingting 丢给 edge，合成失败还没有报错。
                            if !Settings.voiceBelongs(form.value.engineVoice, to: next) {
                                form.value.engineVoice = Settings.defaultVoice(for: next)
                            }
                        })) {
                            Text("微软神经语音（需联网）").tag("edgetts")
                            Text("macOS 系统语音").tag("saytts")
                        }
                    Picker("音色", selection: $form.value.engineVoice) {
                        ForEach(Settings.voices[form.value.engineTTS] ?? [], id: \.id) { voice in
                            Text(voice.label).tag(voice.id)
                        }
                    }
                    Text(form.value.engineTTS == "edgetts"
                         ? "神经语音需要联网（免费、无需密钥），一句话约 1 秒合成。"
                         : "系统语音完全离线，但音质偏机械。")
                        .font(.caption).foregroundStyle(.secondary)
                }
                TextField("引擎地址", text: Binding(
                    get: { form.value.engineBaseURL ?? "" },
                    set: { form.value.engineBaseURL = $0 }))
                TextField("桥脚本路径（留空自动推断）", text: Binding(
                    get: { form.value.engineScript ?? "" },
                    set: { form.value.engineScript = $0.isEmpty ? nil : $0 }))
                TextField("引擎 Python 路径（留空自动推断）", text: Binding(
                    get: { form.value.enginePython ?? "" },
                    set: { form.value.enginePython = $0.isEmpty ? nil : $0 }))
            }
            Text("开启引擎后，回复会由 LiveTalking 生成带口型的视频再播放，因此不再用系统语音朗读。语音输入、长期记忆尚未接入；上下文使用最近 24 条对话。")
                .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            if let error = form.error { Text(error).foregroundStyle(.red).font(.callout) }
            Text(model.connectionStatus).font(.caption).textSelection(.enabled)
            HStack {
                Button("保存并检测") {
                    apply(close: false)
                    if form.error == nil { model.checkConnection() }
                }.disabled(model.checkingConnection)
                Button("本地数据") { model.openData() }
                Spacer()
                Button("取消") { model.showingSettings = false }.keyboardShortcut(.cancelAction)
                Button("保存") { apply(close: true) }.keyboardShortcut(.defaultAction)
            }
        }.padding(28).frame(width: 590)
    }

    private func apply(close: Bool) {
        do {
            _ = try form.value.endpoint("models")
            try EnginePaths.validateBaseURL(form.value.engineBaseURL ?? "http://127.0.0.1:8010")
            form.error = nil
            model.cancel(silent: true)
            model.settings = form.value; model.persist(); model.showIdle()
            if form.value.useEngine { model.ensureEngine() } else { model.engine.stop() }
            if close { model.showingSettings = false }
        } catch { form.error = error.localizedDescription }
    }
}
