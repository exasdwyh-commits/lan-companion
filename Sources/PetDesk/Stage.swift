import AppKit
import AVFoundation

// MARK: - 舞台
//
// 两层待机 + 一层动作。
//
// 待机用「两个 player 交替 + 0.6 秒交叉淡化」，而不是单个 AVPlayerLooper：
// 单元素循环在素材首尾帧不完全一致时会露一次跳帧，而交叉淡化**不管素材接不接
// 得上都能糊过去**。多段待机循环还能这样轮换——同一段连播容易看出循环点。
//
// 动作片段叠在第三层，淡入 → 播到 duration-0.45 → 淡出。提前淡出是因为
// 动作片段的末帧姿势多半没回到锚点，等播放结束再切会「顿一下」。

@MainActor
final class PetStage {
    let actionPlayer = AVPlayer()

    /// 两个待机 player 永远在同一个位置轮换，index 0/1 就是前后台。
    private let players: [AVPlayer] = [AVPlayer(), AVPlayer()]
    private var layers: [AVPlayerLayer] = []
    private weak var actionLayer: AVPlayerLayer?
    private var front = 0
    private var ambientURLs: [URL] = []
    private var ticker: Timer?
    private var timeObserver: Any?
    private var token = 0
    private var fadedOut = false
    private var paused = false
    /// 睡姿定格：播到 sleepEndAt 就停住，不再循环（循环的呼吸一眼就假）。
    private var frozen = false
    private var sleepEndAt: Double?
    private(set) var swaps = 0
    /// 交叉淡化过程中两层里较高的那个透明度 的最小值。
    /// 掉到 0 附近就说明中间黑了一下——这是「看起来卡了一帧」的真正原因。
    private(set) var minCoverage: Double = 1

    // MARK: 素材健康度
    //
    // 之前换素材只看「URL 有没有传进来」，文件被删掉、拷了一半、编码不支持时
    // 新 item 直接 failed，而前端已经切过去了 —— 旧层淡到 0，新层什么都没有，
    // 画面就停在深灰底上，看起来像「卡死了」。下面这套是为了让失败**收敛**：
    // 坏的跳过、能回退就退回上一段、实在没得放就留着当前这一帧并报出来。

    enum Health: String { case ok, degraded, empty }
    private(set) var health: Health = .empty
    private(set) var lastError: String?
    /// 前台素材解码失败后「退回上一段」的次数。自检靠它确认回退路径真的走过，
    /// 而不是靠「看起来还在播」猜。
    private(set) var recoveries = 0
    /// 已经确认解不出来的素材，轮换时优先避开，免得反复撞同一个坏文件。
    private var badURLs: Set<String> = []
    /// 每个 player 当前装的是哪段素材，回退时要知道另一层有什么。
    private var playerURL: [URL?] = [nil, nil]
    private var observations: [NSKeyValueObservation] = []
    private var lastReport: (message: String, at: Date)?
    /// 轮换探测的节流点：素材全坏时避免 20 Hz 重建 AVPlayerItem。
    private var nextProbeAt = Date.distantPast

    /// 自检读这两项：确认「切了但什么都没有」不会被当成正常。
    var healthName: String { health.rawValue }
    var lastErrorMessage: String { lastError ?? "" }

    /// 交叉淡化窗口。比素材可能存在的接缝更宽，所以第一帧和最后一帧对不上也看不出来。
    private let crossfade: TimeInterval = 0.6

    var onError: ((String) -> Void)?

    /// 自检和诊断读这个：永远是当前在前台那一个。
    var idlePlayer: AVPlayer { players[front] }
    var isFrozen: Bool { frozen }

    init() {
        for player in players {
            player.isMuted = true
            player.actionAtItemEnd = .pause
        }
        actionPlayer.isMuted = true
        actionPlayer.actionAtItemEnd = .pause
    }

    func attach(idleA: AVPlayerLayer, idleB: AVPlayerLayer, action: AVPlayerLayer) {
        layers = [idleA, idleB]
        for (index, layer) in layers.enumerated() {
            layer.player = players[index]
            layer.videoGravity = .resizeAspectFill
            layer.backgroundColor = NSColor.clear.cgColor
            CATransaction.begin()
            CATransaction.setDisableActions(true)
            layer.opacity = index == front ? 1 : 0
            CATransaction.commit()
        }
        actionLayer = action
        action.player = actionPlayer
        action.videoGravity = .resizeAspectFill
        action.backgroundColor = NSColor.clear.cgColor
        action.opacity = 0
    }

    // MARK: 待机

    /// 兼容单个素材的老接口（睡觉、唤醒都走这里）。
    func loadIdle(_ url: URL?) {
        loadAmbient(url.map { [$0] } ?? [])
    }

    /// 换一组待机素材。不等同于「换视频源」：旧的那层是淡出，不是被拔掉。
    ///
    /// 传进来的 URL 会先过一遍可用性检查。全是坏文件时**不擦掉当前画面**——
    /// 场景层底下还有深灰底，擦掉就是一块黑；留着旧帧至少还能看出是谁。
    func loadAmbient(_ urls: [URL], sleepEndAt: Double? = nil) {
        var usable: [URL] = []
        var broken: [URL] = []
        for url in urls {
            if mediaUsable(url) { usable.append(url) } else { broken.append(url) }
        }
        if !broken.isEmpty {
            let names = broken.map(\.lastPathComponent).joined(separator: "、")
            degrade("有 \(broken.count) 段待机素材缺失或为空，已跳过：\(names)")
        }
        guard let first = usable.randomElement() else {
            // 明确的「清空」请求；或者全都坏了但还没播过任何东西，只能空着。
            if urls.isEmpty || ambientURLs.isEmpty { stopAmbient() }
            return
        }
        health = broken.isEmpty ? .ok : .degraded
        // 用户把坏文件换好之后要能重新用上，别一辈子拉黑。
        badURLs = badURLs.filter { !mediaUsable(URL(fileURLWithPath: $0)) }
        nextProbeAt = .distantPast
        ambientURLs = usable
        self.sleepEndAt = sleepEndAt
        frozen = false
        startNext(first, fade: 0.35)
        startTicking()
    }

    /// 睡姿：不换源，只是把同一段停在第 N 秒。素材缺失时用静帧顶上（由调用方处理）。
    func freeze(at seconds: Double) {
        sleepEndAt = seconds
        // 上一轮 freeze 已经把 ticker 停了，不重启就永远冻不住。
        frozen = false
        startTicking()
    }

    func stopAmbient() {
        ambientURLs = []
        ticker?.invalidate(); ticker = nil
        for player in players { player.pause() }
        playerURL = [nil, nil]
        frozen = false
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        for layer in layers { layer.opacity = 0 }
        CATransaction.commit()
        health = .empty
    }

    func setPaused(_ value: Bool) {
        paused = value
        if value {
            ticker?.invalidate(); ticker = nil
            for player in players { player.pause() }
            actionPlayer.pause()
        } else {
            if !frozen { players[front].play() }
            if actionPlayer.currentItem != nil { actionPlayer.play() }
            if !frozen { startTicking() }
        }
    }

    private func startTicking() {
        ticker?.invalidate()
        guard !paused, !ambientURLs.isEmpty, !frozen else { return }
        let timer = Timer(timeInterval: 0.05, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.tick() }
        }
        // .common 模式：拖动窗口、拉菜单时也要继续跑，否则交接会卡住。
        RunLoop.main.add(timer, forMode: .common)
        ticker = timer
    }

    private func tick() {
        guard !paused, !frozen, layers.count == 2, !ambientURLs.isEmpty else { return }
        let player = players[front]
        guard let item = player.currentItem else { return }
        let duration = item.duration.seconds
        let now = player.currentTime().seconds
        guard duration.isFinite, duration > 0.8, now.isFinite, now > 0.2 else { return }

        if let end = sleepEndAt {
            if now >= end - 0.05 {
                player.pause()
                frozen = true
                ticker?.invalidate(); ticker = nil
                return
            }
            return
        }

        // 交接过一次之后才统计遮盖率：开机那次是淡入，本来就从 0 开始。
        if swaps > 0 {
            let coverage = layers.map { Double($0.opacity) }.max() ?? 0
            minCoverage = min(minCoverage, coverage)
        }

        if now >= duration - crossfade {
            // 只有真的换成了才算一次交接：素材全坏时这里不能虚报 swaps。
            if let next = nextURL(), startNext(next, fade: crossfade) { swaps += 1 }
        }
    }

    /// 轮换时避开已知坏掉的素材，并且确认文件还在。
    /// 带 0.5 秒节流：全坏的时候不该以 20 Hz 的速度新建 AVPlayerItem。
    private func nextURL() -> URL? {
        let now = Date()
        guard now >= nextProbeAt else { return nil }
        nextProbeAt = now.addingTimeInterval(0.5)
        let pool = ambientURLs.filter { !badURLs.contains($0.path) && mediaUsable($0) }
        if !pool.isEmpty { return pool.randomElement() }
        degrade("待机素材都不可用了，画面停在当前这一帧。")
        return nil
    }

    /// 在后台 player 上起新素材，两层互换并交叉淡化。
    ///
    /// 起之前先确认文件在不在、有没有内容。不在就不切——保持当前这帧可见，
    /// 只报一次；否则会把已有画面淡成空的。
    private func startNext(_ url: URL, fade: TimeInterval) -> Bool {
        guard layers.count == 2 else { return false }
        guard mediaUsable(url) else {
            badURLs.insert(url.path)
            degrade("待机素材不可用：\(url.lastPathComponent)")
            return false
        }
        let next = 1 - front
        let inPlayer = players[next]
        let outPlayer = players[front]

        let item = AVPlayerItem(url: url)
        observe(item, url: url, role: .ambient)
        inPlayer.replaceCurrentItem(with: item)
        playerURL[next] = url
        inPlayer.seek(to: .zero, toleranceBefore: .zero, toleranceAfter: .zero)
        if !paused { inPlayer.play() }

        let inLayer = layers[next]
        let outLayer = layers[front]
        inLayer.removeAnimation(forKey: "xfade")
        outLayer.removeAnimation(forKey: "xfade")
        inLayer.opacity = 1
        let fadeIn = CABasicAnimation(keyPath: "opacity")
        fadeIn.fromValue = 0
        fadeIn.toValue = 1
        fadeIn.duration = fade
        fadeIn.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
        inLayer.add(fadeIn, forKey: "xfade")
        if outLayer.opacity > 0 {
            outLayer.opacity = 0
            let fadeOut = CABasicAnimation(keyPath: "opacity")
            fadeOut.fromValue = 1
            fadeOut.toValue = 0
            fadeOut.duration = fade
            fadeOut.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
            outLayer.add(fadeOut, forKey: "xfade")
        }
        front = next

        // 淡完再停掉旧的，省解码；如果它又被用上了（front 变了）就不动。
        DispatchQueue.main.asyncAfter(deadline: .now() + fade + 0.15) { [weak self] in
            MainActor.assumeIsolated {
                guard let self, outPlayer !== self.players[self.front] else { return }
                outPlayer.pause()
            }
        }
        return true
    }

    /// 给自检用：直接读出图层的真实状态，而不是靠截图猜。
    var actionOpacity: CGFloat { CGFloat(actionLayer?.opacity ?? 0) }
    /// 两层待机各自的透明度，用来确认交叉淡化真的在换人。
    var ambientOpacities: [Double] { layers.map { Double($0.opacity) } }
    var idleStatus: String {
        guard let status = idlePlayer.currentItem?.status else { return "none" }
        switch status {
        case .readyToPlay: return "readyToPlay"
        case .failed: return "failed"
        case .unknown: return "unknown"
        @unknown default: return "other"
        }
    }

    /// 叠一段一次性动作。连点会从头重播，不排队。
    func playOnce(_ url: URL) {
        guard let actionLayer else { return }
        // 文件不在就别动图层：现在的 `actionLayer.opacity = 1` 会盖住待机画面，
        // 而空 player 什么都画不出来，等于人为造一次黑屏。
        guard mediaUsable(url) else {
            badURLs.insert(url.path)
            degrade("动作素材缺失：\(url.lastPathComponent)")
            return
        }
        token += 1
        let mine = token
        fadedOut = false

        actionPlayer.pause()
        let item = AVPlayerItem(url: url)
        observe(item, url: url, role: .action)
        actionPlayer.replaceCurrentItem(with: item)
        actionPlayer.seek(to: .zero, toleranceBefore: .zero, toleranceAfter: .zero)

        actionLayer.removeAnimation(forKey: "fade")
        actionLayer.opacity = 1
        let fadeIn = CABasicAnimation(keyPath: "opacity")
        fadeIn.fromValue = 0
        fadeIn.toValue = 1
        fadeIn.duration = 0.22
        fadeIn.timingFunction = CAMediaTimingFunction(name: .easeOut)
        actionLayer.add(fadeIn, forKey: "fadeIn")
        if !paused { actionPlayer.play() }

        // 尾帧淡出必须提前 0.45s 起，等 DidPlayToEndTime 通知已经太晚：
        // 那时画面停在末帧，姿势多半没回到锚点，看起来是「顿一下才消失」。
        if let timeObserver { actionPlayer.removeTimeObserver(timeObserver) }
        timeObserver = actionPlayer.addPeriodicTimeObserver(
            forInterval: CMTime(value: 1, timescale: 20), queue: .main) { [weak self] time in
                MainActor.assumeIsolated {
                    guard let self, self.token == mine, !self.fadedOut else { return }
                    guard let item = self.actionPlayer.currentItem else { return }
                    let duration = item.duration.seconds
                    guard duration.isFinite, duration > 0.6 else { return }
                    if time.seconds >= duration - 0.45 { self.fadeOut() }
                }
            }
    }

    private func fadeOut() {
        guard let actionLayer, !fadedOut else { return }
        fadedOut = true
        let mine = token
        actionLayer.opacity = 0
        let fade = CABasicAnimation(keyPath: "opacity")
        fade.fromValue = 1
        fade.toValue = 0
        fade.duration = 0.42
        fade.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
        actionLayer.add(fade, forKey: "fade")
        // 淡完再停，省掉后台解码；中途被新动作打断就不动它。
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.55) { [weak self] in
            MainActor.assumeIsolated {
                guard let self, self.token == mine else { return }
                self.actionPlayer.pause()
            }
        }
    }

    // MARK: 失败收敛

    private enum ItemRole { case ambient, action }

    /// 每次观察都留一份自己的引用。以前只有 `statusObservation` 一个槽位：
    /// 第二个 item 一来就把第一个的观察顶掉了，先那个 failed 时没人知道。
    private func observe(_ item: AVPlayerItem, url: URL, role: ItemRole) {
        let observation = item.observe(\.status, options: [.new]) { [weak self] item, _ in
            guard item.status == .failed else { return }
            let reason = item.error?.localizedDescription ?? "素材无法解码"
            DispatchQueue.main.async {
                MainActor.assumeIsolated {
                    guard let self else { return }
                    switch role {
                    case .action:
                        // 动作层失败也要收起，否则它一直保持 opacity=1 压在上面。
                        self.fadeOut()
                        self.degrade("动作播放失败（\(url.lastPathComponent)）：\(reason)")
                    case .ambient:
                        self.handleAmbientFailure(url: url, reason: reason)
                    }
                }
            }
        }
        observations.append(observation)
        if observations.count > 8 { observations.removeFirst(observations.count - 8) }
    }

    /// 前台那段解不出来：把仍在另一层的那段重新推上来，别让画面空着。
    private func handleAmbientFailure(url: URL, reason: String) {
        badURLs.insert(url.path)
        guard let current = playerURL[front] ?? nil, current == url else {
            // 不是前台（例如刚被换下去的那层），记录即可。
            degrade("待机素材解码失败（\(url.lastPathComponent)）：\(reason)")
            return
        }
        if let prior = playerURL[1 - front] ?? nil, prior != url, mediaUsable(prior) {
            recoveries += 1
            let bad = front
            front = 1 - front
            CATransaction.begin()
            CATransaction.setDisableActions(true)
            layers[front].removeAnimation(forKey: "xfade")
            layers[front].opacity = 1
            layers[bad].removeAnimation(forKey: "xfade")
            layers[bad].opacity = 0
            CATransaction.commit()
            players[bad].pause()
            playerURL[bad] = nil
            if !paused { players[front].play() }
            degrade("「\(url.lastPathComponent)」无法播放，画面已退回上一段。")
        } else {
            degrade("待机素材解码失败（\(url.lastPathComponent)）：\(reason)")
        }
    }

    /// 文件在、而且不是空的。便宜的本地检查，先把「删了/拷了一半」挡在前面；
    /// 编码问题由上面的 failed 回调兜。
    ///
    /// 必须先解符号链接：`attributesOfItem` 给的是链接本身的大小（几十字节），
    /// 不解的话，内容包用符号链接引用外部素材会被当成空文件而拒播。
    private func mediaUsable(_ url: URL) -> Bool {
        let path = url.resolvingSymlinksInPath().path
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: path, isDirectory: &isDirectory),
              !isDirectory.boolValue else { return false }
        let attributes = try? FileManager.default.attributesOfItem(atPath: path)
        let size = (attributes?[.size] as? NSNumber)?.int64Value ?? 0
        return size > 1024
    }

    /// 给上层用：内容层发现了自己修不了的问题（比如声明的素材文件不存在），
    /// 让舞台把它记进健康度和错误里，界面显示的和自检读的是同一份状态。
    func flagMissing(_ message: String) { degrade(message) }

    /// 同一个问题只弹一次气泡，避免轮换时反复刷屏。
    private func degrade(_ message: String) {
        health = .degraded
        lastError = message
        let now = Date()
        if let lastReport, lastReport.message == message, now.timeIntervalSince(lastReport.at) < 20 { return }
        lastReport = (message, now)
        onError?(message)
    }
}

// MARK: - 舞台视图

final class StageView: NSView {
    private let sleepPlayer = AVQueuePlayer()
    private let sleepLayer = AVPlayerLayer()
    private var sleepLooper: AVPlayerLooper?
    private var sleepReady: NSKeyValueObservation?
    private var sleepStatus: NSKeyValueObservation?
    private(set) var sleepSceneActive = false
    var sleepSceneRate: Float { sleepPlayer.rate }

    @discardableResult
    func enterSleepScene(_ url: URL) -> Bool {
        guard FileManager.default.fileExists(atPath: url.path) else { return false }
        exitSleepScene()
        finishCharacterReaction()
        sleepSceneActive = true
        let item = AVPlayerItem(url: url)
        sleepReady = sleepLayer.observe(\.isReadyForDisplay, options: [.initial, .new]) { [weak self] video, _ in
            DispatchQueue.main.async {
                guard let self, self.sleepSceneActive, video.isReadyForDisplay else { return }
                self.sleepLayer.isHidden = false
                self.characterPlayer.pause()
                self.backgroundPlayer.pause()
            }
        }
        sleepStatus = item.observe(\.status, options: [.new]) { [weak self] item, _ in
            guard item.status == .failed else { return }
            DispatchQueue.main.async {
                self?.exitSleepScene()
                self?.onBackgroundError?("睡眠视频无法播放，已恢复陪伴画面。")
            }
        }
        sleepLooper = AVPlayerLooper(player: sleepPlayer, templateItem: item)
        if !scenePaused { sleepPlayer.play() }
        return true
    }

    func exitSleepScene() {
        sleepSceneActive = false
        sleepReady = nil
        sleepStatus = nil
        sleepLayer.isHidden = true
        sleepPlayer.pause()
        sleepLooper = nil
        sleepPlayer.removeAllItems()
        if !scenePaused {
            if characterIsVideo { characterPlayer.play() }
            if backgroundIsVideo { backgroundPlayer.play() }
        }
    }

    private let sceneLayer = CALayer()
    private let backgroundVideoLayer = AVPlayerLayer()
    private let characterLayer = CALayer()
    private let characterVideoLayer = AVPlayerLayer()
    private let characterPlayer = AVQueuePlayer()
    private let reactionPlayer = AVPlayer()
    private let reactionLayer = AVPlayerLayer()
    private var reactionStatus: NSKeyValueObservation?
    private var reactionEnd: NSObjectProtocol?
    private var reactionGate: Timer?
    /// 动作「等开场」的兜底计时器。解码卡住、或者一直在等循环锚点却等不到时，
    /// reactionPending 会永远为真，而 reactionPlaying=true 会把之后所有点击都挡掉——
    /// 表现就是「点她没反应了」。必须有超时把它收敛回待机。
    private var reactionDeadline: Timer?
    private let reactionStartTimeout: TimeInterval = 4.0
    private var reactionPrepared = false
    private var reactionPreparationStarted = false
    private var alignReactionCuts = false
    private var reactionRequestedAt = Date()
    private(set) var lastReactionWaitSeconds = 0.0
    private(set) var lastReactionEntryIdleTime = 0.0
    private(set) var lastReactionEntryIdleDuration = 0.0
    private(set) var reactionPending = false
    private(set) var reactionPlaying = false
    var reactionRate: Float { reactionPlayer.rate }
    var reactionVisible: Bool { !reactionLayer.isHidden && characterVideoLayer.isHidden }

    /// Decode the reaction first; matched packs enter at the idle loop's anchor.
    /// Idle keeps moving while a click waits for that boundary (under two seconds
    /// in the whale pack). The matching idle first frame is prepared during action.
    @discardableResult
    func playCharacterReaction(_ url: URL) -> Bool {
        guard hasCharacter, !reactionPlaying, !scenePaused else { return false }
        reactionRequestedAt = Date()
        reactionPlaying = true
        reactionPending = true
        reactionPrepared = false
        reactionPreparationStarted = false
        let item = AVPlayerItem(url: url)
        reactionPlayer.replaceCurrentItem(with: item)
        reactionStatus = item.observe(\.status, options: [.initial, .new]) { [weak self] item, _ in
            DispatchQueue.main.async {
                guard let self, self.reactionPlayer.currentItem === item else { return }
                if item.status == .failed {
                    self.finishCharacterReaction()
                    self.onBackgroundError?("互动视频无法播放，已回到待机。")
                } else if item.status == .readyToPlay, !self.reactionPreparationStarted {
                    self.reactionPreparationStarted = true
                    self.reactionPlayer.preroll(atRate: 1) { [weak self] ready in
                        DispatchQueue.main.async {
                            guard let self, self.reactionPlayer.currentItem === item else { return }
                            if ready { self.reactionPrepared = true }
                            else { self.finishCharacterReaction() }
                        }
                    }
                }
            }
        }
        reactionEnd = NotificationCenter.default.addObserver(forName: .AVPlayerItemDidPlayToEndTime,
                                                             object: item, queue: .main) { [weak self] _ in
            self?.finishCharacterReaction()
        }
        reactionGate = Timer.scheduledTimer(withTimeInterval: 0.01, repeats: true) { [weak self] _ in
            self?.beginPreparedReaction()
        }
        armReactionDeadline()
        return true
    }

    /// 动作迟迟没真正开始就放弃，回到待机。
    private func armReactionDeadline() {
        reactionDeadline?.invalidate()
        // 等锚点的策略下，合法的等待最长要等一整个待机循环（quiet-idle-loop 是 7.5 秒），
        // 固定 4 秒会把正常的等待误判成卡死。
        let seconds = reactionStartBudget()
        // .common 模式：拉菜单、拖窗口时也要走，否则「卡住」永远不超时。
        let timer = Timer(timeInterval: seconds, repeats: false) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self, self.reactionPlaying, self.reactionPending else { return }
                self.finishCharacterReaction()
                self.onBackgroundError?("动作没能开始播放，已回到待机。")
            }
        }
        RunLoop.main.add(timer, forMode: .common)
        reactionDeadline = timer
    }

    private func reactionStartBudget() -> TimeInterval {
        guard alignReactionCuts else { return reactionStartTimeout }
        let idle = characterPlayer.currentItem?.duration.seconds ?? 0
        guard idle.isFinite, idle > 0 else { return reactionStartTimeout }
        return max(reactionStartTimeout, min(idle + 1.5, 20))
    }

    private func beginPreparedReaction() {
        guard reactionPending, reactionPrepared, reactionLayer.isReadyForDisplay, !scenePaused else { return }
        if alignReactionCuts, characterIsVideo {
            let time = characterPlayer.currentTime().seconds
            let duration = characterPlayer.currentItem?.duration.seconds ?? 0
            guard time.isFinite, duration.isFinite, duration > 0,
                  time < 1.0 / 24 || time >= duration - 1.0 / 24 else { return }
        }
        lastReactionWaitSeconds = Date().timeIntervalSince(reactionRequestedAt)
        lastReactionEntryIdleTime = characterPlayer.currentTime().seconds
        lastReactionEntryIdleDuration = characterPlayer.currentItem?.duration.seconds ?? 0
        reactionGate?.invalidate()
        reactionGate = nil
        reactionPending = false
        // Pause + seek while covered, leaving the anchor decoded for the return.
        if alignReactionCuts {
            characterPlayer.pause()
            characterPlayer.seek(to: .zero, toleranceBefore: .zero, toleranceAfter: .zero)
        }
        reactionLayer.isHidden = false
        characterVideoLayer.isHidden = true
        reactionPlayer.play()
    }

    private func finishCharacterReaction() {
        reactionGate?.invalidate()
        reactionGate = nil
        reactionDeadline?.invalidate()
        reactionDeadline = nil
        reactionStatus = nil
        if let reactionEnd { NotificationCenter.default.removeObserver(reactionEnd) }
        reactionEnd = nil
        reactionPlayer.cancelPendingPrerolls()
        reactionLayer.isHidden = true
        characterVideoLayer.isHidden = !characterIsVideo
        reactionPlayer.pause()
        reactionPlayer.replaceCurrentItem(with: nil)
        reactionPlaying = false
        reactionPending = false
        reactionPrepared = false
        if characterIsVideo, !scenePaused { characterPlayer.play() }
    }

    deinit {
        reactionGate?.invalidate()
        reactionDeadline?.invalidate()
        if let reactionEnd { NotificationCenter.default.removeObserver(reactionEnd) }
    }
    private var characterLooper: AVPlayerLooper?
    private var characterObservation: NSKeyValueObservation?
    private(set) var characterIsVideo = false
    var characterRate: Float { characterPlayer.rate }
    var characterTime: Double { characterPlayer.currentTime().seconds }
    private let backgroundPlayer = AVQueuePlayer()
    private var backgroundLooper: AVPlayerLooper?
    private var backgroundObservation: NSKeyValueObservation?
    private(set) var backgroundIsVideo = false
    private(set) var hasCharacter = false
    private var characterCenter = CGPoint(x: 0.74, y: 0.49)
    private var characterHeight: CGFloat = 1.22
    private var characterAspect: CGFloat = 2.0 / 3.0
    var onBackgroundError: ((String) -> Void)?
    let idleLayerA = AVPlayerLayer()
    let idleLayerB = AVPlayerLayer()
    let actionLayer = AVPlayerLayer()
    private(set) var hasScene = false
    private(set) var scenePaused = true
    var characterFrame: CGRect { characterLayer.frame }
    var backgroundRate: Float { backgroundPlayer.rate }
    var placement: [String: Double] {
        ["x": Double(characterCenter.x), "y": Double(characterCenter.y), "height": Double(characterHeight)]
    }

    func restorePlacement(_ value: [String: Double]) {
        guard let x = value["x"], let y = value["y"], let height = value["height"],
              x.isFinite, y.isFinite, height.isFinite else { return }
        characterCenter = CGPoint(x: min(max(x, 0), 1), y: min(max(y, 0), 1))
        characterHeight = min(max(height, 0.35), 1.5)
        needsLayout = true
    }

    func loadCharacter(_ url: URL, alignReactions: Bool = false) -> Bool {
        finishCharacterReaction()
        alignReactionCuts = alignReactions
        if ["mov", "mp4", "m4v"].contains(url.pathExtension.lowercased()) {
            let asset = AVURLAsset(url: url)
            guard let track = asset.tracks(withMediaType: .video).first else { return false }
            let size = track.naturalSize.applying(track.preferredTransform)
            guard abs(size.width) > 0, abs(size.height) > 0 else { return false }
            characterPlayer.pause()
            characterLooper = nil
            characterPlayer.removeAllItems()
            let item = AVPlayerItem(asset: asset)
            characterObservation = item.observe(\.status, options: [.new]) { [weak self] item, _ in
                guard item.status == .failed else { return }
                DispatchQueue.main.async { self?.onBackgroundError?("人物视频无法播放，请检查编码。") }
            }
            characterLooper = AVPlayerLooper(player: characterPlayer, templateItem: item)
            characterAspect = abs(size.width / size.height)
            characterLayer.contents = nil
            characterVideoLayer.isHidden = false
            characterIsVideo = true
            hasCharacter = true
            needsLayout = true
            if !scenePaused { characterPlayer.play() }
            return true
        }
        guard let image = NSImage(contentsOf: url), let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil),
              [.first, .last, .premultipliedFirst, .premultipliedLast].contains(cg.alphaInfo) else { return false }
        characterPlayer.pause()
        characterLooper = nil
        characterPlayer.removeAllItems()
        characterObservation = nil
        characterIsVideo = false
        characterVideoLayer.isHidden = true
        characterLayer.contents = cg
        characterLayer.contentsGravity = .resizeAspect
        characterAspect = CGFloat(cg.width) / CGFloat(cg.height)
        hasCharacter = true
        needsLayout = true
        return true
    }

    func moveCharacter(dx: CGFloat, dy: CGFloat) {
        guard bounds.width > 0, bounds.height > 0 else { return }
        characterCenter.x += dx / bounds.width
        characterCenter.y += dy / bounds.height
        needsLayout = true
        layoutSubtreeIfNeeded()
    }

    func scaleCharacter(_ delta: CGFloat) {
        characterHeight = min(max(characterHeight + delta, 0.35), 1.5)
        needsLayout = true
        layoutSubtreeIfNeeded()
    }

    func loadBackground(_ url: URL) -> Bool {
        if let image = NSImage(contentsOf: url), let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil) {
            stopBackgroundVideo()
            sceneLayer.contents = cg
            sceneLayer.contentsGravity = .resizeAspectFill
            hasScene = true
            return true
        }
        guard ["mp4", "mov", "m4v"].contains(url.pathExtension.lowercased()) else { return false }
        stopBackgroundVideo()
        let item = AVPlayerItem(url: url)
        backgroundObservation = item.observe(\.status, options: [.new]) { [weak self] item, _ in
            guard item.status == .failed else { return }
            DispatchQueue.main.async { [weak self] in
                self?.onBackgroundError?("背景视频无法播放，已保留原图片。")
                self?.stopBackgroundVideo()
            }
        }
        backgroundLooper = AVPlayerLooper(player: backgroundPlayer, templateItem: item)
        backgroundIsVideo = true
        backgroundVideoLayer.isHidden = false
        hasScene = true
        if !scenePaused { backgroundPlayer.play() }
        return true
    }

    private func stopBackgroundVideo() {
        backgroundPlayer.pause(); backgroundLooper = nil
        backgroundPlayer.removeAllItems(); backgroundObservation = nil
        backgroundVideoLayer.isHidden = true
        backgroundIsVideo = false
    }

    func loadScene(_ url: URL) -> Bool {
        guard let image = NSImage(contentsOf: url), let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else { return false }
        sceneLayer.contents = cg
        sceneLayer.contentsGravity = .resizeAspectFill
        sceneLayer.masksToBounds = true
        hasScene = true
        return true
    }

    func setScenePaused(_ paused: Bool) {
        scenePaused = paused
        if sleepSceneActive {
            if paused { sleepPlayer.pause() } else { sleepPlayer.play() }
            characterPlayer.pause()
            backgroundPlayer.pause()
            reactionPlayer.pause()
            return
        }
        if paused { reactionPlayer.pause() }
        else if reactionPlaying, !reactionPending { reactionPlayer.play() }
        sceneLayer.removeAnimation(forKey: "ambient")
        characterLayer.removeAnimation(forKey: "ambient")
        if paused { backgroundPlayer.pause() } else if backgroundIsVideo { backgroundPlayer.play() }
        if paused { characterPlayer.pause() } else if characterIsVideo, !alignReactionCuts || !reactionPlaying || reactionPending { characterPlayer.play() }
        if characterIsVideo { return }
        guard hasScene, !paused, !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion else { return }
        if hasCharacter {
            // Layer motion is a placeholder; it does not animate the face or limbs.
            let breathing = CABasicAnimation(keyPath: "transform.translation.y")
            breathing.fromValue = 0; breathing.toValue = 1.5
            breathing.duration = 3.5; breathing.autoreverses = true; breathing.repeatCount = .infinity
            breathing.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
            characterLayer.add(breathing, forKey: "ambient")
            return
        }
        // A gentle camera drift, not character or lip animation.
        let drift = CABasicAnimation(keyPath: "transform.scale")
        drift.fromValue = 1; drift.toValue = 1.018
        drift.duration = 7; drift.autoreverses = true; drift.repeatCount = .infinity
        drift.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
        sceneLayer.add(drift, forKey: "ambient")
    }

    func react() {
        guard hasScene, !characterIsVideo, !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion else { return }
        let glow = CAKeyframeAnimation(keyPath: "opacity")
        glow.values = [1, 0.82, 1]; glow.duration = 0.45
        (hasCharacter ? characterLayer : sceneLayer).add(glow, forKey: "touch")
    }

    // Let the parent receive taps and drags on the scene.
    override func hitTest(_ point: NSPoint) -> NSView? { nil }

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        wantsLayer = true
        layer?.backgroundColor = NSColor(white: 0.05, alpha: 1).cgColor
        layer?.addSublayer(sceneLayer)
        backgroundVideoLayer.player = backgroundPlayer
        backgroundPlayer.isMuted = true
        backgroundVideoLayer.videoGravity = .resizeAspectFill
        backgroundVideoLayer.isHidden = true
        layer?.addSublayer(backgroundVideoLayer)
        for layer in [idleLayerA, idleLayerB, actionLayer] {
            layer.videoGravity = .resizeAspectFill
            layer.backgroundColor = NSColor.clear.cgColor
            self.layer?.addSublayer(layer)
        }
        layer?.addSublayer(characterLayer)
        characterVideoLayer.player = characterPlayer
        characterPlayer.isMuted = true
        characterVideoLayer.videoGravity = .resizeAspect
        characterVideoLayer.backgroundColor = NSColor.clear.cgColor
        characterVideoLayer.isHidden = true
        characterLayer.addSublayer(characterVideoLayer)
        reactionLayer.player = reactionPlayer
        reactionPlayer.isMuted = true
        reactionLayer.videoGravity = .resizeAspect
        reactionLayer.backgroundColor = NSColor.clear.cgColor
        reactionLayer.isHidden = true
        characterLayer.addSublayer(reactionLayer)
        sleepLayer.player = sleepPlayer
        sleepPlayer.isMuted = true
        sleepLayer.videoGravity = .resizeAspectFill
        sleepLayer.isHidden = true
        layer?.addSublayer(sleepLayer)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) not supported") }

    override func layout() {
        super.layout()
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        sceneLayer.frame = bounds
        backgroundVideoLayer.frame = bounds
        idleLayerA.frame = bounds
        idleLayerB.frame = bounds
        actionLayer.frame = bounds
        sleepLayer.frame = bounds
        if hasCharacter, bounds.height > 0, bounds.width > 0 {
            let height = bounds.height * characterHeight
            let width = min(bounds.width, height * characterAspect)
            let x = min(max(characterCenter.x * bounds.width - width / 2, 0), bounds.width - width)
            let y = min(max(characterCenter.y * bounds.height - height / 2, 0), bounds.height - height)
            characterLayer.frame = CGRect(x: x, y: y, width: width, height: height)
            characterVideoLayer.frame = characterLayer.bounds
            reactionLayer.frame = characterLayer.bounds
            characterCenter = CGPoint(x: (x + width / 2) / bounds.width, y: (y + height / 2) / bounds.height)
        }
        CATransaction.commit()
    }
}
