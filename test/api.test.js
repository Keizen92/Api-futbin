import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createApp } from "../src/app.js";
import { createTtlCache } from "../src/cache.js";
import { loadConfig } from "../src/config.js";
import { BadRequestError } from "../src/errors.js";

const service = {
  lastPlayersQuery: null,
  async getPlayers(query) {
    this.lastPlayersQuery = query;
    if (query.bad === "1") throw new BadRequestError("Consulta inválida.");
    return {
      data: { page: 1, totalPages: 10, count: 0, players: [], query },
      meta: { cached: false, sourceUrl: "https://www.futbin.com/27/players" },
    };
  },
  async getPlayer(id) {
    return {
      data: { id: Number(id), name: `Player ${id}` },
      meta: { cached: false },
    };
  },
  async getPlayerPrices(id, platform) {
    return {
      data: {
        id: Number(id),
        platform,
        prices: { [platform === "all" ? "ps" : platform]: { lowestBin: 100 } },
        priceSource: "hover",
        priceChanged: true,
        priceUpdatedAt: "2026-10-26T00:00:00.000Z",
        priceCheckedAt: "2026-10-26T00:01:00.000Z",
      },
      meta: {
        cached: true,
        priceCached: true,
        priceFetchedAt: "2026-10-26T00:00:00.000Z",
      },
    };
  },
  async getHover(id) {
    return {
      data: { id: Number(id), name: `Hover ${id}` },
      meta: { cached: false },
    };
  },
  async search(query) {
    return {
      data: { q: query.q, count: 1, results: [{ id: 22, name: "Messi" }] },
      meta: { cached: false },
    };
  },
  meta() {
    return { gameVersion: "27", endpoints: ["GET /health"] };
  },
  async deepHealth() {
    return {
      ok: true,
      upstream: { reachable: true, fetcher: "curl", latencyMs: 5, samplePlayer: "Mbappé" },
    };
  },
};

const baseConfig = loadConfig({
  FUTBIN_API_KEY: "secret-key",
  LOG_LEVEL: "silent",
  RATE_LIMIT_PER_MIN: "100",
});

let server;
let base;

const priceRefresher = {
  touched: [],
  touch(id) {
    this.touched.push(Number(id));
  },
  status() {
    return {
      enabled: true,
      intervalSeconds: 60,
      tracked: new Set(this.touched).size,
    };
  },
};

before(async () => {
  const { app } = createApp({
    config: baseConfig,
    service,
    cache: createTtlCache(),
    priceRefresher,
  });
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

async function request(path, { key = "secret-key", headers = {} } = {}) {
  return fetch(`${base}${path}`, {
    headers: { ...(key ? { "x-api-key": key } : {}), ...headers },
  });
}

test("health is public", async () => {
  const response = await request("/health", { key: null });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.status, "ok");
  assert.equal(body.gameVersion, "27");
  assert.equal(body.upstream.cookieConfigured, false);
  assert.equal(body.priceAutoRefresh.enabled, true);
  assert.equal(body.priceAutoRefresh.intervalSeconds, 60);
  assert.ok(response.headers.get("x-request-id"));
});

test("health deep check uses upstream", async () => {
  const response = await request("/health?deep=1", { key: null });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.upstreamCheck.reachable, true);
  assert.equal(body.upstreamCheck.samplePlayer, "Mbappé");
});

test("api rejects missing and invalid keys", async () => {
  const missing = await request("/api/v1/meta", { key: null });
  assert.equal(missing.status, 401);
  assert.match(missing.headers.get("www-authenticate"), /Bearer/);
  const missingBody = await missing.json();
  assert.equal(missingBody.error.code, "unauthorized");

  const invalid = await request("/api/v1/meta", { key: "wrong" });
  assert.equal(invalid.status, 401);
});

test("api accepts X-API-Key and Bearer tokens", async () => {
  const byHeader = await request("/api/v1/meta");
  assert.equal(byHeader.status, 200);
  assert.equal((await byHeader.json()).data.gameVersion, "27");

  const bearer = await request("/api/v1/meta", {
    key: null,
    headers: { authorization: "Bearer secret-key" },
  });
  assert.equal(bearer.status, 200);
});

test("players endpoint forwards filters and returns meta", async () => {
  const response = await request("/api/v1/players?page=2&search=messi");
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.data.query.page, "2");
  assert.equal(body.data.query.search, "messi");
  assert.equal(body.meta.source, "futbin");
  assert.equal(body.meta.cached, false);
  assert.equal(response.headers.get("x-cache"), "MISS");
  assert.ok(body.meta.requestId);
});

test("player, prices, hover and search routes respond", async () => {
  const player = await request("/api/v1/players/8");
  assert.equal(player.status, 200);
  assert.equal((await player.json()).data.id, 8);

  const prices = await request("/api/v1/players/8/prices?platform=pc");
  assert.equal(prices.status, 200);
  const pricesBody = await prices.json();
  assert.equal(pricesBody.data.platform, "pc");
  assert.equal(pricesBody.meta.cached, true);
  assert.equal(pricesBody.meta.priceCached, true);
  assert.ok(pricesBody.meta.priceFetchedAt);
  assert.equal(prices.headers.get("x-cache"), "HIT");

  const hover = await request("/api/v1/players/8/hover");
  assert.equal(hover.status, 200);
  assert.equal((await hover.json()).data.name, "Hover 8");

  const search = await request("/api/v1/search?q=me");
  assert.equal(search.status, 200);
  assert.equal((await search.json()).data.results[0].name, "Messi");

  assert.deepEqual(priceRefresher.touched.slice(-3), [8, 8, 8]);
});

test("manual price refresh route forces a new check", async () => {
  const response = await fetch(`${base}/api/v1/players/8/prices/refresh?platform=pc`, {
    method: "POST",
    headers: { "x-api-key": "secret-key" },
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.data.platform, "pc");
  assert.equal(body.data.priceChanged, true);
  assert.ok(body.data.priceUpdatedAt);
  assert.ok(body.data.priceCheckedAt);
  assert.equal(body.meta.priceCached, true);
});

test("errors are returned as JSON with request id", async () => {
  const bad = await request("/api/v1/players?bad=1");
  assert.equal(bad.status, 400);
  const badBody = await bad.json();
  assert.equal(badBody.error.code, "bad_request");
  assert.ok(badBody.requestId);

  const missing = await request("/does-not-exist");
  assert.equal(missing.status, 404);
  const missingBody = await missing.json();
  assert.equal(missingBody.error.code, "not_found");
});

test("rate limiting returns 429 with Retry-After", async () => {
  const limitedConfig = { ...baseConfig, rateLimitPerMin: 1 };
  const limited = createApp({
    config: limitedConfig,
    service,
    cache: createTtlCache(),
  });
  const limitedServer = limited.app.listen(0, "127.0.0.1");
  await once(limitedServer, "listening");
  const limitedBase = `http://127.0.0.1:${limitedServer.address().port}`;
  try {
    const first = await fetch(`${limitedBase}/api/v1/meta`, {
      headers: { "x-api-key": "secret-key" },
    });
    assert.equal(first.status, 200);
    assert.equal(first.headers.get("x-ratelimit-limit"), "1");

    const second = await fetch(`${limitedBase}/api/v1/meta`, {
      headers: { "x-api-key": "secret-key" },
    });
    assert.equal(second.status, 429);
    assert.ok(Number(second.headers.get("retry-after")) >= 1);
    const body = await second.json();
    assert.equal(body.error.code, "rate_limited");
  } finally {
    await new Promise((resolve) => limitedServer.close(resolve));
  }
});
