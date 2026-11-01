import Foundation

private final class NoRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

/// OpenAI 兼容聊天客户端。名字保留 LocalModelClient 是为了不牵动已有调用点，
/// 但现在它同时服务本机 Ollama/vLLM 和远程网关（DeepSeek、OpenRouter、
/// 自建 Hermes 服务）——这三者的 `/chat/completions` 形状完全一致。
public final class LocalModelClient {
    private let localSession: URLSession
    private let remoteSession: URLSession
    public init(session: URLSession? = nil) {
        func make(noProxy: Bool) -> URLSession {
            let configuration = URLSessionConfiguration.ephemeral
            configuration.timeoutIntervalForRequest = 120
            configuration.timeoutIntervalForResource = 180
            configuration.httpShouldSetCookies = false
            if noProxy { configuration.connectionProxyDictionary = [:] }
            return URLSession(configuration: configuration, delegate: NoRedirects(), delegateQueue: nil)
        }
        // 回环地址必须绕开系统代理，否则本地服务会被代理吞掉；
        // 远程端点相反——用户很可能正是靠代理才能访问，所以沿用系统代理设置。
        localSession = session ?? make(noProxy: true)
        remoteSession = session ?? make(noProxy: false)
    }

    public static func messages(settings: Settings, history: [ChatMessage]) -> [[String: String]] {
        [["role": "system", "content": settings.persona]] + history
            .filter { ["user", "assistant"].contains($0.role) }
            .suffix(24).map { ["role": $0.role, "content": $0.content] }
    }

    public func reply(settings: Settings, history: [ChatMessage]) async throws -> String {
        var request = URLRequest(url: try settings.endpoint("chat/completions"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if !settings.apiKey.isEmpty {
            request.setValue("Bearer \(settings.apiKey)", forHTTPHeaderField: "Authorization")
        }
        request.httpBody = try JSONSerialization.data(withJSONObject: [
            "model": settings.model,
            "messages": Self.messages(settings: settings, history: history),
            "stream": false, "max_tokens": 768,
            "temperature": 0.7
        ])
        let data = try await fetch(request, settings: settings)
        struct Response: Decodable {
            struct Choice: Decodable {
                struct Message: Decodable {
                    let content: String?
                    /// 推理型模型（SenseNova 6.8、GLM、DeepSeek-R1 一类）会先写思考，
                    /// 输出预算被思考吃光时 content 直接缺失。要能分辨这种情况。
                    let reasoning: String?
                }
                let message: Message
            }
            let choices: [Choice]
        }
        let response = try JSONDecoder().decode(Response.self, from: data)
        let message = response.choices.first?.message
        let content = message?.content?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        // Some local reasoning models emit <think> inside content. Never read that aloud.
        let clean = content.replacingOccurrences(of: "(?s)<think>.*?</think>", with: "", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clean.isEmpty, !clean.contains("<think>") else {
            let onlyThought = !(message?.reasoning ?? "").isEmpty
            throw CompanionError(onlyThought
                ? "模型的思考把输出额度用完了，没留下正文。换一个非推理模型（更快），或调大输出上限。"
                : "模型没有给出可展示的回答。请关闭模型 thinking 模式，或提高服务端输出限制后重试。")
        }
        return clean
    }

    public func models(settings: Settings) async throws -> [String] {
        var request = URLRequest(url: try settings.endpoint("models"))
        if !settings.apiKey.isEmpty {
            request.setValue("Bearer \(settings.apiKey)", forHTTPHeaderField: "Authorization")
        }
        let data = try await fetch(request, settings: settings)
        struct Response: Decodable {
            struct Model: Decodable { let id: String }
            let data: [Model]
        }
        return try JSONDecoder().decode(Response.self, from: data).data.map(\.id)
    }

    private func fetch(_ request: URLRequest, settings: Settings) async throws -> Data {
        let session = settings.isLocalEndpoint ? localSession : remoteSession
        let (data, response) = try await session.data(for: request)
        try Task.checkCancellation()
        guard let http = response as? HTTPURLResponse else { throw CompanionError("服务返回了无效响应。") }
        guard (200..<300).contains(http.statusCode) else {
            throw CompanionError(Self.explain(status: http.statusCode, data: data, settings: settings))
        }
        guard data.count <= 2_000_000 else { throw CompanionError("服务返回过大的响应，已拒绝。") }
        return data
    }

    /// 把状态码翻译成能直接照做的下一步。原始 body 只截一段，
    /// 免得把网关返回的整页 HTML 灌进对话气泡。
    static func explain(status: Int, data: Data, settings: Settings) -> String {
        let detail = String(data: data.prefix(240), encoding: .utf8)?
            .replacingOccurrences(of: "\n", with: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        switch status {
        case 401:
            return "服务拒绝了这次请求（HTTP 401）。API Key 不对或已失效。"
        case 403:
            // 403 有两种完全不同的成因：key 没权限，或套餐里不含这个模型。
            // 带上服务端原话，用户才知道该换 key 还是换模型名。
            return "服务拒绝了这个模型（HTTP 403）。\(detail.isEmpty ? "请检查 API Key 权限。" : "服务说：\(detail)")请换一个套餐内包含的模型名再试。"
        case 404:
            return "找不到接口或模型（HTTP 404）。服务地址应以 /v1 结尾，模型名要写服务端真实存在的 id。"
        case 402:
            return "账户余额或额度不足（HTTP 402）。"
        case 429:
            return "请求过于频繁或额度用尽（HTTP 429），稍后再试。"
        case 500...599:
            return "服务端故障（HTTP \(status)）。\(detail.isEmpty ? "" : "服务说：\(detail)")"
        default:
            return "请求失败（HTTP \(status)）。\(detail.isEmpty ? "" : "服务说：\(detail)")"
        }
    }
}
