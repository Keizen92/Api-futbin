import { load } from "cheerio";
import { parseCompactNumber, parseHeight, parseInteger } from "../utils/numbers.js";
import { cleanText, normalizeStatKey } from "./helpers.js";

function parseHoverStats($) {
  const stats = {};
  $(".playercard-stats").each((_, element) => {
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

export function parseHoverPage(html) {
  const $ = load(html);
  const container = $(".player-hover").first();
  const extraItems = container
    .find(".playercard-27-extra-info-basic-item")
    .not(".playercard-27-right-skills")
    .toArray()
    .map((element) => cleanText($(element)));
  const footLetter = extraItems.find((value) => /^[RL]$/i.test(value)) ?? null;
  const weakFoot = extraItems
    .map((value) => parseInteger(value))
    .find((value) => value !== null && value >= 1 && value <= 5);
  const topText = cleanText($(".player-hover-top"));
  const heightText =
    (topText.match(/\d{2,3}cm\s*\|\s*\d'\d{1,2}"/) ?? [])[0] ?? topText;
  const infos = container
    .find(".player-hover-infos .player-hover-33")
    .toArray()
    .map((element) => cleanText($(element)))
    .filter(Boolean);
  const priceElements = container.find(".player-hover-price").toArray();
  const priceDisplays = priceElements.map((element) => cleanText($(element)));
  const hoverText = cleanText(container);

  const detailedStats = [];
  $(".player-hover-stats .player-hover-slim .xxs-column").each((_, element) => {
    const text = cleanText($(element));
    const match = text.match(/^(.+?)(\d+)$/);
    if (!match) return;
    detailedStats.push({
      name: match[1].trim(),
      value: Number.parseInt(match[2], 10),
    });
  });

  return {
    name: cleanText($(".playercard-27-name").first()) || null,
    shortName: cleanText($(".playercard-27-name").first()) || null,
    rating: parseInteger(cleanText($(".playercard-27-rating").first())),
    futbinRating:
      Number.parseFloat(
        cleanText($(".playercard-27-futbin-rating").first()).replace(",", "."),
      ) || null,
    position: cleanText($(".playercard-27-position").first()) || null,
    positionPlus: /\+/.test(cleanText($(".playercard-27-role-plus").first())),
    altPositions: $(".playercard-27-alt-pos")
      .toArray()
      .map((element) => cleanText($(element)))
      .filter(Boolean),
    skills: parseInteger(cleanText($(".playercard-27-right-skills").first())),
    weakFoot,
    foot: footLetter === "R" ? "Right" : footLetter === "L" ? "Left" : null,
    height: parseHeight(heightText),
    weightKg: parseInteger((topText.match(/(\d+)\s*kg/i) ?? [])[1]),
    club: infos[0] ?? null,
    nation: infos[1] ?? null,
    league: infos[2] ?? null,
    stats: parseHoverStats($),
    detailedStats,
    totalStats: parseInteger((hoverText.match(/Total Stats\s*([\d,]+)/) ?? [])[1]),
    totalInGameStats: parseInteger(
      (hoverText.match(/Total IGS\s*([\d,]+)/) ?? [])[1],
    ),
    chemstyle:
      (hoverText.match(/Top Chemstyle\s*([A-Z][A-Z\s]*?)(?:Total Stats|$)/) ?? [])[1]?.trim() ??
      null,
    prices: {
      ps: priceDisplays[0]
        ? {
            display: priceDisplays[0],
            value: parseCompactNumber(priceDisplays[0]),
          }
        : null,
      pc: priceDisplays[1]
        ? {
            display: priceDisplays[1],
            value: parseCompactNumber(priceDisplays[1]),
          }
        : null,
    },
    note: cleanText($(".player-hover-bottom").first()) || null,
  };
}
