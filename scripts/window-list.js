// 列出当前屏幕上所有窗口（CGWindowList，只读）
// 用法: osascript -l JavaScript scripts/window-list.js
ObjC.import("CoreGraphics");
var l = $.CGWindowListCopyWindowInfo($.kCGWindowListOptionOnScreenOnly, $.kCGNullWindowID);
var a = ObjC.deepUnwrap(ObjC.castRefToObject(l));
var out = [];
for (var i = 0; i < a.length; i++) {
  var w = a[i];
  var b = w.kCGWindowBounds || {};
  out.push({
    owner: w.kCGWindowOwnerName || "",
    layer: w.kCGWindowLayer,
    pid: w.kCGWindowOwnerPID,
    x: Math.round(b.X || 0), y: Math.round(b.Y || 0),
    w: Math.round(b.Width || 0), h: Math.round(b.Height || 0),
  });
}
JSON.stringify(out);
