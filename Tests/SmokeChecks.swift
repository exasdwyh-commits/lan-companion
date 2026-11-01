import Foundation
import CompanionCore

@main
struct SmokeChecks {
    static func require(_ condition: Bool, _ message: String) throws {
        if !condition { throw CompanionError(message) }
    }

    @MainActor
    static func waitFor(_ condition: () -> Bool) async throws {
        for _ in 0..<250 {
            if condition() { return }
            try await Task.sleep(nanoseconds: 20_000_000)
        }
        throw CompanionError("等待桥状态超时")
    }

    @MainActor
    static func main() async throws {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: folder) }
        let store = try LocalStore(root: folder.appendingPathComponent("data"))
        let source = folder.appendingPathComponent("source")
        try FileManager.default.createDirectory(at: source, withIntermediateDirectories: true)
        try Data("fixture".utf8).write(to: source.appendingPathComponent("character-master.png"))
        try Data(#"{"schema_version":1,"engine_avatar":"my_face"}"#.utf8).write(to: source.appendingPathComponent("character.json"))
        let pack = try store.importPack(from: source)
        try require(try store.engineAvatar(packID: pack) == "my_face", "角色绑定未复制")
        try Data(#"{"schema_version":1,"engine_avatar":"../wrong"}"#.utf8).write(to: source.appendingPathComponent("character.json"))
        do { _ = try store.importPack(from: source); throw CompanionError("接受了无效角色标识") }
        catch let error as CompanionError { try require(error.message != "接受了无效角色标识", error.message) }
        let old = try JSONDecoder().decode(Settings.self, from: Data(#"{"model":"local","engineVoice":"Tingting"}"#.utf8))
        try require(old.engineTTS == "saytts" && old.engineVoice == "Tingting", "旧设置迁移失去离线音色")
        for url in ["http://localhost:8010", "http://127.0.0.1:8010", "http://[::1]:8010"] {
            try EnginePaths.validateBaseURL(url)
        }
        for url in ["https://example.com", "http://user:pw@localhost", "http://localhost?x=1"] {
            var rejected = false
            do { try EnginePaths.validateBaseURL(url) } catch { rejected = true }
            try require(rejected, "接受了非本机地址")
        }
        var gate = ReplyGate()
        let first = gate.begin(), second = gate.begin()
        try require(!gate.accepts(first) && gate.accepts(second), "旧回复未被丢弃")
        gate.cancel()
        try require(!gate.accepts(second), "取消后仍接受回复")

        let args = CommandLine.arguments
        let paths = EnginePaths(python: args[1], script: args[2], baseURL: "http://127.0.0.1:8010")
        let bridge = EngineBridge()
        bridge.start(paths: paths, avatar: "face", tts: "saytts", voice: "first")
        try await waitFor { bridge.readiness == .ready(model: "first") }
        bridge.start(paths: paths, avatar: "face", tts: "saytts", voice: "first")
        try require(bridge.readiness == .ready(model: "first"), "相同配置重复启动")
        bridge.start(paths: paths, avatar: "face", tts: "saytts", voice: "second")
        try await waitFor { bridge.readiness == .ready(model: "second") }
        try await Task.sleep(nanoseconds: 200_000_000)
        try require(bridge.readiness == .ready(model: "second"), "旧退出事件覆盖了新连接")
        bridge.start(paths: paths, avatar: "face", tts: "saytts", voice: "crash")
        try await waitFor { if case .failed = bridge.readiness { return true }; return false }
        bridge.start(paths: paths, avatar: "face", tts: "saytts", voice: "recovered")
        try await waitFor { bridge.readiness == .ready(model: "recovered") }
        bridge.stop()
        try await Task.sleep(nanoseconds: 200_000_000)
        try require(bridge.readiness == .stopped, "退出未停止连接")
        print("PASS: 角色绑定、旧设置迁移、地址限制、晚到回复、音色重连、退出竞态、故障恢复")
    }
}
