import Foundation

public struct CompanionError: LocalizedError {
    public let message: String
    public init(_ message: String) { self.message = message }
    public var errorDescription: String? { message }
}

public struct Settings: Codable, Equatable {
    public var baseURL = "http://127.0.0.1:11434/v1"
    public var model = "qwen3:8b"
    /// 远程服务的密钥。留空表示端点不需要鉴权（本地 Ollama / vLLM 常见）。
    /// 只存在本地 settings.json（0600），不会写进日志或对话记录。
    public var apiKey = ""
    public var persona = "你是住在桌面的 AI 伙伴灵儿。用自然、温暖、简短的中文聊天，每次通常一到三句话。明确自己是 AI，不编造记忆、现实行动或感知能力。"
    public var speakReplies = true
    public var staticScene = false
    public var packID: String?
    // 口型由本地 LiveTalking 引擎生成；这三个字段留空表示按仓库结构自动推断。
    public var engineBaseURL: String? = "http://127.0.0.1:8010"
    public var enginePython: String?
    public var engineScript: String?
    public var useEngine = true
    /// 引擎形象必须与素材包里那张脸是同一个，否则待机一张脸、说话另一张脸。
    public var engineAvatar = "desk_muse_1"
    /// 引擎 TTS 实现。`edgetts` 是微软神经语音，免费无需密钥；`saytts` 走 macOS 内置语音。
    /// 默认用系统语音离线运行；联网音色由用户主动选择。
    public var engineTTS = "saytts"
    /// 音色名。edgetts 用 `zh-CN-*-Neural`，saytts 用系统语音名。
    public var engineVoice = Settings.defaultVoice(for: "saytts")
    public init() {}

    /// 两套 TTS 的音色命名完全不同，切换引擎时必须跟着换，否则会把
    /// `zh-CN-XiaoxiaoNeural` 丢给 `say` 或把 `Tingting` 丢给 edge，两边都直接失败。
    public static let voices: [String: [(id: String, label: String)]] = [
        "edgetts": [
            ("zh-CN-XiaoxiaoNeural", "晓晓 · 温暖（推荐）"),
            ("zh-CN-XiaoyiNeural", "晓伊 · 活泼"),
            ("zh-CN-XiaobeiNeural", "晓北 · 幽默（东北口音）"),
            ("zh-CN-YunxiNeural", "云希 · 少年感（男）"),
        ],
        "saytts": [
            ("Tingting", "婷婷 · 系统语音"),
            ("Meijia", "美佳 · 系统语音"),
        ],
    ]

    public static func defaultVoice(for tts: String) -> String {
        voices[tts]?.first?.id ?? "zh-CN-XiaoxiaoNeural"
    }

    /// 音色是否属于这套 TTS。老的 settings.json 存的是 macOS 语音名，配上
    /// edgetts 会静默合成失败，所以切换/迁移时都要用它校验一次。
    public static func voiceBelongs(_ voice: String, to tts: String) -> Bool {
        guard let list = voices[tts] else { return true }
        return list.contains { $0.id == voice }
    }

    private enum CodingKeys: String, CodingKey {
        case baseURL, model, apiKey, persona, speakReplies, staticScene, packID
        case engineBaseURL, enginePython, engineScript, useEngine
        case engineAvatar, engineTTS, engineVoice
    }

    /// 手写解码：老版本 settings.json 里没有引擎字段，合成解码会因为缺 key 直接失败，
    /// 导致用户原有设置被整体丢弃。这里对每个字段都允许缺省。
    public init(from decoder: Decoder) throws {
        let fallback = Settings()
        let container = try decoder.container(keyedBy: CodingKeys.self)
        baseURL = try container.decodeIfPresent(String.self, forKey: .baseURL) ?? fallback.baseURL
        model = try container.decodeIfPresent(String.self, forKey: .model) ?? fallback.model
        apiKey = try container.decodeIfPresent(String.self, forKey: .apiKey) ?? fallback.apiKey
        persona = try container.decodeIfPresent(String.self, forKey: .persona) ?? fallback.persona
        speakReplies = try container.decodeIfPresent(Bool.self, forKey: .speakReplies) ?? fallback.speakReplies
        staticScene = try container.decodeIfPresent(Bool.self, forKey: .staticScene) ?? fallback.staticScene
        packID = try container.decodeIfPresent(String.self, forKey: .packID)
        engineBaseURL = try container.decodeIfPresent(String.self, forKey: .engineBaseURL) ?? fallback.engineBaseURL
        enginePython = try container.decodeIfPresent(String.self, forKey: .enginePython)
        engineScript = try container.decodeIfPresent(String.self, forKey: .engineScript)
        useEngine = try container.decodeIfPresent(Bool.self, forKey: .useEngine) ?? fallback.useEngine
        engineAvatar = try container.decodeIfPresent(String.self, forKey: .engineAvatar) ?? fallback.engineAvatar
        // 旧设置缺少 engineTTS 时采用系统语音；显式选择的联网音色继续保留。
        // 跨 TTS 的音色名不兼容，不能把 Tingting 传给 edge。
        let tts = try container.decodeIfPresent(String.self, forKey: .engineTTS) ?? fallback.engineTTS
        engineTTS = tts
        let storedVoice = try container.decodeIfPresent(String.self, forKey: .engineVoice)
        if let storedVoice, Self.voiceBelongs(storedVoice, to: tts) {
            engineVoice = storedVoice
        } else {
            engineVoice = Self.defaultVoice(for: tts)
        }
    }

    /// 端点是否为回环地址。本地服务不加鉴权、也不该走系统代理。
    public var isLocalEndpoint: Bool {
        guard let host = URLComponents(string: baseURL.trimmingCharacters(in: .whitespacesAndNewlines))?.host?.lowercased() else { return false }
        return ["127.0.0.1", "localhost", "::1", "[::1]"].contains(host)
    }

    /// OpenAI 兼容端点。既接受本机服务，也接受远程网关（DeepSeek / OpenRouter /
    /// 自建 vLLM 跑 Hermes 之类），因为它们的请求形状完全一致。
    /// 仍然拒绝把账号密码塞进 URL——那种写法会被原样带进日志。
    public func endpoint(_ resource: String) throws -> URL {
        let raw = baseURL.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let components = URLComponents(string: raw),
              let scheme = components.scheme?.lowercased(), ["http", "https"].contains(scheme),
              let host = components.host, !host.isEmpty,
              components.user == nil, components.password == nil,
              components.query == nil, components.fragment == nil,
              let url = components.url else {
            throw CompanionError("服务地址格式无效，例如 https://api.deepseek.com/v1 或 http://127.0.0.1:11434/v1。")
        }
        guard !model.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw CompanionError("请填写服务实际提供的模型名称。")
        }
        return url.appendingPathComponent(resource)
    }
}

public struct ChatMessage: Codable, Identifiable, Equatable {
    public let id: UUID
    public let role: String
    public let content: String
    public let date: Date
    public init(role: String, content: String, id: UUID = UUID()) {
        self.id = id; self.role = role; self.content = content; date = Date()
    }
}

public enum AssetSlot: String, CaseIterable, Codable {
    case portrait = "character-master.png"
    case idle = "idle-01.mp4"
    case talk = "talk-base-01.mp4"
    case listen = "listen-01.mp4"
    case think = "think-01.mp4"
    case smile = "smile-01.mp4"
    case greet = "greet-01.mp4"

    public var label: String {
        switch self {
        case .portrait: return "主形象"
        case .idle: return "待机"
        case .talk: return "口型底片"
        case .listen: return "倾听"
        case .think: return "思考"
        case .smile: return "微笑"
        case .greet: return "招呼"
        }
    }
}

/// One active reply. Cancellation/replacement invalidates every older completion.
public struct ReplyGate {
    public private(set) var current: UUID?
    public init() {}
    @discardableResult public mutating func begin() -> UUID {
        let id = UUID(); current = id; return id
    }
    public func accepts(_ id: UUID) -> Bool { current == id }
    public mutating func cancel() { current = nil }
}

public struct RenderJob: Codable {
    public var schema_version = 1
    public let reply_id: String
    public let text: String
    public let source_video: String
    public var audio = "speech.wav"
    public var output = "reply.mp4"
    public var tts = "macos-system"
    public init(reply: ChatMessage) {
        reply_id = reply.id.uuidString; text = reply.content; source_video = "source.mp4"
    }
}

public struct RenderResult: Codable {
    public let schema_version: Int
    public let reply_id: String
    public let video: String
    public let status: String
    public func videoURL(in folder: URL, expectedReply: UUID) throws -> URL {
        guard schema_version == 1, status == "complete", UUID(uuidString: reply_id) == expectedReply else {
            throw CompanionError("这段视频不属于当前回复，或任务尚未完成。旧回复视频不会覆盖当前对话。")
        }
        guard video == "reply.mp4" else { throw CompanionError("结果文件只接受任务目录内的 reply.mp4。") }
        let url = folder.appendingPathComponent(video)
        guard !((try? url.resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink) ?? true) else {
            throw CompanionError("回复视频不能是符号链接。")
        }
        return url
    }
}

/// 素材包显式绑定引擎角色，避免导入后沿用上一个人的口型资产。
public struct CharacterPackManifest: Codable {
    public let schema_version: Int
    public let engine_avatar: String
    public func validatedAvatar() throws -> String {
        guard schema_version == 1,
              engine_avatar.range(of: "^[A-Za-z0-9_-]{1,100}$", options: .regularExpression) != nil else {
            throw CompanionError("character.json 的引擎角色标识无效。")
        }
        return engine_avatar
    }
}
