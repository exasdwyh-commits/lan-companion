"use strict";
// Geometry only: no Electron, settings, or model dependencies.
function clamp(value, min, max) { return Math.min(Math.max(value, min), Math.max(min, max)); }
function fit(rect, area) {
  const width = Math.round(clamp(rect.width, 1, area.width));
  const height = Math.round(clamp(rect.height, 1, area.height));
  return { x: Math.round(clamp(rect.x, area.x, area.x + area.width - width)),
    y: Math.round(clamp(rect.y, area.y, area.y + area.height - height)), width, height };
}
function worldBounds(area, previous) {
  // 小屋成为主场景之后，640×360 太挤了：面板、聊天栏、墙上的照片都要地方。
  // 仍然受屏幕尺寸限制，并且记住用户拖过的大小。
  const width = Math.round(clamp(previous?.width || 960, Math.min(360, area.width), Math.min(960, area.width, area.height * 16 / 9)));
  const height = Math.round(width * 9 / 16);
  return fit({ width, height, x: previous?.x ?? area.x + area.width - width - 24,
    y: previous?.y ?? area.y + area.height - height - 100 }, area);
}
function composerBounds(area, expanded, previous) {
  const width = Math.min(expanded ? 340 : 64, area.width);
  const height = Math.min(expanded ? 440 : 64, area.height);
  const right = previous ? previous.x + previous.width : area.x + area.width - 24;
  const bottom = previous ? previous.y + previous.height : area.y + area.height - 24;
  return fit({ x: right - width, y: bottom - height, width, height }, area);
}
module.exports = { worldBounds, composerBounds, fit };
