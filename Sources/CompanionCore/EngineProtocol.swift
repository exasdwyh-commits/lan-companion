import Foundation

/// 发给桥进程的一条命令。桥只认 JSON 行，字段名与 `engine_bridge.py` 一一对应。
public struct EngineCommand: Encodable, Equatable {
    public let op: String
    public var id: String?
    public var text: String?
    public var out: String?

    public init(op: String, id: String? = nil, text: String? = nil, out: String? = nil) {
        self.op = op
        self.id = id
        self.text = text
        self.out = out
    }

    /// 必须是单行 JSON：桥按换行切分，缩进格式会被拆成半条消息。
    public func line() throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = []
        var data = try encoder.encode(self)
        data.append(0x0A)
        return data
    }
}

/// 桥回给桌面端的事件。字段按事件类型可选，缺字段不算错误。
public struct EngineEvent: Decodable, Equatable {
    public let event: String
    public let id: String?
    public let message: String?
    public let video: String?
    public let model: String?
    public let session: String?
    public let seconds: Double?
    public let stub: Bool?

    public init(event: String, id: String? = nil, message: String? = nil, video: String? = nil,
                model: String? = nil, session: String? = nil, seconds: Double? = nil, stub: Bool? = nil) {
        self.event = event; self.id = id; self.message = message; self.video = video
        self.model = model; self.session = session; self.seconds = seconds; self.stub = stub
    }

    public static func decode(_ line: String) -> EngineEvent? {
        guard let data = line.data(using: .utf8) else { return nil }
        return try? JSONDecoder().decode(EngineEvent.self, from: data)
    }
}

/// 定位桥所需的解释器与脚本。
///
/// 桥必须跑在 LiveTalking 的虚拟环境里（那里才有 aiortc），所以默认路径从应用包
/// 向上回溯找仓库根，不写死绝对路径，也不依赖当前工作目录。
public struct EnginePaths {
    public let python: String
    public let script: String
    public let baseURL: String

    public init(python: String, script: String, baseURL: String) {
        self.python = python; self.script = script; self.baseURL = baseURL
    }

    /// LiveTalking 仓库根。app.py 必须在它下面启动：模型与 config.yaml 都是相对路径。
    /// 解释器是 <root>/.venv/bin/python，往上退三级即根。
    public var liveTalking: String {
        URL(fileURLWithPath: python)
            .deletingLastPathComponent()   // .venv/bin
            .deletingLastPathComponent()   // .venv
            .deletingLastPathComponent()   // LiveTalking
            .path
    }

    public static func validateBaseURL(_ value: String) throws {
        guard let c = URLComponents(string: value), c.scheme == "http",
              ["localhost", "127.0.0.1", "[::1]", "::1"].contains(c.host ?? ""),
              c.user == nil, c.password == nil, c.query == nil, c.fragment == nil,
              c.path.isEmpty || c.path == "/", c.url != nil else {
            throw CompanionError("引擎地址必须为本机 HTTP 地址，例如 http://127.0.0.1:8010。")
        }
    }

    /// 用户没手填时按目录结构自动推断；推断不出来就返回 nil，由界面提示去设置里填。
    public static func locate(explicitPython: String?, explicitScript: String?, baseURL: String,
                              bundle: URL = Bundle.main.bundleURL) -> EnginePaths? {
        let fm = FileManager.default
        let python = explicitPython.flatMap { $0.isEmpty ? nil : $0 }
        let script = explicitScript.flatMap { $0.isEmpty ? nil : $0 }

        if let python, let script, fm.isExecutableFile(atPath: python), fm.fileExists(atPath: script) {
            return EnginePaths(python: python, script: script, baseURL: baseURL)
        }

        var directory = bundle
        for _ in 0..<8 {
            directory = directory.deletingLastPathComponent()
            let candidatePython = directory.appendingPathComponent("LiveTalking/.venv/bin/python").path
            let candidateScript = directory.appendingPathComponent("desktop-companion/scripts/engine_bridge.py").path
            if fm.isExecutableFile(atPath: candidatePython), fm.fileExists(atPath: candidateScript) {
                return EnginePaths(python: python ?? candidatePython,
                                   script: script ?? candidateScript,
                                   baseURL: baseURL)
            }
            if directory.path == "/" { break }
        }
        if let python, let script { return EnginePaths(python: python, script: script, baseURL: baseURL) }
        return nil
    }
}
