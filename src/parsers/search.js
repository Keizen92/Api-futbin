import { load } from "cheerio";
import { parseInteger } from "../utils/numbers.js";
import { absoluteUrl, cleanText } from "./helpers.js";

export function parseSearchPage(
  html,
  { baseUrl = "https://www.futbin.com" } = {},
) {
  const $ = load(html);
  const results = [];

  $(".universal-search-result").each((_, element) => {
    const item = $(element);
    const link = item.find("a[href]").first();
    const href = link.attr("href");
    const badges = item.find(".universal-search-result-badges img");
    const club = badges.filter("[alt='Club']").first().attr("title") ?? null;
    const nation = badges.filter("[alt='Nation']").first().attr("title") ?? null;

    results.push({
      id: parseInteger(item.attr("data-universal-search-result-id")),
      type: item.attr("data-universal-search-result-type") ?? null,
      name: cleanText(item.find(".universal-search-result-name").first()) || null,
      subtitle:
        cleanText(item.find(".universal-search-result-subtitle").first()) || null,
      position:
        cleanText(item.find(".universal-search-result-position").first()) || null,
      rating: parseInteger(cleanText(item.find(".rating-square").first())),
      club,
      nation,
      image: item.find("img.search-player-image").first().attr("src") ?? null,
      url: absoluteUrl(baseUrl, href),
      slug: href ? String(href).split("/").filter(Boolean).pop() : null,
    });
  });

  return { results };
}
