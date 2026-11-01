import Foundation

// MARK: - 内容包（pack.json）
//
// 「换角色 = 换一个素材目录 + 一份 pack.json，不动代码」是这一层的全部目的。
//
// 两条格式约定，都是为了能手写、也能让模型直接生成：
//   1. 所有字段可选。少写一项就用内置默认值，绝不因为缺字段崩溃或黑屏。
//   2. 用对象数组，不用 JS 那种 `["a", 1, "b"]` 异构数组——后者在 Swift 和
//      在人工编辑时都容易错位。
//
// 与马尔福 data.js 的差异：他那份是 JS，可以直接写注释和表达式；我们这份是
// 纯数据，逻辑全在引擎里。这样素材包可以给非程序员改。

struct PetPack: Decodable {
    struct Scene: Decodable {
        var id: String?
        var name: String?
        /// 垫在所有视频下面的静帧。素材缺失时它就是兜底画面。
        var still: String?
        /// 待机循环。可以写多段，重复同一个文件名即提高它被抽到的概率。
        var ambient: [String]?
        /// 空闲时随机叠的小动作片段。
        var actions: [String]?
        var touch: String?
        var sleep: String?
        /// 睡姿定格用的静帧。配 sleepEndAt 用：播到那一刻就停住，不循环。
        var sleepStill: String?
        var sleepEndAt: Double?
    }

    struct Cap: Decodable {
        var from: Double
        var to: Double
        var zh: String
        var en: String?
    }

    /// 剧情里的一个「镜头」。可以是视频，也可以只是一张静帧。
    ///
    /// 静帧这条是给没有剧情视频的素材包留的路：相册里那 26 张图配上台词和
    /// 停留秒数，就能演一章图文剧，不必等视频素材。
    struct Clip: Decodable, Identifiable {
        var id: String
        /// 视频片段。和 image 二选一；两个都写了以 image 优先。
        var file: String?
        var image: String?
        /// 静帧停留秒数。不写默认 4.5 秒——短了读不完一句，长了像卡住。
        var duration: Double?
        /// 静帧镜头的一句话台词。视频镜头请用 caps，能卡到具体秒数。
        var text: String?
        /// 台词挂在这段视频的秒数上，不是 TTS。表演节奏才可控。
        var caps: [Cap]?

        /// 静帧停留秒数，兜底到 [0.5, 30]：写 0 会一闪而过，写太大像卡死。
        var hold: Double { min(max(duration ?? 4.5, 0.5), 30) }
    }

    struct Step: Decodable {
        var clip: String?
        var branch: [String: String]?
        /// 目前只认 "choice"：这段播完让用户选，选完继续往下走。
        var then: String?
    }

    struct Choices: Decodable {
        var prompt: String?
        var a: String?
        var b: String?
    }

    struct Chapter: Decodable, Identifiable {
        var id: String
        var title: String
        var titleEn: String?
        var unlockAt: Int?
        var reward: Int?
        var flow: [Step]?
        var choices: Choices?
        /// flow 为空时，列表里显示这行字（比如「敬请期待」）。
        var pending: String?
    }

    struct AlbumItem: Decodable, Identifiable {
        var id: String
        var file: String
        var unlockAt: Int?
        var zh: String?
        var en: String?
        var date: String?
        /// JSON 里就叫 where；`where` 是 Swift 关键字，映射到 place。
        var place: String?

        private enum CodingKeys: String, CodingKey {
            case id, file, unlockAt, zh, en, date
            case place = "where"
        }
    }

    /// 一首能唱的歌。
    ///
    /// 歌词按时间码挂，不用 LRC 文件：一份 JSON 就能描述整首歌，素材包转手不会
    /// 丢半截。`at` 是这一行开始唱的秒数，播到下一行就整行换掉。
    ///
    /// 翻唱音频由 `scripts/sing_cover.py` 离线生成，运行时不联网、不做模型推理。
    struct Song: Decodable, Identifiable {
        struct Line: Decodable {
            var at: Double
            var zh: String
            var en: String?
        }

        var id: String
        var title: String
        /// 音频文件，相对素材目录。视频文件也认，但歌只取音轨。
        var file: String
        var cover: String?
        /// 「原唱：某某」这类署名。翻唱作品应当保留，别抹掉原作者。
        var credit: String?
        /// 好感度门槛。不写就是一开始就能点。
        var unlockAt: Int?
        /// 自定义音量。翻唱混音偏响时调低，不写走 1.0。
        var gain: Double?
        var lyrics: [Line]?

        var volume: Float { Float(min(max(gain ?? 1.0, 0), 1.5)) }
    }

    struct Address: Decodable {
        var affinity: Int
        var call: String
    }

    struct Affection: Decodable {
        var cap: Int?
        var touch: Int?
        var touchCooldown: Double?
        var dailyVisit: Int?
        var chat: Int?
        /// 聊天也给好感度，但必须带冷却——否则连发「嗯」就能刷满。
        var chatCooldown: Double?
        var chapterReward: Int?
        /// 听完一整首给多少好感。被打断不给。
        var song: Int?

        private enum CodingKeys: String, CodingKey {
            case cap = "max"
            case touch, touchCooldown, dailyVisit, chat, chatCooldown, chapterReward, song
        }
    }

    var format: Int?
    var name: String?
    var persona: String?
    var greeting: [String]?
    var touches: [String]?
    var idles: [String]?
    /// 唱完之后说的话。不配就走「唱完了。《歌名》」。
    var songLines: [String]?
    var addresses: [Address]?
    var scene: Scene?
    var clips: [Clip]?
    var chapters: [Chapter]?
    var album: [AlbumItem]?
    var songs: [Song]?
    var affection: Affection?

    /// 素材目录，不参与解码。
    var root: URL?

    /// 加载失败时用的最小包：只有一段待机循环，其它一律走默认。
    /// 用 JSON 字面量构造，比手写一长串 init 更难写错。
    static let minimal: PetPack = {
        let json = """
        {"format":1,"name":"桌面伙伴","greeting":["……"],
         "touches":["有事？"],"idles":["……"],
         "scene":{"id":"default","ambient":["idle-01.mp4"],"touch":"touch-01.mp4"}}
        """
        return (try? JSONDecoder().decode(PetPack.self, from: Data(json.utf8))) ?? PetPack()
    }()

    static func load(from root: URL?) -> PetPack? {
        guard let root else { return nil }
        let url = root.appendingPathComponent("pack.json")
        guard let data = try? Data(contentsOf: url) else { return nil }
        guard var pack = try? JSONDecoder().decode(PetPack.self, from: data) else { return nil }
        pack.root = root
        return pack
    }
}

// MARK: - 取值便捷方式

extension PetPack {
    var displayName: String { name?.isEmpty == false ? name! : "桌面伙伴" }
    var sceneValue: Scene { scene ?? Scene() }

    /// 素材引用解析成绝对路径。写相对路径是相对素材目录，写绝对路径也认。
    /// 文件不存在就返回 nil，让调用方走兜底而不是拿到一个坏 URL。
    func file(_ name: String?) -> URL? {
        guard let name, !name.isEmpty else { return nil }
        let url: URL
        if name.hasPrefix("/") {
            url = URL(fileURLWithPath: name)
        } else if let root {
            url = root.appendingPathComponent(name)
        } else {
            return nil
        }
        return FileManager.default.fileExists(atPath: url.path) ? url : nil
    }

    func clip(_ id: String) -> Clip? { clips?.first { $0.id == id } }

    var ambientFiles: [URL] {
        (sceneValue.ambient ?? []).compactMap { file($0) }
    }

    /// 声明了、但文件不存在的待机素材名。
    /// `ambientFiles` 会静默丢掉缺失项，所以要单独留一条能报出来的路径。
    var missingAmbientNames: [String] {
        (sceneValue.ambient ?? []).filter { file($0) == nil }
    }

    /// 当前好感度下能点的歌。没写 unlockAt 的永远可选。
    func availableSongs(affinity: Int) -> [Song] {
        (songs ?? []).filter { affinity >= ($0.unlockAt ?? 0) }
    }

    /// 声明了但音频不在的歌名。用于启动时提醒，而不是点了没反应。
    var missingSongTitles: [String] {
        (songs ?? []).filter { file($0.file) == nil }.map(\.title)
    }

    var actionFiles: [URL] {
        (sceneValue.actions ?? []).compactMap { file($0) }
    }

    /// 按好感度取称呼。没配就返回 nil，界面上不显示这一行。
    func address(for affinity: Int) -> String? {
        guard let addresses, !addresses.isEmpty else { return nil }
        return addresses.filter { affinity >= $0.affinity }.max { $0.affinity < $1.affinity }?.call
    }

    var capValue: Int { affection?.cap ?? 100 }
    var touchValue: Int { affection?.touch ?? 1 }
    var touchCooldown: Double { affection?.touchCooldown ?? 45 }
    var dailyVisitValue: Int { affection?.dailyVisit ?? 3 }
    var chatValue: Int { affection?.chat ?? 1 }
    var chatCooldown: Double { affection?.chatCooldown ?? 20 }
    var chapterReward: Int { affection?.chapterReward ?? 10 }
    /// 听完一首歌的奖励。比聊天高，因为它占的时间长；但比剧情低，因为它更轻。
    var songValue: Int { affection?.song ?? 2 }

    func lockedReasonForChapter(_ chapter: Chapter, affinity: Int) -> String? {
        guard let need = chapter.unlockAt, need > 0, affinity < need else { return nil }
        return "好感度 \(need) 解锁"
    }

    func lockedReasonForAlbum(_ item: AlbumItem, affinity: Int) -> String? {
        guard let need = item.unlockAt, need > 0, affinity < need else { return nil }
        return "好感度 \(need) 解锁"
    }
}

// MARK: - 存档里的可变状态

/// 和角色相处出来的东西：好感度、看过什么、上次见面是哪天。
/// 单独存一份，删掉它等于重新认识她——但聊天记录不受影响。
struct PetState: Codable {
    var affinity = 0
    var lastVisitDay = ""
    var lastTouch = 0.0
    var lastChat = 0.0
    var seenClips: [String] = []
    var finishedChapters: [String] = []
    var picked: [String: String] = [:]
    /// 已经提示过解锁的条目，避免每次加好感都弹一遍。
    var notified: [String] = []
    /// 听过的歌。用来「优先唱还没听过的」，也用来算听完给多少好感。
    var heardSongs: [String] = []

    func sawClip(_ id: String) -> Bool { seenClips.contains(id) }
    mutating func markClip(_ id: String) {
        if !seenClips.contains(id) { seenClips.append(id) }
    }
    func heardSong(_ id: String) -> Bool { heardSongs.contains(id) }
    mutating func markSong(_ id: String) {
        if !heardSongs.contains(id) { heardSongs.append(id) }
    }
    func finished(_ id: String) -> Bool { finishedChapters.contains(id) }
    mutating func markChapter(_ id: String) {
        if !finishedChapters.contains(id) { finishedChapters.append(id) }
    }
}
