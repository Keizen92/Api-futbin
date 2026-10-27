import assert from "node:assert/strict";
import { once } from "node:events";
import { createApp } from "../src/app.js";
import { createTtlCache } from "../src/cache.js";
import { loadConfig, validateConfig } from "../src/config.js";
import { createFetcher } from "../src/fetcher.js";
import { createPriceRefresher } from "../src/price-refresher.js";
import { createFutbinService } from "../src/service.js";

try {
  process.loadEnvFile?.();
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

const config = validateConfig(loadConfig());
const apiKey = config.apiKeys[0];

if (!apiKey) {
  throw new Error("FUTBIN_API_KEY no está configurada.");
}

const cache = createTtlCache({ maxEntries: config.cacheMaxEntries });
const service = createFutbinService({
  config,
  fetcher: createFetcher(config),
  cache,
});
const silentLogger = { info() {}, warn() {}, error() {} };
const priceRefresher = createPriceRefresher({
  config,
  service,
  logger: silentLogger,
});
const { app } = createApp({ config, service, cache, priceRefresher });
const server = app.listen(0, "127.0.0.1");
await once(server, "listening");
const base = `http://127.0.0.1:${server.address().port}`;
const summary = {};

async function call(path, { auth = true, expectedStatus = 200, method = "GET" } = {}) {
  const startedAt = Date.now();
  const response = await fetch(`${base}${path}`, {
    method,
    headers: auth ? { "x-api-key": apiKey } : {},
  });
  const body = await response.json();
  assert.equal(
    response.status,
    expectedStatus,
    `${path} devolvió ${response.status}: ${JSON.stringify(body)}`,
  );
  return { body, latencyMs: Date.now() - startedAt };
}

function record(name, value) {
  summary[name] = value;
  console.log(`ok ${name} (${value.latencyMs} ms)`);
}

try {
  const health = await call("/health?deep=1", { auth: false });
  assert.equal(health.body.status, "ok");
  assert.equal(health.body.upstreamCheck.reachable, true);
  assert.equal(health.body.priceAutoRefresh.enabled, true);
  record("health", {
    latencyMs: health.latencyMs,
    gameVersion: health.body.gameVersion,
    fetcher: health.body.upstreamCheck.fetcher,
    samplePlayer: health.body.upstreamCheck.samplePlayer,
    priceAutoRefresh: health.body.priceAutoRefresh.intervalSeconds,
  });

  priceRefresher.watch(8, { pinned: true });
  const refreshStartedAt = Date.now();
  const refresh = await priceRefresher.runOnce();
  assert.equal(refresh.refreshed, 1);
  record("priceRefresh", {
    latencyMs: Date.now() - refreshStartedAt,
    refreshed: refresh.refreshed,
    tracked: priceRefresher.status().tracked,
    lastRunAt: priceRefresher.status().lastRunAt,
  });

  const unauthorized = await call("/api/v1/meta", {
    auth: false,
    expectedStatus: 401,
  });
  assert.equal(unauthorized.body.error.code, "unauthorized");

  const meta = await call("/api/v1/meta");
  assert.equal(meta.body.data.gameVersion, config.gameVersion);
  record("meta", {
    latencyMs: meta.latencyMs,
    gameVersion: meta.body.data.gameVersion,
  });

  const players = await call("/api/v1/players?page=1&search=messi");
  assert.ok(players.body.data.players.length > 0);
  const firstPlayer = players.body.data.players[0];
  assert.ok(firstPlayer.id);
  assert.ok(firstPlayer.name);
  record("players", {
    latencyMs: players.latencyMs,
    page: players.body.data.page,
    totalPages: players.body.data.totalPages,
    count: players.body.data.count,
    firstPlayer: firstPlayer.name,
    cached: players.body.meta.cached,
  });

  const player = await call("/api/v1/players/8");
  assert.equal(player.body.data.id, 8);
  assert.ok(player.body.data.name);
  assert.ok(player.body.data.stats.pace > 0);
  assert.ok(player.body.data.prices.ps.lowestBin > 0);
  record("player", {
    latencyMs: player.latencyMs,
    name: player.body.data.name,
    rating: player.body.data.rating,
    pricePs: player.body.data.prices.ps.lowestBin,
    pricePc: player.body.data.prices.pc.lowestBin,
  });

  const prices = await call("/api/v1/players/8/prices?platform=pc");
  assert.equal(prices.body.data.platform, "pc");
  assert.ok(prices.body.data.prices.pc.lowestBin > 0);
  assert.equal(prices.body.data.priceSource, "hover");
  assert.equal(typeof prices.body.data.priceChanged, "boolean");
  if (prices.body.data.priceChanged === false) {
    assert.equal(prices.body.data.priceUpdatedAt, null);
  } else {
    assert.ok(prices.body.data.priceUpdatedAt);
  }
  record("prices", {
    latencyMs: prices.latencyMs,
    platform: prices.body.data.platform,
    lowestBin: prices.body.data.prices.pc.lowestBin,
    priceSource: prices.body.data.priceSource,
    priceChanged: prices.body.data.priceChanged,
    priceUpdatedAt: prices.body.data.priceUpdatedAt,
    priceCheckedAt: prices.body.data.priceCheckedAt,
    priceCached: prices.body.meta.priceCached,
    cached: prices.body.meta.cached,
  });

  const manual = await call(
    "/api/v1/players/8/prices/refresh?platform=pc",
    { method: "POST" },
  );
  assert.equal(typeof manual.body.data.priceChanged, "boolean");
  assert.ok(manual.body.data.priceCheckedAt);
  assert.ok(manual.body.data.priceCheckedAt >= prices.body.data.priceCheckedAt);
  if (manual.body.data.priceChanged === false) {
    assert.equal(manual.body.data.priceUpdatedAt, prices.body.data.priceUpdatedAt);
  } else {
    assert.ok(manual.body.data.priceUpdatedAt >= prices.body.data.priceUpdatedAt);
  }
  record("manualPriceRefresh", {
    latencyMs: manual.latencyMs,
    priceChanged: manual.body.data.priceChanged,
    priceUpdatedAt: manual.body.data.priceUpdatedAt,
    priceCheckedAt: manual.body.data.priceCheckedAt,
  });

  const hover = await call("/api/v1/players/8/hover");
  assert.equal(hover.body.data.id, 8);
  assert.ok(hover.body.data.name);
  assert.ok(hover.body.data.prices.ps.value > 0);
  record("hover", {
    latencyMs: hover.latencyMs,
    name: hover.body.data.name,
    rating: hover.body.data.rating,
  });

  const search = await call("/api/v1/search?q=mbappe");
  assert.ok(search.body.data.count > 0);
  record("search", {
    latencyMs: search.latencyMs,
    count: search.body.data.count,
    firstResult: search.body.data.results[0].name,
  });

  console.log("\nComprobación live completada.");
  console.log(JSON.stringify(summary, null, 2));
} finally {
  await new Promise((resolve) => server.close(resolve));
}
