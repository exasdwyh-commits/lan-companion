"use strict";
const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createFishing } = require("../lib/fishing");
const { createAquarium, MAX_TANK } = require("../lib/aquarium");

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "lan-aq-"));
}

describe("aquarium", () => {
  let dir, fishing, tank;
  beforeEach(() => {
    dir = tmp();
    // Seeded rng so cast always hits something at pier.
    let i = 0;
    const rng = () => { i += 1; return (i % 10) / 10; };
    fishing = createFishing({ dir, rng });
    tank = createAquarium({ dir, fishing });
  });
  afterEach(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {} });

  it("starts empty with free slots", () => {
    const s = tank.snapshot();
    assert.equal(s.tank.length, 0);
    assert.equal(s.max, MAX_TANK);
    assert.equal(s.free, MAX_TANK);
  });

  it("puts a bag fish into the tank and removes from bag", () => {
    const cast = fishing.cast({ spot: "pier", weather: "clear", now: Date.now() });
    assert.equal(cast.ok, true);
    const fish = cast.fish;
    const before = fishing.snapshot().bag[fish] || 0;
    assert.ok(before >= 1);
    const put = tank.put(fish);
    assert.equal(put.ok, true);
    assert.equal(put.tank.length, 1);
    assert.equal(put.tank[0].fish, fish);
    assert.equal(fishing.snapshot().bag[fish] || 0, before - 1);
  });

  it("refuses when tank is full", () => {
    for (let n = 0; n < MAX_TANK; n += 1) {
      const cast = fishing.cast({ spot: "pier", weather: "clear", now: Date.now() + n * 10000 });
      assert.equal(cast.ok, true);
      assert.equal(tank.put(cast.fish).ok, true);
    }
    const cast = fishing.cast({ spot: "pier", weather: "clear", now: Date.now() + 99999 });
    assert.equal(cast.ok, true);
    const put = tank.put(cast.fish);
    assert.equal(put.ok, false);
    assert.equal(put.reason, "full");
  });

  it("remove returns fish to the bag", () => {
    const cast = fishing.cast({ spot: "pier", weather: "clear", now: Date.now() });
    tank.put(cast.fish);
    const mid = fishing.snapshot().bag[cast.fish] || 0;
    const out = tank.remove(0);
    assert.equal(out.ok, true);
    assert.equal(out.tank.length, 0);
    assert.equal(fishing.snapshot().bag[cast.fish] || 0, mid + 1);
  });

  it("put fails on empty bag", () => {
    const put = tank.put("minnow");
    assert.equal(put.ok, false);
    assert.equal(put.reason, "empty");
  });
});
