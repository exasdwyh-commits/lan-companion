import XCTest
@testable import CompanionCore

final class CoreTests: XCTestCase {
    var root: URL!
    override func setUpWithError() throws {
        root = FileManager.default.temporaryDirectory.appendingPathComponent("LingDesk-tests-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    }
    override func tearDownWithError() throws { try FileManager.default.removeItem(at: root) }

    func testLoopbackOnly() throws {
        var settings = Settings()
        for url in ["http://127.0.0.1:8080/v1", "http://localhost:11434/v1/", "http://[::1]:8080/v1"] {
            settings.baseURL = url
            XCTAssertTrue(try settings.endpoint("models").path.hasSuffix("/v1/models"))
        }
        for url in ["https://api.example.com/v1", "http://127.0.0.1.evil.test/v1", "file:///tmp/v1", "http://user:secret@localhost:8080/v1", "http://localhost/v1?key=secret", "http://localhost/v1#fragment", "http://192.168.1.2:8080/v1"] {
            settings.baseURL = url
            XCTAssertThrowsError(try settings.endpoint("models"), url)
        }
    }

    func testReplyGateRejectsLateResults() {
        var gate = ReplyGate()
        let old = gate.begin(), current = gate.begin()
        XCTAssertFalse(gate.accepts(old)); XCTAssertTrue(gate.accepts(current))
        gate.cancel(); XCTAssertFalse(gate.accepts(current))
    }

    func testPersistenceAndCorruptionIsNotOverwritten() throws {
        let store = try LocalStore(root: root)
        var settings = Settings(); settings.model = "a-local-model"
        try store.save(settings, file: "settings.json")
        XCTAssertEqual(try store.load(Settings.self, file: "settings.json", fallback: Settings()), settings)
        let file = root.appendingPathComponent("history.json")
        try Data("not-json".utf8).write(to: file)
        XCTAssertThrowsError(try store.load([ChatMessage].self, file: "history.json", fallback: []))
        XCTAssertEqual(try String(contentsOf: file), "not-json")
    }

    func testAssetImportCopiesWithoutMutatingSource() throws {
        let store = try LocalStore(root: root.appendingPathComponent("store"))
        let source = root.appendingPathComponent("source")
        try FileManager.default.createDirectory(at: source, withIntermediateDirectories: true)
        let content = Data("fixture-file-validated-by-UI-before-copy".utf8)
        try content.write(to: source.appendingPathComponent("idle-01.mp4"))
        let id = try store.importPack(from: source)
        XCTAssertEqual(try Data(contentsOf: XCTUnwrap(store.asset(.idle, packID: id))), content)
        XCTAssertTrue(FileManager.default.fileExists(atPath: source.appendingPathComponent("idle-01.mp4").path))
        XCTAssertNil(store.asset(.talk, packID: id)); XCTAssertNil(store.asset(.idle, packID: "../escape"))
    }

    func testEmptyAndSymlinkAssetsRejected() throws {
        let store = try LocalStore(root: root.appendingPathComponent("store"))
        XCTAssertThrowsError(try store.importPack(from: root))
        let target = root.appendingPathComponent("other.mp4")
        try Data("source".utf8).write(to: target)
        try FileManager.default.createSymbolicLink(at: root.appendingPathComponent("idle-01.mp4"), withDestinationURL: target)
        XCTAssertThrowsError(try store.importPack(from: root))
    }

    func testContextBoundedAndSystemAlwaysFirst() {
        let history = (0..<40).map { ChatMessage(role: "user", content: "\($0)") } + [ChatMessage(role: "error", content: "private diagnostic")]
        let messages = LocalModelClient.messages(settings: Settings(), history: history)
        XCTAssertEqual(messages.count, 25); XCTAssertEqual(messages.first?["role"], "system")
        XCTAssertEqual(messages.last?["content"], "39")
        XCTAssertFalse(messages.contains { $0["role"] == "error" })
    }

    func testExportAndResultReplyIdentity() throws {
        let store = try LocalStore(root: root)
        let source = root.appendingPathComponent("base.mp4")
        try Data("fixture".utf8).write(to: source)
        let reply = ChatMessage(role: "assistant", content: "你好")
        let folder = try store.exportJob(reply: reply, sourceVideo: source)
        let job = try JSONDecoder().decode(RenderJob.self, from: Data(contentsOf: folder.appendingPathComponent("job.json")))
        XCTAssertEqual(job.reply_id, reply.id.uuidString)
        XCTAssertEqual(job.source_video, "source.mp4")
        try Data("fixture".utf8).write(to: folder.appendingPathComponent("reply.mp4"))
        let json: [String: Any] = ["schema_version": 1, "reply_id": reply.id.uuidString, "video": "reply.mp4", "status": "complete"]
        let result = try JSONDecoder().decode(RenderResult.self, from: JSONSerialization.data(withJSONObject: json))
        XCTAssertEqual(try result.videoURL(in: folder, expectedReply: reply.id).lastPathComponent, "reply.mp4")
        XCTAssertThrowsError(try result.videoURL(in: folder, expectedReply: UUID()))
        var traversal = json; traversal["video"] = "../reply.mp4"
        let invalid = try JSONDecoder().decode(RenderResult.self, from: JSONSerialization.data(withJSONObject: traversal))
        XCTAssertThrowsError(try invalid.videoURL(in: folder, expectedReply: reply.id))
    }
}

final class FixtureURLProtocol: URLProtocol {
    static var responseStatus = 200
    static var body = Data()
    static var request: URLRequest?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.request = request
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: Self.responseStatus, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Self.body)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

final class LocalModelTests: XCTestCase {
    func client(_ json: String, status: Int = 200) -> LocalModelClient {
        FixtureURLProtocol.responseStatus = status; FixtureURLProtocol.body = Data(json.utf8)
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [FixtureURLProtocol.self]
        return LocalModelClient(session: URLSession(configuration: config))
    }
    func testReplyAndReasoningRemoval() async throws {
        let client = client(#"{"choices":[{"message":{"content":"<think>private reasoning</think>你好！"}}]}"#)
        let text = try await client.reply(settings: Settings(), history: [ChatMessage(role: "user", content: "你好")])
        XCTAssertEqual(text, "你好！")
        XCTAssertEqual(FixtureURLProtocol.request?.url?.path, "/v1/chat/completions")
        XCTAssertEqual(FixtureURLProtocol.request?.httpMethod, "POST")
        XCTAssertNil(FixtureURLProtocol.request?.value(forHTTPHeaderField: "Authorization"))
    }
    func testModels() async throws {
        let models = try await client(#"{"data":[{"id":"local-qwen"}]}"#).models(settings: Settings())
        XCTAssertEqual(models, ["local-qwen"])
    }
    func testEmptyMalformedAndHTTPFailuresAreNotFakeReplies() async {
        for (body, code) in [(#"{"choices":[]}"#, 200), ("not json", 200), ("failure", 503), (#"{"choices":[{"message":{"content":"<think>unfinished"}}]}"#, 200)] {
            do {
                _ = try await client(body, status: code).reply(settings: Settings(), history: [])
                XCTFail("Invalid response accepted")
            } catch { /* Expected; app preserves input and shows an explicit error. */ }
        }
    }
}
