// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "LingDesk",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "LingDesk", targets: ["LingDesk"]),
        .executable(name: "PetDesk", targets: ["PetDesk"])
    ],
    targets: [
        .target(name: "CompanionCore"),
        .executableTarget(name: "LingDesk", dependencies: ["CompanionCore"]),
        // 桌面宠物：刻意不用 SwiftUI。一是这套工具链缺 SwiftUI 宏插件，
        // 二是桌宠要精确接管鼠标、图层和窗口层级，AppKit 直接写更省事。
        .executableTarget(name: "PetDesk", dependencies: ["CompanionCore"]),
        .testTarget(name: "CompanionCoreTests", dependencies: ["CompanionCore"])
    ]
)
