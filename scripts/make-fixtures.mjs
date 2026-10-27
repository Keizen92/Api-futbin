import { mkdir, writeFile } from "node:fs/promises";
import { load } from "cheerio";
import { loadConfig } from "../src/config.js";
import { createFetcher } from "../src/fetcher.js";

const config = loadConfig();
const fetcher = createFetcher(config);
const fixturesDir = new URL("../fixtures/", import.meta.url);
await mkdir(fixturesDir, { recursive: true });

function cleanAttributes($, selector) {
  $(selector).each((_, element) => {
    const node = $(element);
    for (const name of Object.keys(element.attribs ?? {})) {
      if (
        name.startsWith("_") ||
        ["srcset", "loading", "style", "width", "height"].includes(name)
      ) {
        node.removeAttr(name);
      }
    }
  });
}

function shell(title, body) {
  return `<!DOCTYPE html>\n<html lang="en">\n<head><meta charset="utf-8"><title>${title}</title></head>\n<body>\n${body}\n</body>\n</html>\n`;
}

async function fetchFixture(path) {
  const { body, url, fetcher: used } = await fetcher.fetchHtml(path);
  console.log(`fetched ${url} via ${used} (${body.length} bytes)`);
  return body;
}

const playersHtml = await fetchFixture(`/${config.gameVersion}/players?page=1`);
{
  const $ = load(playersHtml);
  cleanAttributes($, "tr.player-row *");
  const rows = $("tr.player-row").slice(0, 3).toArray();
  const table = $("table.players-table").first().clone();
  table.find("tbody").empty();
  for (const row of rows) table.find("tbody").append($(row));
  const active = $(".pagination-button.active").first().clone();
  const last = $("a.pagination-button")
    .toArray()
    .map((element) => $(element))
    .filter((element) => /^\d+$/.test(element.text().trim()))
    .at(-1)
    ?.clone();
  const pagination = `<div class="pagination-buttons-wrapper">${$.html(active)}${last ? $.html(last) : ""}</div>`;
  await writeFile(
    new URL("players.html", fixturesDir),
    shell("Futbin players fixture", `${$.html(table)}${pagination}`),
    "utf8",
  );
}

const playerHtml = await fetchFixture(
  `/${config.gameVersion}/player/8/kylian-mbappe`,
);
{
  const $ = load(playerHtml);
  cleanAttributes($, ".player-card-wrapper *");
  cleanAttributes($, ".player-header-info-box *");
  cleanAttributes($, ".price-box *");
  const card = $(".player-card-wrapper").first().clone();
  const info = $(".player-header-info-box").first().clone();
  const priceBoxes = $(".price-box.price-box-original-player")
    .toArray()
    .map((element) => $(element).clone());
  const canonical = $("link[rel='canonical']").attr("href");
  const ogImage = $("meta[property='og:image']").attr("content");
  const meta = [
    canonical ? `<link rel="canonical" href="${canonical}">` : "",
    ogImage ? `<meta property="og:image" content="${ogImage}">` : "",
  ].join("");
  const body = [
    meta,
    $.html(card),
    $.html(info),
    ...priceBoxes.map((box) => $.html(box)),
  ].join("\n");
  await writeFile(
    new URL("player.html", fixturesDir),
    shell("Futbin player fixture", body),
    "utf8",
  );
}

const hoverHtml = await fetchFixture(
  `/${config.gameVersion}/playerhover/8`,
);
{
  const $ = load(hoverHtml);
  cleanAttributes($, ".player-hover *");
  const hover = $(".player-hover").first().clone();
  await writeFile(
    new URL("hover.html", fixturesDir),
    shell("Futbin hover fixture", $.html(hover)),
    "utf8",
  );
}

const searchHtml = await fetchFixture(
  `/search/universal?query=messi&year=${config.gameVersion}`,
);
{
  const $ = load(searchHtml);
  cleanAttributes($, ".universal-search-result *");
  await writeFile(
    new URL("search.html", fixturesDir),
    shell("Futbin search fixture", $.html($("body").contents())),
    "utf8",
  );
}

console.log("Fixtures written to", fixturesDir.pathname);
