import Foundation

public final class LocalStore {
    public let root: URL
    private let encoder: JSONEncoder
    private let decoder = JSONDecoder()
    private let fm = FileManager.default

    public init(root: URL? = nil) throws {
        if let root { self.root = root }
        else if let override = ProcessInfo.processInfo.environment["LINGDESK_DATA_DIR"] {
            self.root = URL(fileURLWithPath: override, isDirectory: true)
        } else {
            self.root = try fm.url(for: .applicationSupportDirectory, in: .userDomainMask,
                                   appropriateFor: nil, create: true).appendingPathComponent("LingDesk")
        }
        encoder = JSONEncoder(); encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        try fm.createDirectory(at: self.root, withIntermediateDirectories: true,
                               attributes: [.posixPermissions: 0o700])
    }

    public func load<T: Decodable>(_ type: T.Type, file: String, fallback: T) throws -> T {
        let url = root.appendingPathComponent(file)
        guard fm.fileExists(atPath: url.path) else { return fallback }
        // Corrupt data must be reported, never silently replaced by defaults.
        return try decoder.decode(type, from: Data(contentsOf: url))
    }

    public func save<T: Encodable>(_ value: T, file: String) throws {
        let url = root.appendingPathComponent(file)
        try encoder.encode(value).write(to: url, options: .atomic)
        try fm.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
    }

    public func asset(_ slot: AssetSlot, packID: String?) -> URL? {
        guard let packID, UUID(uuidString: packID) != nil else { return nil }
        let url = root.appendingPathComponent("Assets/\(packID)/\(slot.rawValue)")
        return fm.fileExists(atPath: url.path) ? url : nil
    }

    public func importPack(from folder: URL) throws -> String {
        let candidates = try AssetSlot.allCases.compactMap { slot -> (AssetSlot, URL)? in
            let url = folder.appendingPathComponent(slot.rawValue)
            guard fm.fileExists(atPath: url.path) else { return nil }
            let values = try url.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey])
            guard values.isRegularFile == true, values.isSymbolicLink != true,
                  let size = values.fileSize, size > 0, size <= 1_073_741_824 else {
                throw CompanionError("\(slot.rawValue) 必须是非空的普通文件，且不超过 1GB。")
            }
            return (slot, url)
        }
        guard candidates.contains(where: { $0.0 == .idle || $0.0 == .portrait }) else {
            throw CompanionError("文件夹至少需要 idle-01.mp4 或 character-master.png，请按 Muse 素材命名导入。")
        }
        let manifest = folder.appendingPathComponent("character.json")
        var manifestData: Data?
        if fm.fileExists(atPath: manifest.path) {
            let values = try manifest.resourceValues(forKeys: [.isSymbolicLinkKey, .fileSizeKey])
            guard values.isSymbolicLink != true, (values.fileSize ?? Int.max) <= 4096 else {
                throw CompanionError("character.json 必须为不超过 4KB 的普通文件。")
            }
            let data = try Data(contentsOf: manifest)
            _ = try decoder.decode(CharacterPackManifest.self, from: data).validatedAvatar()
            manifestData = data
        }
        let id = UUID().uuidString
        let destination = root.appendingPathComponent("Assets/\(id)", isDirectory: true)
        try fm.createDirectory(at: destination, withIntermediateDirectories: true)
        do {
            if let manifestData { try manifestData.write(to: destination.appendingPathComponent("character.json")) }
            for (slot, url) in candidates {
                try fm.copyItem(at: url, to: destination.appendingPathComponent(slot.rawValue))
            }
        } catch {
            // Only the new, app-owned staging directory is removed on failed import.
            try? fm.removeItem(at: destination)
            throw error
        }
        return id
    }

    public func engineAvatar(packID: String) throws -> String? {
        guard UUID(uuidString: packID) != nil else { throw CompanionError("角色素材包标识无效。") }
        let file = root.appendingPathComponent("Assets/\(packID)/character.json")
        guard fm.fileExists(atPath: file.path) else { return nil }
        return try decoder.decode(CharacterPackManifest.self, from: Data(contentsOf: file)).validatedAvatar()
    }

    /// 一次回复对应一个视频文件，用回复 id 命名，天然不会串到别的回复上。
    public func replyTarget(id: UUID) throws -> URL {
        let folder = root.appendingPathComponent("Replies", isDirectory: true)
        try fm.createDirectory(at: folder, withIntermediateDirectories: true)
        return folder.appendingPathComponent("\(id.uuidString).mp4")
    }

    public func exportJob(reply: ChatMessage, sourceVideo: URL) throws -> URL {
        guard reply.role == "assistant", !reply.content.isEmpty else { throw CompanionError("还没有可导出的回复。") }
        let folder = root.appendingPathComponent("Jobs/\(reply.id.uuidString)-\(UUID().uuidString)")
        try fm.createDirectory(at: folder, withIntermediateDirectories: true)
        do {
            try fm.copyItem(at: sourceVideo, to: folder.appendingPathComponent("source.mp4"))
            try encoder.encode(RenderJob(reply: reply)).write(to: folder.appendingPathComponent("job.json"), options: .atomic)
            try reply.content.write(to: folder.appendingPathComponent("text.txt"), atomically: true, encoding: .utf8)
        } catch { try? fm.removeItem(at: folder); throw error }
        return folder
    }
}
