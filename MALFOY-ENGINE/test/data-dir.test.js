"use strict";
// 数据目录解析的单元测试。不需要 Electron、不开窗口、不碰真实数据。
// 运行：node --test MALFOY-ENGINE/test/

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");

const { resolveDataDir, userDataDirFor } = require("../lib/data-dir");

const HOME = "/Users/test-home";

test("默认走旧目录，且标记为不隔离", () => {
  const r = resolveDataDir({ argv: [], env: {}, home: HOME });
  assert.equal(r.dir, path.join(HOME, ".smartcompanion"));
  assert.equal(r.source, "default");
  assert.equal(r.explicit, false);
  assert.equal(r.isDefault, true);
});

test("--data-dir /tmp/x 优先于环境变量", () => {
  const r = resolveDataDir({
    argv: ["--data-dir", "/tmp/isolated"],
    env: { LAN_DATA_DIR: "/tmp/from-env" },
    home: HOME,
  });
  assert.equal(r.dir, "/tmp/isolated");
  assert.equal(r.source, "argv");
  assert.equal(r.explicit, true);
  assert.equal(r.isDefault, false);
});

test("支持 --data-dir=/tmp/x 这种等号写法", () => {
  const r = resolveDataDir({ argv: ["--data-dir=/tmp/eq"], env: {}, home: HOME });
  assert.equal(r.dir, "/tmp/eq");
  assert.equal(r.source, "argv");
});

test("环境变量在没传参时生效，三个兼容键都认", () => {
  for (const key of ["LAN_DATA_DIR", "LINGDESK_DATA_DIR", "PET_DATA_DIR"]) {
    const r = resolveDataDir({ argv: [], env: { [key]: "/tmp/env-" + key }, home: HOME });
    assert.equal(r.dir, "/tmp/env-" + key, key + " 应被识别");
    assert.equal(r.source, "env");
    assert.equal(r.explicit, true);
  }
});

test("相对路径按 cwd 解析成绝对路径", () => {
  const r = resolveDataDir({
    argv: ["--data-dir", "tmp/run"],
    env: {},
    home: HOME,
    cwd: "/work/project",
  });
  assert.equal(r.dir, "/work/project/tmp/run");
});

test("显式传的就是默认目录时给出警告（假装隔离的坑）", () => {
  const r = resolveDataDir({ argv: ["--data-dir", path.join(HOME, ".smartcompanion")], env: {}, home: HOME });
  assert.equal(r.explicit, true);
  assert.equal(r.isDefault, true);
  assert.ok(r.warning && r.warning.includes("隔离无效"), "应警告隔离无效");
});

test("--data-dir 后面没跟值时不吞掉下一个参数，回落到默认并可报告", () => {
  const r = resolveDataDir({ argv: ["--data-dir", "--print-data-dir"], env: {}, home: HOME });
  assert.equal(r.dir, path.join(HOME, ".smartcompanion"));
  assert.equal(r.explicit, false);
});

test("空字符串环境变量不算指定", () => {
  const r = resolveDataDir({ argv: [], env: { LAN_DATA_DIR: "   " }, home: HOME });
  assert.equal(r.isDefault, true);
  assert.equal(r.source, "default");
});

test("userData 落在隔离目录内，不污染 Application Support", () => {
  const dir = path.join(os.tmpdir(), "lan-test");
  assert.equal(userDataDirFor(dir), path.join(dir, "electron"));
  assert.ok(userDataDirFor(dir).startsWith(dir));
});
