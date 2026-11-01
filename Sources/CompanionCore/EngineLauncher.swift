import Darwin
import Foundation

/// 引擎端口探测。
///
/// 两个要点，都是实测结论：
/// 1. 探测必须走 TCP connect，不能用 URLSession——后者会吃系统代理，本机
///    127.0.0.1 被代理拦掉时表现为「引擎明明在跑却连不上」，极难定位。
/// 2. 这里刻意不负责启动引擎。GUI 应用用 Process 起一个带 currentDirectoryURL
///    的子进程会卡在启动阶段：连 app.py 都打不开、也不报错，而同样的命令交给
///    Python subprocess 完全正常。所以引擎由桥脚本自己拉起。
public struct EngineLauncher {
    public let port: Int

    public init?(baseURL: String) {
        guard let port = Self.port(of: baseURL) else { return nil }
        self.port = port
    }

    /// 只认本机地址；远端引擎不在本文件的职责内。
    public static func port(of baseURL: String) -> Int? {
        guard let parts = URLComponents(string: baseURL),
              let host = parts.host,
              host == "127.0.0.1" || host == "localhost",
              let port = parts.port else { return nil }
        return port
    }

    /// 连一次 TCP。本机端口没监听时会立刻返回 ECONNREFUSED，不会真的等满超时。
    public var isListening: Bool {
        let fd = socket(AF_INET, SOCK_STREAM, 0)
        guard fd >= 0 else { return false }
        defer { close(fd) }
        var timeout = timeval(tv_sec: 1, tv_usec: 0)
        setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &timeout, socklen_t(MemoryLayout<timeval>.stride))
        setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &timeout, socklen_t(MemoryLayout<timeval>.stride))
        var address = sockaddr_in()
        address.sin_family = sa_family_t(AF_INET)
        address.sin_len = UInt8(MemoryLayout<sockaddr_in>.stride)
        address.sin_port = UInt16(port).bigEndian
        address.sin_addr.s_addr = inet_addr("127.0.0.1")
        return withUnsafePointer(to: &address) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { raw in
                connect(fd, raw, socklen_t(MemoryLayout<sockaddr_in>.stride)) == 0
            }
        }
    }

    /// 引擎自己的启动日志，桥起引擎时写在这里，出问题直接翻它。
    public static var logFile: String {
        NSTemporaryDirectory() + "lingdesk-engine.log"
    }
}
