import test from "node:test";
import assert from "node:assert/strict";
import { createPriceRefresher } from "../src/price-refresher.js";

function createConfig(overrides = {}) {
  return {
    priceAutoRefresh: true,
    priceRefreshIntervalSeconds: 60,
    priceRefreshTickSeconds: 15,
    priceRefreshBatchSize: 2,
    priceRefreshMaxTracked: 3,
    priceRefreshTrackTtlSeconds: 300,
    priceWatchPlayers: [],
    ...overrides,
  };
}

function createHarness({
  config = createConfig(),
  failing = [],
  changing = [],
} = {}) {
  const calls = [];
  const clock = { value: 1_700_000_000_000 };
  const failed = new Set(failing);
  const changed = new Set(changing);
  const service = {
    async refreshPrices(id) {
      calls.push(id);
      if (failed.has(id)) {
        throw new Error(`upstream failed for ${id}`);
      }
      return { data: { id, priceChanged: changed.has(id) } };
    },
  };
  const refresher = createPriceRefresher({
    config,
    service,
    now: () => clock.value,
  });
  return { calls, clock, refresher, config };
}

test("touch schedules a refresh after the configured interval", async () => {
  const { calls, clock, refresher } = createHarness();

  assert.equal(refresher.touch("8"), true);
  assert.deepEqual(await refresher.runOnce(), {
    attempted: 0,
    refreshed: 0,
    changed: 0,
    failed: 0,
  });
  assert.equal(calls.length, 0);

  clock.value += 59_000;
  await refresher.runOnce();
  assert.equal(calls.length, 0);

  clock.value += 1_000;
  assert.deepEqual(await refresher.runOnce(), {
    attempted: 1,
    refreshed: 1,
    changed: 0,
    failed: 0,
  });
  assert.deepEqual(calls, [8]);
  assert.equal(refresher.status().refreshes, 1);
});

test("counts price changes separately from successful checks", async () => {
  const { clock, refresher } = createHarness({ changing: [8] });

  refresher.touch(8);
  clock.value += 60_000;
  assert.deepEqual(await refresher.runOnce(), {
    attempted: 1,
    refreshed: 1,
    changed: 1,
    failed: 0,
  });
  assert.equal(refresher.status().refreshes, 1);
  assert.equal(refresher.status().changes, 1);
});

test("watchlist players are refreshed immediately and never pruned", async () => {
  const { calls, clock, refresher } = createHarness();

  assert.equal(refresher.watch("8", { pinned: true }), true);
  await refresher.runOnce();
  assert.deepEqual(calls, [8]);

  clock.value += 1_000_000;
  await refresher.runOnce();
  assert.deepEqual(calls, [8, 8]);
  assert.equal(refresher.status().tracked, 1);
  assert.equal(refresher.status().pinned, 1);
});

test("tracks are capped and least recently used players are evicted", async () => {
  const { calls, clock, refresher } = createHarness();

  for (const id of [1, 2, 3, 4]) {
    refresher.touch(id);
    clock.value += 1;
  }

  assert.equal(refresher.status().tracked, 3);
  clock.value += 60_000;
  await refresher.runOnce();
  assert.deepEqual(calls, [2, 3]);

  await refresher.runOnce();
  assert.deepEqual(calls, [2, 3, 4]);
});

test("pinned watchlist entries survive the tracked limit", async () => {
  const { refresher } = createHarness();

  refresher.watch(1, { pinned: true });
  refresher.touch(2);
  refresher.touch(3);
  refresher.touch(4);

  assert.equal(refresher.status().tracked, 3);
  assert.equal(refresher.status().pinned, 1);
});

test("inactive tracked players are pruned", async () => {
  const { calls, clock, refresher } = createHarness();

  refresher.touch(8);
  clock.value += 301_000;
  await refresher.runOnce();

  assert.equal(calls.length, 0);
  assert.equal(refresher.status().tracked, 0);
});

test("failures are reported without breaking the scheduler", async () => {
  const { calls, clock, refresher } = createHarness({ failing: [8] });

  refresher.touch(8);
  clock.value += 60_000;
  assert.deepEqual(await refresher.runOnce(), {
    attempted: 1,
    refreshed: 0,
    changed: 0,
    failed: 1,
  });
  assert.equal(refresher.status().failures, 1);
  assert.match(refresher.status().lastError, /fallaron/);

  clock.value += 60_000;
  await refresher.runOnce();
  assert.deepEqual(calls, [8, 8]);
});

test("does nothing when automatic refresh is disabled", async () => {
  const { calls, clock, refresher } = createHarness({
    config: createConfig({ priceAutoRefresh: false }),
  });

  assert.equal(refresher.touch(8), false);
  assert.equal(refresher.watch(9), true);
  clock.value += 60_000;
  assert.deepEqual(await refresher.runOnce(), {
    skipped: true,
    reason: "disabled",
  });
  assert.equal(calls.length, 0);
});

test("invalid player ids are ignored", () => {
  const { refresher } = createHarness();

  assert.equal(refresher.touch("abc"), false);
  assert.equal(refresher.touch("-1"), false);
  assert.equal(refresher.watch(0), false);
  assert.equal(refresher.touch(100_000_000), false);
});

