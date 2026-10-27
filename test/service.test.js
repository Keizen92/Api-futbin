import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createTtlCache } from "../src/cache.js";
import { loadConfig } from "../src/config.js";
import { BadRequestError, NotFoundError } from "../src/errors.js";
import { createFutbinService } from "../src/service.js";

const fixtures = {
  players: readFileSync(
    new URL("../fixtures/players.html", import.meta.url),
    "utf8",
  ),
  player: readFileSync(
    new URL("../fixtures/player.html", import.meta.url),
    "utf8",
  ),
  hover: readFileSync(new URL("../fixtures/hover.html", import.meta.url), "utf8"),
  search: readFileSync(
    new URL("../fixtures/search.html", import.meta.url),
    "utf8",
  ),
};

const config = loadConfig({
  FUTBIN_API_KEY: "test-key",
  LOG_LEVEL: "silent",
});

function createMockFetcher() {
  const calls = [];
  let hoverHtml = fixtures.hover;
  const fetcher = {
    calls,
    setHoverHtml(html) {
      hoverHtml = html;
    },
    async fetchHtml(path) {
      calls.push(path);
      if (path.startsWith("/27/players")) {
        return { body: fixtures.players, url: `${config.baseUrl}${path}`, fetcher: "mock" };
      }
      if (path === "/27/player/8/_") {
        return { body: fixtures.player, url: `${config.baseUrl}${path}`, fetcher: "mock" };
      }
      if (path === "/27/playerhover/8") {
        return { body: hoverHtml, url: `${config.baseUrl}${path}`, fetcher: "mock" };
      }
      if (path.startsWith("/search/universal")) {
        return { body: fixtures.search, url: `${config.baseUrl}${path}`, fetcher: "mock" };
      }
      return { body: "<html><body>not found</body></html>", url: `${config.baseUrl}${path}`, fetcher: "mock" };
    },
  };
  return fetcher;
}

function createService() {
  const fetcher = createMockFetcher();
  const cache = createTtlCache({ maxEntries: 20 });
  return {
    service: createFutbinService({ config, fetcher, cache }),
    fetcher,
    cache,
  };
}

test("service builds Futbin filters and exposes applied query", async () => {
  const { service, fetcher } = createService();
  const result = await service.getPlayers({
    page: "2",
    search: "messi",
    position: "st, cam",
    pos_type: "main",
    min_skills: "4",
    ps_price: "1000-5000",
    sort: "Player_Rating",
    order: "asc",
  });

  assert.equal(result.data.count, 3);
  assert.equal(result.data.query.page, 2);
  assert.equal(result.data.query.position, "ST,CAM");
  assert.equal(result.data.query.pos_type, "main");
  assert.equal(result.data.query.min_skills, 4);
  assert.equal(result.data.query.ps_price, "1000-5000");

  const url = new URL(fetcher.calls[0], "https://example.test");
  assert.equal(url.pathname, "/27/players");
  assert.equal(url.searchParams.get("page"), "2");
  assert.equal(url.searchParams.get("search"), "messi");
  assert.equal(url.searchParams.get("position"), "ST,CAM");
  assert.equal(url.searchParams.get("pos_type"), "main");
  assert.equal(url.searchParams.get("min_skills"), "4");
  assert.equal(url.searchParams.get("ps_price"), "1000-5000");
  assert.equal(url.searchParams.get("sort"), "Player_Rating");
  assert.equal(url.searchParams.get("order"), "asc");
});

test("service caches parsed responses and deduplicates in-flight work", async () => {
  const { service, fetcher, cache } = createService();
  const first = await service.getPlayers({ page: "1" });
  const second = await service.getPlayers({ page: "1" });

  assert.equal(first.meta.cached, false);
  assert.equal(second.meta.cached, true);
  assert.equal(fetcher.calls.length, 1);
  assert.equal(cache.stats().hits, 1);
});

test("service rejects invalid filters", async () => {
  const { service } = createService();
  await assert.rejects(() => service.getPlayers({ position: "XX" }), BadRequestError);
  await assert.rejects(() => service.getPlayers({ order: "sideways" }), BadRequestError);
  await assert.rejects(() => service.getPlayers({ min_skills: "9" }), BadRequestError);
  await assert.rejects(
    () => service.getPlayers({ ps_price: "abc" }),
    BadRequestError,
  );
  await assert.rejects(() => service.getPlayerPrices("8", "switch"), BadRequestError);
});

test("service returns player detail and platform-specific prices", async () => {
  const { service, fetcher } = createService();
  const player = await service.getPlayer("8");
  assert.equal(player.data.id, 8);
  assert.equal(player.data.name, "Kylian Mbappé");
  assert.equal(fetcher.calls[0], "/27/player/8/_");

  const pc = await service.getPlayerPrices("8", "pc");
  assert.equal(pc.data.platform, "pc");
  assert.deepEqual(Object.keys(pc.data.prices), ["pc"]);
  assert.ok(pc.data.prices.pc.lowestBin > 0);

  const all = await service.getPlayerPrices("8", "all");
  assert.deepEqual(Object.keys(all.data.prices).sort(), ["pc", "ps"]);
});

test("service refreshes price snapshots and overlays them on player data", async () => {
  const { service, fetcher, cache } = createService();
  const hoverPath = "/27/playerhover/8";
  const hoverCalls = () =>
    fetcher.calls.filter((path) => path === hoverPath).length;

  const first = await service.getPlayerPrices("8", "pc");
  assert.equal(first.data.priceSource, "hover");
  assert.equal(first.data.prices.pc.lowestBin, 3_400_000);
  assert.equal(first.data.prices.pc.lowestBinDisplay, "3.4M");
  assert.equal(first.data.priceChanged, false);
  assert.equal(first.meta.priceCached, false);
  assert.equal(first.data.priceUpdatedAt, null);
  assert.ok(first.data.priceCheckedAt);
  assert.equal(hoverCalls(), 1);

  const second = await service.getPlayerPrices("8", "pc");
  assert.equal(second.meta.cached, true);
  assert.equal(second.meta.priceCached, true);
  assert.equal(hoverCalls(), 1);

  await service.refreshPrices(8);
  assert.equal(hoverCalls(), 2);

  const third = await service.getPlayerPrices("8", "pc");
  assert.equal(third.meta.priceCached, true);
  assert.equal(hoverCalls(), 2);

  const player = await service.getPlayer("8");
  assert.equal(player.data.priceUpdatedAt, null);
  assert.equal(player.data.priceSource, "hover");
  assert.equal(player.data.priceChanged, false);
  assert.equal(player.data.prices.pc.lowestBin, 3_400_000);
  assert.equal(player.data.prices.pc.live, true);
  assert.equal(cache.peek("prices:8").value.data.prices.pc.value, 3_400_000);
});

test("marks prices as updated only when Futbin changes the value", async () => {
  const { service, fetcher } = createService();
  const first = await service.getPlayerPrices("8", "pc");
  const changedAt = first.data.priceUpdatedAt;
  const checkedAt = first.data.priceCheckedAt;

  assert.equal(first.data.priceChanged, false);
  assert.equal(changedAt, null);
  assert.ok(checkedAt);

  const unchanged = await service.getPlayerPrices("8", "pc", {
    refresh: true,
  });
  assert.equal(unchanged.data.priceChanged, false);
  assert.equal(unchanged.data.priceUpdatedAt, null);
  assert.ok(unchanged.data.priceCheckedAt >= checkedAt);
  assert.equal(unchanged.data.prices.pc.lowestBin, 3_400_000);

  fetcher.setHoverHtml(fixtures.hover.replace("3.4M", "3.5M"));
  const changed = await service.getPlayerPrices("8", "pc", { refresh: true });
  assert.equal(changed.data.priceChanged, true);
  assert.equal(changed.data.prices.pc.lowestBin, 3_500_000);
  assert.ok(changed.data.priceUpdatedAt);

  const player = await service.getPlayer("8");
  assert.equal(player.data.prices.pc.lowestBin, 3_500_000);
  assert.equal(player.data.priceUpdatedAt, changed.data.priceUpdatedAt);
});

test("cache expiry does not mark an unchanged price as updated", async () => {
  const { service, fetcher, cache } = createService();
  const first = await service.getPlayerPrices("8", "pc");
  assert.equal(first.data.priceUpdatedAt, null);

  fetcher.setHoverHtml(fixtures.hover.replace("3.4M", "3.5M"));
  const changed = await service.getPlayerPrices("8", "pc", { refresh: true });
  assert.equal(changed.data.priceChanged, true);
  const changedAt = changed.data.priceUpdatedAt;
  assert.ok(changedAt);

  cache.clear();
  const polled = await service.getPlayerPrices("8", "pc");

  assert.equal(polled.meta.priceCached, false);
  assert.equal(polled.data.priceChanged, false);
  assert.equal(polled.data.priceUpdatedAt, changedAt);
  assert.ok(polled.data.priceCheckedAt >= changed.data.priceCheckedAt);
});

test("service returns hover summaries and search results", async () => {
  const { service } = createService();
  const hover = await service.getHover("8");
  assert.equal(hover.data.id, 8);
  assert.equal(hover.data.name, "Mbappé");
  assert.ok(hover.data.prices.ps.value > 0);

  const search = await service.search({ q: "messi", year: "27" });
  assert.equal(search.data.count, 5);
  assert.equal(search.data.results[0].id, 22);

  const filtered = await service.search({ q: "messi", type: "EVOLUTION" });
  assert.equal(filtered.data.count, 0);
});

test("service returns NotFound for an unknown player", async () => {
  const { service } = createService();
  await assert.rejects(() => service.getPlayer("999"), NotFoundError);
});

test("service exposes metadata without secrets", () => {
  const { service } = createService();
  const meta = service.meta();
  assert.equal(meta.gameVersion, "27");
  assert.ok(meta.endpoints.includes("GET /api/v1/players/:id/prices"));
  assert.equal(meta.priceAutoRefresh.enabled, true);
  assert.equal(meta.priceAutoRefresh.intervalSeconds, 60);
  assert.equal(JSON.stringify(meta).includes("test-key"), false);
});
