import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { loadConfig } from "../src/config.js";
import { createFetcher } from "../src/fetcher.js";
import { parsePlayerPage } from "../src/parsers/player.js";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36";
const PAGE_LIMIT = 15;

function parseArgs(argv) {
  const options = {
    start: 1,
    end: null,
    delay: 350,
    detailSample: 0,
    out: "reports/squad-catalog-report.json",
    checkpoint: "reports/squad-catalog.jsonl",
    listCheckpoint: "reports/catalog-pages.jsonl",
    fresh: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      return argv[index];
    };
    if (arg === "--start") options.start = Number.parseInt(next(), 10);
    else if (arg === "--end") options.end = Number.parseInt(next(), 10);
    else if (arg === "--delay") options.delay = Number.parseInt(next(), 10);
    else if (arg === "--detail-sample") options.detailSample = Number.parseInt(next(), 10);
    else if (arg === "--out") options.out = next();
    else if (arg === "--checkpoint") options.checkpoint = next();
    else if (arg === "--list-checkpoint") options.listCheckpoint = next();
    else if (arg === "--fresh") options.fresh = true;
    else throw new Error(`Argumento desconocido: ${arg}`);
  }
  if (!Number.isInteger(options.start) || options.start < 1) {
    throw new Error("--start debe ser un entero positivo.");
  }
  if (options.end !== null && (!Number.isInteger(options.end) || options.end < options.start)) {
    throw new Error("--end debe ser un entero mayor o igual a --start.");
  }
  if (!Number.isInteger(options.delay) || options.delay < 0) {
    throw new Error("--delay debe ser un entero no negativo.");
  }
  return options;
}

function readCheckpoint(path) {
  if (!existsSync(path)) return new Map();
  const pages = new Map();
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (Number.isInteger(entry.page)) pages.set(entry.page, entry);
    } catch {
      continue;
    }
  }
  return pages;
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function buildBody(page) {
  return JSON.stringify({
    chemistryInput: {
      formation: { value: "433" },
      cardlidToPlayers: [],
      cardlid: { value: "cardlid1" },
    },
    page,
    limit: PAGE_LIMIT,
    searchTerm: null,
    version: [],
    clubId: null,
    leagueId: null,
    nationId: null,
    skills: null,
    weakFoot: null,
    positions: null,
    positionType: "ALL",
    defensiveWorkRate: null,
    attackWorkRate: null,
    foot: null,
  });
}

function fetchPage(page) {
  const output = execFileSync(
    "curl.exe",
    [
      "-sS",
      "-A",
      USER_AGENT,
      "-e",
      "https://www.futbin.com/27/squad-builder",
      "-H",
      "Accept: application/json",
      "-H",
      "Content-Type: application/json",
      "--data-binary",
      buildBody(page),
      "https://www.futbin.com/27/squad-builder/player-search",
    ],
    { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  );
  return JSON.parse(output);
}

function normalizeCard(player) {
  const card = player?.card ?? {};
  const id = card.id?.playerCardId?.value ?? null;
  const positions = (card.statsCard?.playerPositions ?? [])
    .map((entry) => entry.position)
    .filter(Boolean);
  return {
    id,
    name: card.playerName ?? null,
    rating: card.playerRating ?? null,
    version: card.rareType ?? null,
    positions,
    position: positions[0] ?? null,
    psPrice: card.psPrice ?? null,
    pcPrice: card.pcPrice ?? null,
    psPriceDisplay: card.psPriceBox?.price ?? null,
    pcPriceDisplay: card.pcPriceBox?.price ?? null,
    clubId: card.clubId?.value ?? null,
    leagueId: card.leagueId?.value ?? null,
    nationId: card.nationId?.value ?? null,
    isEvolution: Boolean(card.isEvolution),
  };
}

function validateCard(player) {
  const missing = [];
  if (!Number.isInteger(player.id) || player.id < 1) missing.push("id");
  if (!player.name) missing.push("name");
  if (!Number.isInteger(player.rating)) missing.push("rating");
  if (player.positions.length === 0) missing.push("positions");
  if (player.psPrice === null) missing.push("psPrice");
  if (player.pcPrice === null) missing.push("pcPrice");
  return missing;
}

function readListIds(path) {
  if (!existsSync(path)) return new Set();
  const ids = new Set();
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (!entry.ok) continue;
      for (const id of entry.ids ?? []) ids.add(id);
    } catch {
      continue;
    }
  }
  return ids;
}

function normalizeName(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function namesMatch(expected, actual) {
  const left = normalizeName(expected);
  const right = normalizeName(actual);
  if (!left || !right) return true;
  return left.includes(right) || right.includes(left);
}

function sampleDetails(players, size) {
  if (size <= 0 || players.length === 0) return [];
  const sorted = [...players].sort((left, right) => left.id - right.id);
  const byPosition = new Map();
  for (const player of sorted) {
    const key = player.position ?? "UNKNOWN";
    if (!byPosition.has(key)) byPosition.set(key, []);
    byPosition.get(key).push(player);
  }
  const selected = [];
  const selectedIds = new Set();
  const add = (player) => {
    if (!player || selectedIds.has(player.id) || selected.length >= size) return;
    selectedIds.add(player.id);
    selected.push(player);
  };
  for (const group of byPosition.values()) add(group[Math.floor(group.length / 2)]);
  for (let index = 0; index < size; index += 1) {
    add(sorted[Math.round((index * (sorted.length - 1)) / Math.max(1, size - 1))]);
  }
  return selected.slice(0, size);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  process.loadEnvFile?.();
  const config = loadConfig();
  const fetcher = createFetcher(config);
  const checkpointPath = resolve(options.checkpoint);
  const outPath = resolve(options.out);
  mkdirSync(dirname(checkpointPath), { recursive: true });
  mkdirSync(dirname(outPath), { recursive: true });

  if (options.fresh && existsSync(checkpointPath)) {
    writeFileSync(checkpointPath, "");
  }
  const checkpoint = readCheckpoint(checkpointPath);
  const first = checkpoint.values().next().value;
  let totalResults = first?.totalResults ?? 0;
  let totalPages = totalResults ? Math.ceil(totalResults / PAGE_LIMIT) : null;
  const end = options.end ?? totalPages;
  if (end === null) throw new Error("No hay checkpoint previo; indica --end o ejecuta una página primero.");

  const pages = [];
  for (let page = options.start; page <= end; page += 1) pages.push(page);
  let pending = pages.filter((page) => !checkpoint.get(page)?.ok);
  console.log(
    JSON.stringify({
      event: "squad_catalog_start",
      totalResults,
      totalPages,
      range: [options.start, end],
      alreadyDone: pages.length - pending.length,
      pending: pending.length,
      delayMs: options.delay,
    }),
  );

  let completed = 0;
  for (const page of pending) {
    if (!checkpoint.has(page) && totalPages !== null && page > totalPages) break;
    const startedAt = Date.now();
    let entry;
    let lastError;
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      try {
        const data = fetchPage(page);
        if (!Array.isArray(data.players)) {
          throw new Error(`Respuesta sin players (page ${page})`);
        }
        totalResults = data.totalResults ?? totalResults;
        totalPages = totalResults ? Math.ceil(totalResults / PAGE_LIMIT) : totalPages;
        const players = data.players.map(normalizeCard);
        const missing = players.flatMap((player) =>
          validateCard(player).map((field) => ({ id: player.id, field })),
        );
        entry = {
          page,
          ok: true,
          totalResults,
          totalPages,
          count: players.length,
          players,
          missing,
          noPrice: players.filter((player) => !player.psPrice && !player.pcPrice).length,
          ms: Date.now() - startedAt,
        };
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        const wait = 2000 * attempt;
        console.log(
          JSON.stringify({
            event: "squad_catalog_retry",
            page,
            attempt,
            error: error.message.slice(0, 300),
            waitMs: wait,
          }),
        );
        await sleep(wait);
      }
    }
    if (!entry) {
      entry = {
        page,
        ok: false,
        error: lastError?.message ?? "unknown error",
        ms: Date.now() - startedAt,
      };
    }
    checkpoint.set(page, entry);
    appendFileSync(checkpointPath, `${JSON.stringify(entry)}\n`);
    completed += 1;
    if (completed % 25 === 0 || completed === pending.length) {
      console.log(
        JSON.stringify({
          event: "squad_catalog_progress",
          completed,
          pending: pending.length,
          page,
          totalResults,
          totalPages,
        }),
      );
    }
    await sleep(options.delay);
  }

  pending = pages.filter((page) => !checkpoint.get(page)?.ok);
  if (pending.length > 0 && options.end === null) {
    console.log(
      JSON.stringify({
        event: "squad_catalog_more",
        remaining: pending.length,
        nextPage: pending[0],
      }),
    );
    process.exitCode = 2;
    return;
  }

  const results = pages
    .map((page) => checkpoint.get(page) ?? { page, ok: false, error: "missing" })
    .sort((left, right) => left.page - right.page);
  const successful = results.filter((entry) => entry.ok);
  const failures = results.filter((entry) => !entry.ok);
  const allPlayers = successful.flatMap((entry) => entry.players);
  const seen = new Map();
  const duplicates = new Map();
  for (const player of allPlayers) {
    const key = String(player.id);
    if (seen.has(key)) {
      duplicates.set(key, (duplicates.get(key) ?? 1) + 1);
    } else {
      seen.set(key, player);
    }
  }
  const uniquePlayers = [...seen.values()];
  const missingFields = successful
    .flatMap((entry) => entry.missing ?? [])
    .reduce((accumulator, item) => {
      const key = item.field;
      accumulator[key] = (accumulator[key] ?? 0) + 1;
      return accumulator;
    }, {});
  const expectedPages = totalResults ? Math.ceil(totalResults / PAGE_LIMIT) : null;
  const badCounts = successful.filter(
    (entry) =>
      entry.page < (totalPages ?? expectedPages ?? 0) &&
      entry.count !== PAGE_LIMIT,
  );
  const lastPage = successful.at(-1);
  const expectedLastCount = totalResults
    ? totalResults - (expectedPages - 1) * PAGE_LIMIT
    : null;
  const listIds = readListIds(resolve(options.listCheckpoint));
  const missingFromList = listIds.size
    ? [...listIds].filter((id) => !seen.has(String(id)))
    : [];

  const detailSample = [];
  const selected = sampleDetails(uniquePlayers, options.detailSample);
  for (const player of selected) {
    const startedAt = Date.now();
    try {
      const { body } = await fetcher.fetchHtml(
        `/${config.gameVersion}/player/${player.id}/_`,
      );
      const parsed = parsePlayerPage(body, {
        id: player.id,
        baseUrl: config.baseUrl,
        gameVersion: config.gameVersion,
      });
      const nameMatches =
        namesMatch(player.name, parsed.shortName) ||
        namesMatch(player.name, parsed.name);
      const ratingMatches =
        !player.rating || parsed.rating === player.rating;
      detailSample.push({
        id: player.id,
        ok: Boolean(parsed.name && Number.isInteger(parsed.rating) && nameMatches && ratingMatches),
        name: parsed.name,
        shortName: parsed.shortName,
        rating: parsed.rating,
        expectedName: player.name,
        expectedRating: player.rating,
        nameMatches,
        ratingMatches,
        pricePs: parsed.prices?.ps?.lowestBin ?? null,
        pricePc: parsed.prices?.pc?.lowestBin ?? null,
        ms: Date.now() - startedAt,
      });
    } catch (error) {
      detailSample.push({
        id: player.id,
        ok: false,
        error: error.message,
        expectedName: player.name,
        expectedRating: player.rating,
        ms: Date.now() - startedAt,
      });
    }
    await sleep(options.delay);
  }

  const missingNamePlayers = uniquePlayers.filter((player) => !player.name);
  const missingNameChecks = [];
  for (const player of missingNamePlayers) {
    const startedAt = Date.now();
    try {
      const { body } = await fetcher.fetchHtml(
        `/${config.gameVersion}/player/${player.id}/_`,
      );
      const parsed = parsePlayerPage(body, {
        id: player.id,
        baseUrl: config.baseUrl,
        gameVersion: config.gameVersion,
      });
      missingNameChecks.push({
        id: player.id,
        ok: Boolean(parsed.name && Number.isInteger(parsed.rating)),
        name: parsed.name,
        rating: parsed.rating,
        expectedRating: player.rating,
        pricePs: parsed.prices?.ps?.lowestBin ?? null,
        pricePc: parsed.prices?.pc?.lowestBin ?? null,
        ms: Date.now() - startedAt,
      });
    } catch (error) {
      missingNameChecks.push({
        id: player.id,
        ok: false,
        error: error.message,
        expectedRating: player.rating,
        ms: Date.now() - startedAt,
      });
    }
    await sleep(options.delay);
  }
  const resolvedMissingNames = new Set(
    missingNameChecks
      .filter((entry) => entry.ok)
      .map((entry) => String(entry.id)),
  );

  const ok =
    failures.length === 0 &&
    successful.length === expectedPages &&
    uniquePlayers.length === totalResults &&
    duplicates.size === 0 &&
    missingFields.id === undefined &&
    missingNameChecks.every((entry) => entry.ok) &&
    emptyChecks(uniquePlayers, resolvedMissingNames) &&
    badCounts.length === 0 &&
    detailSample.every((entry) => entry.ok);

  const report = {
    ok,
    checkedAt: new Date().toISOString(),
    gameVersion: config.gameVersion,
    source: "squad-builder/player-search",
    range: [options.start, end],
    catalog: {
      totalResults,
      expectedPages,
      pagesChecked: results.length,
      pagesOk: successful.length,
      pagesFailed: failures.length,
      rows: allPlayers.length,
      uniquePlayers: uniquePlayers.length,
      duplicateIds: [...duplicates.entries()].map(([id, count]) => ({ id: Number(id), count })),
      missingFields,
      rowsWithoutPrice: successful.reduce((sum, entry) => sum + (entry.noPrice ?? 0), 0),
      expectedLastCount,
      lastPageCount: lastPage?.count ?? null,
      unexpectedPageCounts: badCounts.map((entry) => ({
        page: entry.page,
        count: entry.count,
      })),
      evolutionRows: uniquePlayers.filter((player) => player.isEvolution).length,
      missingNameChecks,
    },
    listCheckpoint: {
      pages: listIds.size ? "present" : "absent",
      ids: listIds.size,
      missingFromListCount: missingFromList.length,
      missingFromList: missingFromList.slice(0, 50),
    },
    detailSample: {
      requested: options.detailSample,
      checked: detailSample.length,
      failed: detailSample.filter((entry) => !entry.ok),
    },
    pageFailures: failures,
    players: uniquePlayers.map((player) => ({
      id: player.id,
      name: player.name,
      rating: player.rating,
      version: player.version,
      position: player.position,
      psPrice: player.psPrice,
      pcPrice: player.pcPrice,
      isEvolution: player.isEvolution,
    })),
    detailChecks: detailSample,
  };
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);

  console.log(
    JSON.stringify(
      {
        event: "squad_catalog_done",
        ok,
        report: outPath,
        checkpoint: checkpointPath,
        catalog: report.catalog,
        listCheckpoint: report.listCheckpoint,
        detailSample: report.detailSample,
      },
      null,
      2,
    ),
  );
  if (!ok) process.exitCode = 1;
}

function emptyChecks(players, resolvedMissingNames = new Set()) {
  return players.every(
    (player) =>
      player.id &&
      Number.isInteger(player.rating) &&
      (player.name || resolvedMissingNames.has(String(player.id))),
  );
}

main().catch((error) => {
  console.error(error.stack ?? error.message);
  process.exitCode = 1;
});
