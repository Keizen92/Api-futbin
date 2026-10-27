import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  parseCompactNumber,
  parseCurrency,
  parseDecimal,
  parseHeight,
  parseInteger,
  parseTrend,
} from "../src/utils/numbers.js";
import { parsePlayersPage } from "../src/parsers/players.js";
import { parsePlayerPage } from "../src/parsers/player.js";
import { parseHoverPage } from "../src/parsers/hover.js";
import { parseSearchPage } from "../src/parsers/search.js";

function fixture(name) {
  return readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8");
}

test("numbers: compact and currency parsing", () => {
  assert.equal(parseCompactNumber("6.4M"), 6_400_000);
  assert.equal(parseCompactNumber("60K"), 60_000);
  assert.equal(parseCompactNumber("3,000,000"), 3_000_000);
  assert.equal(parseCompactNumber("-"), null);
  assert.equal(parseCurrency("2,990,000"), 2_990_000);
  assert.equal(parseInteger("-4"), -4);
  assert.equal(parseDecimal("2.9%"), 2.9);
});

test("numbers: trend and height parsing", () => {
  assert.deepEqual(parseTrend("Trend: 1.18% (+35K)", "up"), {
    percent: 1.18,
    delta: 35_000,
    direction: "up",
    text: "Trend: 1.18% (+35K)",
  });
  assert.equal(parseTrend("Trend: 0% (+0)", "up").direction, "flat");
  assert.equal(parseTrend("2.9%", "down").direction, "down");

  const height = parseHeight("182cm | 6'0\"");
  assert.equal(height.cm, 182);
  assert.equal(height.imperial, "6'0\"");
});

test("players parser extracts list rows", () => {
  const parsed = parsePlayersPage(fixture("players.html"));
  assert.equal(parsed.page, 1);
  assert.equal(parsed.totalPages, 776);
  assert.equal(parsed.players.length, 3);

  const player = parsed.players[0];
  assert.equal(player.id, 21487);
  assert.equal(player.name, "Diego Maradona");
  assert.equal(player.shortName, "Maradona");
  assert.equal(player.version, "Icon");
  assert.equal(player.rating, 95);
  assert.equal(player.itemScore.value, 60_000);
  assert.equal(player.position, "CAM");
  assert.equal(player.positionPlus, true);
  assert.deepEqual(player.altPositions, ["ST"]);
  assert.deepEqual(player.nation, { id: 52, name: "Argentina" });
  assert.deepEqual(player.league, { id: 2118, name: "Icons" });
  assert.deepEqual(player.club, { id: 112658, name: "EA FC ICONS" });
  assert.ok(player.prices.ps.value > 0);
  assert.ok(player.prices.pc.value > 0);
  assert.ok(["up", "down", "flat"].includes(player.prices.ps.trend.direction));
  assert.equal(player.skills, 5);
  assert.equal(player.weakFoot, 3);
  assert.equal(player.height.cm, 165);
  assert.equal(player.acceleration, "Explosive");
  assert.deepEqual(player.stats, {
    pace: 90,
    shooting: 91,
    passing: 91,
    dribbling: 96,
    defending: 40,
    physicality: 77,
  });
  assert.equal(player.popularity, 83);
  assert.equal(player.inGameStats, 2371);
  assert.match(player.url, /^https:\/\/www\.futbin\.com\/27\/player\/21487\//);
  assert.ok(player.images.player);
  assert.ok(player.images.card);
});

test("player parser extracts detail, stats, playstyles and prices", () => {
  const player = parsePlayerPage(fixture("player.html"), { id: 8 });
  assert.equal(player.id, 8);
  assert.equal(player.name, "Kylian Mbappé");
  assert.equal(player.shortName, "Mbappé");
  assert.equal(player.slug, "kylian-mbappe");
  assert.equal(player.rating, 91);
  assert.equal(player.futbinRating, 96.3);
  assert.equal(player.itemScore.value, 19_000);
  assert.equal(player.position, "ST");
  assert.equal(player.positionPlus, true);
  assert.deepEqual(player.altPositions, ["LW"]);
  assert.equal(player.version, "Gold");
  assert.deepEqual(player.nation, { id: 18, name: "France" });
  assert.deepEqual(player.league, { id: 53, name: "LALIGA EA SPORTS" });
  assert.deepEqual(player.club, { id: 243, name: "Real Madrid" });
  assert.equal(player.skills, 5);
  assert.equal(player.weakFoot, 4);
  assert.equal(player.height.cm, 182);
  assert.equal(player.foot, "Right");
  assert.equal(player.age, 27);
  assert.ok(player.playstyles.some((item) => item.name === "Quick Step" && item.plus));
  assert.deepEqual(player.roles[0], {
    position: "ST",
    role: "False 9",
    level: "+",
  });
  assert.deepEqual(player.stats, {
    pace: 96,
    shooting: 91,
    passing: 80,
    dribbling: 92,
    defending: 29,
    physicality: 76,
  });
  assert.ok(player.prices.ps.lowestBin > 0);
  assert.ok(player.prices.pc.lowestBin > 0);
  assert.equal(player.prices.ps.recentPrices.length, 5);
  assert.ok(player.prices.ps.priceRange.min > 0);
  assert.match(player.prices.ps.updatedText, /Price Updated/i);
  assert.equal(
    player.url,
    "https://www.futbin.com/27/player/8/kylian-mbappe",
  );
});

test("hover parser extracts lightweight summary", () => {
  const hover = parseHoverPage(fixture("hover.html"));
  assert.equal(hover.name, "Mbappé");
  assert.equal(hover.rating, 91);
  assert.equal(hover.position, "ST");
  assert.equal(hover.skills, 5);
  assert.equal(hover.weakFoot, 4);
  assert.equal(hover.foot, "Right");
  assert.equal(hover.height.cm, 182);
  assert.equal(hover.club, "Real Madrid");
  assert.equal(hover.nation, "France");
  assert.equal(hover.league, "LALIGA EA SPORTS");
  assert.equal(hover.stats.pace, 96);
  assert.ok(hover.detailedStats.length >= 5);
  assert.equal(hover.totalStats, 464);
  assert.equal(hover.totalInGameStats, 2218);
  assert.ok(hover.prices.ps.value > 0);
  assert.ok(hover.prices.pc.value > 0);
});

test("search parser extracts universal search results", () => {
  const parsed = parseSearchPage(fixture("search.html"));
  assert.equal(parsed.results.length, 5);
  const first = parsed.results[0];
  assert.equal(first.id, 22);
  assert.equal(first.type, "PLAYER");
  assert.equal(first.name, "Messi");
  assert.equal(first.rating, 89);
  assert.equal(first.position, "CAM");
  assert.equal(first.club, "Inter Miami CF");
  assert.equal(first.nation, "Argentina");
  assert.equal(first.url, "https://www.futbin.com/27/player/22/lionel-messi");
});
