import { load } from "cheerio";
import {
  parseCompactNumber,
  parseDecimal,
  parseHeight,
  parseInteger,
} from "../utils/numbers.js";
import { absoluteUrl, cleanText, queryParamFromHref } from "./helpers.js";

function parsePriceCell($, cell) {
  if (!cell || cell.length === 0) return null;
  const display = cleanText(cell.find(".price").first());
  if (!display || display === "-") return null;
  const trendElement = cell.find(".price-diff").first();
  const trendText = cleanText(trendElement);
  const direction = trendElement.hasClass("positive-color")
    ? "up"
    : trendElement.hasClass("negative-color")
      ? "down"
      : "flat";
  return {
    display,
    value: parseCompactNumber(display),
    trend: {
      percent: parseDecimal(trendText),
      direction,
      text: trendText,
    },
  };
}

function parseEntity($, row, className) {
  const element = row.find(`.${className}`).first();
  const image = element.find("img").first();
  const name = image.attr("title") ?? cleanText(element) ?? null;
  const key = className.replace("table-player-", "");
  const id = queryParamFromHref(element.attr("href"), key);
  return {
    id: id === null ? null : Number(id),
    name: name || null,
  };
}

function parseAltPositions($, row) {
  const alt = row.find(".table-pos > div").not(".table-pos-main").first();
  return cleanText(alt)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

export function parsePlayersPage(html, { baseUrl = "https://www.futbin.com" } = {}) {
  const $ = load(html);
  const players = [];

  $("tr.player-row").each((_, element) => {
    const row = $(element);
    const href = row.find(".table-name a[href*='/player/']").first().attr("href");
    const idMatch = String(href ?? "").match(/\/player\/(\d+)/);
    if (!idMatch) return;

    const id = Number.parseInt(idMatch[1], 10);
    const card = row.find(".playercard-27").first();
    const shortName = cleanText(row.find(".table-player-name").first());
    const fullName = card.attr("title")?.trim() || shortName;
    const mainPosition = row.find(".table-pos-main").first();
    const position = cleanText(mainPosition.find("span").first());
    const heightCell = row.find(".table-height").first();

    players.push({
      id,
      name: fullName || null,
      shortName: shortName || null,
      slug: String(href).split("/").filter(Boolean).pop() ?? null,
      version: cleanText(row.find(".table-player-revision").first()) || null,
      rating: parseInteger(cleanText(row.find(".table-rating").first())),
      itemScore: {
        display: cleanText(row.find(".table-item-score").first()) || null,
        value: parseCompactNumber(cleanText(row.find(".table-item-score").first())),
      },
      position: position || null,
      positionPlus: /\+/.test(cleanText(mainPosition)),
      altPositions: parseAltPositions($, row),
      nation: parseEntity($, row, "table-player-nation"),
      league: parseEntity($, row, "table-player-league"),
      club: parseEntity($, row, "table-player-club"),
      prices: {
        ps: parsePriceCell($, row.find(".table-price.platform-ps-only").first()),
        pc: parsePriceCell($, row.find(".table-price.platform-pc-only").first()),
      },
      skills: parseInteger(cleanText(row.find(".table-skills").first())),
      weakFoot: parseInteger(cleanText(row.find(".table-weak-foot").first())),
      height: parseHeight(cleanText(heightCell.find("div").first())),
      acceleration: cleanText(heightCell.find("a").first()) || null,
      stats: {
        pace: parseInteger(cleanText(row.find(".table-pace").first())),
        shooting: parseInteger(cleanText(row.find(".table-shooting").first())),
        passing: parseInteger(cleanText(row.find(".table-passing").first())),
        dribbling: parseInteger(cleanText(row.find(".table-dribbling").first())),
        defending: parseInteger(cleanText(row.find(".table-defending").first())),
        physicality: parseInteger(cleanText(row.find(".table-physicality").first())),
      },
      popularity: parseInteger(cleanText(row.find(".table-popularity").first())),
      inGameStats: parseInteger(cleanText(row.find(".table-in-game-stats").first())),
      images: {
        card: row.find("img.playercard-s-27-bg").first().attr("src") ?? null,
        player: row.find("img.playercard-s-base-img").first().attr("src") ?? null,
      },
      url: absoluteUrl(baseUrl, href),
    });
  });

  return {
    players,
    page: parseActivePage($),
    totalPages: parseTotalPages($),
  };
}

function parseActivePage($) {
  const active = parseInteger(cleanText($(".pagination-button.active").first()));
  return active ?? 1;
}

function parseTotalPages($) {
  let max = 1;
  $("a.pagination-button").each((_, element) => {
    const value = parseInteger(cleanText($(element)));
    if (value !== null && value > max) max = value;
  });
  return max;
}
