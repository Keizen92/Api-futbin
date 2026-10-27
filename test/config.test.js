import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig, validateConfig } from "../src/config.js";

test("config enables automatic price refresh by default", () => {
  const config = validateConfig(loadConfig({ FUTBIN_API_KEY: "test-key" }));

  assert.equal(config.priceAutoRefresh, true);
  assert.equal(config.priceRefreshIntervalSeconds, 60);
  assert.equal(config.priceRefreshTickSeconds, 15);
  assert.equal(config.priceRefreshBatchSize, 3);
  assert.equal(config.priceRefreshMaxTracked, 20);
  assert.ok(config.priceRefreshTrackTtlSeconds >= 120);
  assert.deepEqual(config.priceWatchPlayers, []);
});

test("config clamps price refresh values and parses the watchlist", () => {
  const config = loadConfig({
    FUTBIN_API_KEY: "test-key",
    PRICE_AUTO_REFRESH: "false",
    PRICE_REFRESH_INTERVAL_SECONDS: "30",
    PRICE_REFRESH_TICK_SECONDS: "999",
    PRICE_REFRESH_BATCH_SIZE: "500",
    PRICE_REFRESH_MAX_TRACKED: "5",
    PRICE_WATCH_PLAYERS: "8, 22, abc, 8, -3",
  });

  assert.equal(config.priceAutoRefresh, false);
  assert.equal(config.priceRefreshIntervalSeconds, 30);
  assert.equal(config.priceRefreshTickSeconds, 30);
  assert.equal(config.priceRefreshBatchSize, 5);
  assert.equal(config.priceRefreshMaxTracked, 5);
  assert.deepEqual(config.priceWatchPlayers, [8, 22]);
  assert.ok(config.priceRefreshTrackTtlSeconds >= 60);
});
