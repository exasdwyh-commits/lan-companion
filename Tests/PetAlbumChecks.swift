import AppKit

@main struct PetAlbumChecks {
    @MainActor static func main() async throws {
        NSApplication.shared.setActivationPolicy(.accessory)
        let args = CommandLine.arguments
        let root = URL(fileURLWithPath: args[1])
        guard let pack = PetPack.load(from: root), let items = pack.album else {
            fatalError("Cannot load album")
        }
        var checks: [String: Bool] = [:]
        checks["twenty_six_unique_items"] = items.count == 26 && Set(items.map(\.id)).count == 26
        checks["four_starter_rewards"] = items.filter { pack.lockedReasonForAlbum($0, affinity: 0) == nil }.count == 4
        checks["all_rewards_reachable"] = items.allSatisfy { pack.lockedReasonForAlbum($0, affinity: 90) == nil }
        checks["all_wallpapers_decode_landscape"] = items.allSatisfy { item in
            guard let url = pack.file(item.file), let data = try? Data(contentsOf: url),
                  let bitmap = NSBitmapImageRep(data: data) else { return false }
            return bitmap.pixelsWide >= 1600 && bitmap.pixelsHigh >= 900
                && abs(Double(bitmap.pixelsWide) / Double(bitmap.pixelsHigh) - 16.0 / 9.0) < 0.02
        }
        let album = PetAlbumWindow()
        album.present(pack: pack, affinity: 0)
        guard let window = NSApp.windows.first(where: { $0.title == "相册 · 4 / \(items.count)" }),
              let scroll = window.contentView as? NSScrollView,
              let document = scroll.documentView else { fatalError("Missing album scroll view") }
        checks["window_fits_screen"] = window.frame.height <= (NSScreen.main?.visibleFrame.height ?? 900)
        checks["twenty_six_scrollable_cards"] = document.subviews.compactMap { $0 as? PetAlbumCell }.count == 26
            && scroll.hasVerticalScroller && document.frame.height > scroll.contentSize.height
        checks["opens_at_first_row"] = scroll.documentVisibleRect.maxY >= document.bounds.maxY - 2
        let event = NSEvent.mouseEvent(with: .leftMouseDown, location: .zero, modifierFlags: [],
                                      timestamp: 0, windowNumber: window.windowNumber,
                                      context: nil, eventNumber: 1, clickCount: 1, pressure: 1)!
        let cells = document.subviews.compactMap { $0 as? PetAlbumCell }
        cells.last?.mouseDown(with: event)
        checks["locked_card_does_not_open"] = !NSApp.windows.contains { $0.title == items.last?.place }
        album.present(pack: pack, affinity: 90)
        let fullScroll = window.contentView as! NSScrollView
        let fullDocument = fullScroll.documentView!
        fullScroll.contentView.scroll(to: .zero)
        checks["last_row_is_reachable"] = fullDocument.subviews.last!.frame.intersects(fullScroll.documentVisibleRect)
        (fullDocument.subviews.last as? PetAlbumCell)?.mouseDown(with: event)
        let viewer = NSApp.windows.first { $0.title == items.last?.place }
        checks["last_reward_opens_full_image"] = viewer?.contentView?.subviews.contains { ($0 as? NSImageView)?.image != nil } == true
        checks["wallpaper_save_action_exists"] = viewer?.contentView?.subviews.contains { view in
            guard let button = view as? NSButton else { return false }
            return button.title == "保存壁纸…" && button.target != nil && button.action != nil
        } == true
        let data = try JSONSerialization.data(withJSONObject: checks, options: [.prettyPrinted, .sortedKeys])
        try data.write(to: URL(fileURLWithPath: args[2]))
        print(String(decoding: data, as: UTF8.self))
        if checks.values.contains(false) { exit(1) }
    }
}
