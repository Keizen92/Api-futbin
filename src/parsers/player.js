import { load } from "cheerio";
import {
  parseCompactNumber,
  parseCurrency,
  parseHeight,
  parseInteger,
  parseTrend,
} from "../utils/numbers.js";
import { absoluteUrl, cleanText, normalizeStatKey, queryParamFromHref } from "./helpers.js";

function parseInfoGrid($) {
  const info = {};
  $(".player-info-box-player-info-grid > div").each((_, element) => {
    const cell = $(element);
    const label = cleanText(cell.children().eq(0)).toLowerCase();
    const value = cleanText(cell.children().eq(1));
    if (label) info[label] = value;
  });
  return info;
}

function parsePriceBox(box) {
  const $box = box;
  const trendElement = $box.find(".price-box-trend").first();
  const direction = trendElement.find(".positive-color").length
    ? "up"
    : trendElement.find(".negative-color").length
      ? "down"
      : "flat";
  const rangeText = cleanText($box.find(".price-box-full-width").first());
  const rangeMatch = rangeText.match(/Price Range:\s*([\d,.]+)\s*-\s*([\d,.]+)/i);
  const recentPricesRaw = $box
    .find(".price-box-background-graph")
    .first()
    .attr("data-recent-prices");
  const lowestDisplay = cleanText($box.find(".lowest-price-1").first());
  const platform = $box.hasClass("platform-pc-only")
    ? "pc"
    : $box.hasClass("platform-ps-only")
      ? "ps"
      : null;

  return {
    platform,
    label: platform === "pc" ? "PC" : "Console (PS/Xbox)",
    lowestBin: parseCurrency(lowestDisplay),
    lowestBinDisplay: lowestDisplay || null,
    lowestPrices: $box
      .find(".lowest-price")
      .toArray()
      .map((element) => parseCurrency(cleanText($box.find(element))))
      .filter((value) => value !== null),
    recentPrices: recentPricesRaw
      ? recentPricesRaw
          .split(",")
          .map((value) => Number.parseInt(value.trim(), 10))
          .filter((value) => Number.isFinite(value))
      : [],
    trend: parseTrend(cleanText(trendElement), direction),
    priceRange: rangeMatch
      ? {
          min: parseCurrency(rangeMatch[1]),
          max: parseCurrency(rangeMatch[2]),
        }
      : null,
    updatedText: cleanText($box.find(".prices-updated").first()) || null,
  };
}

function parsePlaystyles($) {
  return $(".player-info-box-playerstyles .playStyle-table-icon")
    .toArray()
    .map((element) => {
      const node = $(element);
      const name =
        cleanText(node.find("div").last()) || cleanText(node) || null;
      return {
        name,
        plus: node.hasClass("psplus"),
      };
    })
    .filter((item) => item.name);
}

function parseRoles($) {
  const roles = [];
  $(".player-roles-wrapper a[href*='/roles']").each((_, element) => {
    const node = $(element);
    const text = cleanText(node);
    const plusMatch = text.match(/\++$/);
    const level = plusMatch ? plusMatch[0] : "";
    const role = text.slice(0, text.length - level.length).trim();
    const position = cleanText(
      node.parent().find(".xs-font.uppercase.text-faded").first(),
    );
    roles.push({
      position: position || null,
      role: role || null,
      level: level || null,
    });
  });
  return roles;
}

function parseStats($) {
  const stats = {};
  const card = $(".player-card-wrapper").first();
  card.find(".playercard-stats").each((_, element) => {
    const node = $(element);
    const label = cleanText(
      node.find(".playercard-27-stat-value, .playercard-stat-value").first(),
    );
    const value = parseInteger(
      cleanText(
        node.find(".playercard-27-stat-number, .playercard-stat-number").first(),
      ),
    );
    if (label && value !== null) stats[normalizeStatKey(label)] = value;
  });
  return stats;
}

function parseEntityInfo($) {
  const result = {};
  $(".player-header-info-box a[href*='players?']").each((_, element) => {
    const node = $(element);
    const href = node.attr("href");
    for (const key of ["nation", "league", "club"]) {
      const value = queryParamFromHref(href, key);
      if (value !== null) {
        result[key] = {
          id: Number(value),
          name: cleanText(node) || null,
        };
      }
    }
  });
  return result;
}

export function parsePlayerPage(
  html,
  { id, baseUrl = "https://www.futbin.com", gameVersion = "27" } = {},
) {
  const $ = load(html);
  const card = $(".player-card-wrapper").first();
  const playerCard = card.find(".playercard-27").first();
  const canonical = $("link[rel='canonical']").attr("href");
  let canonicalPath = null;
  try {
    canonicalPath = canonical ? new URL(canonical).pathname : null;
  } catch {
    canonicalPath = null;
  }
  const slug = canonicalPath ? canonicalPath.split("/").filter(Boolean).pop() : null;
  const parsedId =
    parseInteger(card.attr("data-id")) ??
    parseInteger($(".price-box").first().attr("data-id")) ??
    id ??
    null;

  const info = parseInfoGrid($);
  const entities = parseEntityInfo($);
  const prices = { ps: null, pc: null };

  $(".price-box").each((_, element) => {
    const box = $(element);
    const boxId = parseInteger(box.attr("data-id"));
    if (parsedId !== null && boxId !== null && boxId !== parsedId) return;
    if (box.hasClass("price-box-previewed-player")) return;
    const parsed = parsePriceBox(box);
    if (parsed.platform && prices[parsed.platform] === null) {
      prices[parsed.platform] = parsed;
    }
  });

  const ogImage = $("meta[property='og:image']").attr("content") ?? null;
  const name = playerCard.attr("title")?.trim() || null;
  const shortName = card.find("img.playercard-27-base-img").first().attr("alt") ?? null;
  const itemScoreText = cleanText($(".player-card-item-score").first());

  return {
    id: parsedId,
    name,
    shortName,
    slug,
    rating: parseInteger(cleanText(playerCard.find(".playercard-27-rating").first())),
    futbinRating:
      parseFloat(
        cleanText($(".playercard-27-futbin-rating").first()).replace(",", "."),
      ) || null,
    itemScore: {
      display: itemScoreText || null,
      value: parseCompactNumber(itemScoreText),
    },
    position: cleanText(playerCard.find(".playercard-27-position").first()) || null,
    positionPlus: /\+/.test(
      cleanText(playerCard.find(".playercard-27-role-plus").first()),
    ),
    altPositions: playerCard
      .find(".playercard-27-alt-pos")
      .toArray()
      .map((element) => cleanText($(element)))
      .filter(Boolean),
    version:
      cleanText($(".player-header-info-box a[href*='version=']").first()) || null,
    nation: entities.nation ?? null,
    league: entities.league ?? null,
    club: entities.club ?? null,
    skills: parseInteger(info.skills),
    weakFoot: parseInteger(info["weak foot"]),
    height: parseHeight(info.height),
    foot: info.foot || null,
    age: parseInteger(info.age),
    playstyles: parsePlaystyles($),
    roles: parseRoles($),
    stats: parseStats($),
    prices,
    images: {
      player: ogImage ?? card.find("img.playercard-27-base-img").first().attr("src") ?? null,
      card: card.find("img.playercard-27-bg").first().attr("src") ?? null,
    },
    url: canonical
      ? absoluteUrl(baseUrl, canonical)
      : parsedId !== null
        ? `${baseUrl}/${gameVersion}/player/${parsedId}`
        : null,
  };
}
