import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { loadConfig } from "../src/config.js";
import { createFetcher } from "../src/fetcher.js";
import { parsePlayerPage } from "../src/parsers/player.js";
import { parsePlayersPage } from "../src/parsers/players.js";

function parseArgs(argv) {
  const options = {
    start: 1,
    end: null,
    concurrency: 2,
    delay: 0,
    detailSample: 0,
    maxErrors: 5,
    out: "reports/catalog-report.json",
    checkpoint: "reports/catalog-pages.jsonl",
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
    else if (arg === "--concurrency") options.concurrency = Number.parseInt(next(), 10);
    else if (arg === "--delay") options.delay = Number.parseInt(next(), 10);
    else if (arg === "--detail-sample") options.detailSample = Number.parseInt(next(), 10);
    else if (arg === "--max-errors") options.maxErrors = Number.parseInt(next(), 10);
    else if (arg === "--out") options.out = next();
    else if (arg === "--checkpoint") options.checkpoint = next();
    else if (arg === "--fresh") options.fresh = true;
    else throw new Error(`Argumento desconocido: ${arg}`);
  }
  if (!Number.isInteger(options.start) || options.start < 1) {
    throw new Error("--start debe ser un entero positivo.");
  }
  if (!Number.isInteger(options.delay) || options.delay < 0) {
    throw new Error("--delay debe ser un entero no negativo.");
  }
  if (!Number.isInteger(options.concurrency) || options.concurrency < 1) {
    throw new Error("--concurrency debe ser un entero positivo.");
  }
  if (!Number.isInteger(options.maxErrors) || options.maxErrors < 1) {
    throw new Error("--max-errors debe ser un entero positivo.");
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

async function pool(items, concurrency, worker) {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await worker(items[index], index);
    }
  });
  await Promise.all(runners);
}

function validatePlayer(player) {
  const missing = [];
  if (!Number.isInteger(player.id) || player.id < 1) missing.push("id");
  if (!player.name) missing.push("name");
  if (!Number.isInteger(player.rating)) missing.push("rating");
  if (!player.url) missing.push("url");
  return missing;
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
  const totalPages = options.end ?? first?.totalPages ?? 776;
  const pages = [];
  for (let page = options.start; page <= totalPages; page += 1) {
    pages.push(page);
  }
  const pending = pages.filter((page) => !checkpoint.get(page)?.ok);
  console.log(
    JSON.stringify({
      event: "catalog_start",
      totalPages,
      range: [options.start, totalPages],
      alreadyDone: pages.length - pending.length,
      pending: pending.length,
      concurrency: options.concurrency,
    }),
  );

  let completed = 0;
  let consecutiveFailures = 0;
  let aborted = false;
  await pool(pending, options.concurrency, async (page) => {
    if (aborted) return;
    const startedAt = Date.now();
    let entry;
    try {
      const { body, url } = await fetcher.fetchHtml(
        `/${config.gameVersion}/players?page=${page}`,
      );
      const parsed = parsePlayersPage(body, { baseUrl: config.baseUrl });
      const missing = parsed.players.flatMap((player) =>
        validatePlayer(player).map((field) => ({ id: player.id, field })),
      );
      entry = {
        page,
        ok: true,
        pageReported: parsed.page,
        totalPages: parsed.totalPages,
        count: parsed.players.length,
        ids: parsed.players.map((player) => player.id),
        firstId: parsed.players[0]?.id ?? null,
        lastId: parsed.players.at(-1)?.id ?? null,
        missing,
        noPrice: parsed.players.filter(
          (player) => !player.prices?.ps && !player.prices?.pc,
        ).length,
        bytes: body.length,
        ms: Date.now() - startedAt,
        sourceUrl: url,
      };
    } catch (error) {
      entry = {
        page,
        ok: false,
        error: error.message,
        status: error.status ?? error.details?.upstreamStatus ?? null,
        ms: Date.now() - startedAt,
      };
    }
    checkpoint.set(page, entry);
    appendFileSync(checkpointPath, `${JSON.stringify(entry)}\n`);
    if (entry.ok) {
      consecutiveFailures = 0;
    } else {
      consecutiveFailures += 1;
      if (consecutiveFailures >= options.maxErrors) {
        aborted = true;
        console.log(
          JSON.stringify({
            event: "catalog_aborted",
            reason: "consecutive_failures",
            failures: consecutiveFailures,
            page,
          }),
        );
      }
    }
    if (options.delay > 0) await sleep(options.delay);
    completed += 1;
    if (aborted) return;
    if (completed % 25 === 0 || completed === pending.length) {
      console.log(
        JSON.stringify({
          event: "catalog_progress",
          completed,
          pending: pending.length,
          page,
        }),
      );
    }
  });

  const results = pages
    .map((page) => checkpoint.get(page) ?? { page, ok: false, error: "missing" })
    .sort((left, right) => left.page - right.page);
  const successful = results.filter((entry) => entry.ok);
  const failures = results.filter((entry) => !entry.ok);
  const reportedTotals = new Set(successful.map((entry) => entry.totalPages));
  const totalPlayers = successful.reduce((sum, entry) => sum + entry.count, 0);

  const seen = new Map();
  const duplicates = new Map();
  for (const entry of successful) {
    for (const id of entry.ids) {
      if (seen.has(id)) {
        const key = String(id);
        const pagesForId = duplicates.get(key) ?? [seen.get(id)];
        pagesForId.push(entry.page);
        duplicates.set(key, pagesForId);
      } else {
        seen.set(id, entry.page);
      }
    }
  }

  const badCounts = successful.filter(
    (entry) =>
      entry.page < entry.totalPages &&
      entry.count !== 30,
  );
  const emptyPages = successful.filter((entry) => entry.count === 0);
  const missingFields = successful
    .flatMap((entry) => entry.missing ?? [])
    .reduce((accumulator, item) => {
      const key = item.field;
      accumulator[key] = (accumulator[key] ?? 0) + 1;
      return accumulator;
    }, {});
  const lastPage = successful.find((entry) => entry.page === Math.max(...successful.map((e) => e.page)));
  const expectedTotal =
    successful.length > 0
      ? (totalPages - 1) * 30 + (lastPage?.count ?? 0)
      : 0;

  const detailSample = [];
  if (options.detailSample > 0 && seen.size > 0) {
    const ids = [...seen.keys()].sort((left, right) => left - right);
    const sampleSize = Math.min(options.detailSample, ids.length);
    const selected = [];
    for (let index = 0; index < sampleSize; index += 1) {
      const at =
        sampleSize === 1
          ? 0
          : Math.round((index * (ids.length - 1)) / (sampleSize - 1));
      selected.push(ids[at]);
    }
    await pool(selected, options.concurrency, async (id) => {
      const startedAt = Date.now();
      try {
        const { body } = await fetcher.fetchHtml(
          `/${config.gameVersion}/player/${id}/_`,
        );
        const parsed = parsePlayerPage(body, {
          id,
          baseUrl: config.baseUrl,
          gameVersion: config.gameVersion,
        });
        detailSample.push({
          id,
          ok: Boolean(parsed.name && Number.isInteger(parsed.rating)),
          name: parsed.name,
          rating: parsed.rating,
          pricePs: parsed.prices?.ps?.lowestBin ?? null,
          pricePc: parsed.prices?.pc?.lowestBin ?? null,
          ms: Date.now() - startedAt,
        });
      } catch (error) {
        detailSample.push({
          id,
          ok: false,
          error: error.message,
          ms: Date.now() - startedAt,
        });
      }
    });
  }

  const report = {
    checkedAt: new Date().toISOString(),
    gameVersion: config.gameVersion,
    baseUrl: config.baseUrl,
    range: [options.start, totalPages],
    completeness: {
      expectedTotalPages: totalPages,
      pagesChecked: results.length,
      pagesOk: successful.length,
      pagesFailed: failures.length,
      reportedTotalPages: [...reportedTotals],
      totalPlayers,
      uniquePlayers: seen.size,
      expectedTotalFromLastPage: expectedTotal,
      matchesExpectedTotal:
        successful.length === totalPages && totalPlayers === expectedTotal,
      emptyPages: emptyPages.map((entry) => entry.page),
      unexpectedPageCounts: badCounts.map((entry) => ({
        page: entry.page,
        count: entry.count,
      })),
    },
    players: {
      duplicateIds: [...duplicates.entries()].map(([id, pagesForId]) => ({
        id: Number(id),
        pages: pagesForId,
      })),
      missingFields,
      withoutPrice: successful.reduce((sum, entry) => sum + entry.noPrice, 0),
    },
    detailSample: {
      requested: options.detailSample,
      checked: detailSample.length,
      failed: detailSample.filter((entry) => !entry.ok),
    },
    pageFailures: failures,
    pages: successful.map((entry) => ({
      page: entry.page,
      count: entry.count,
      ms: entry.ms,
      bytes: entry.bytes,
      noPrice: entry.noPrice,
    })),
  };
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);

  const ok =
    failures.length === 0 &&
    report.completeness.matchesExpectedTotal &&
    duplicates.size === 0 &&
    emptyPages.length === 0 &&
    badCounts.length === 0 &&
    detailSample.every((entry) => entry.ok);
  console.log(
    JSON.stringify(
      {
        event: "catalog_done",
        ok,
        report: outPath,
        checkpoint: checkpointPath,
        completeness: report.completeness,
        duplicates: duplicates.size,
        missingFields,
        detailSample: report.detailSample,
      },
      null,
      2,
    ),
  );
  if (!ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.stack ?? error.message);
  process.exitCode = 1;
});
