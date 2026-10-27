import { BadRequestError, NotFoundError, UpstreamError } from "./errors.js";
import { parseHoverPage } from "./parsers/hover.js";
import { parsePlayerPage } from "./parsers/player.js";
import { parsePlayersPage } from "./parsers/players.js";
import { parseSearchPage } from "./parsers/search.js";

const POSITIONS = new Set([
  "GK",
  "LB",
  "CB",
  "RB",
  "CAM",
  "CM",
  "CDM",
  "RM",
  "LM",
  "ST",
  "RW",
  "LW",
]);
const ACCELERATE_TYPES = new Set(["explosive", "controlled", "lengthy"]);
const GENDERS = new Set(["male", "female"]);

function asString(value) {
  if (Array.isArray(value)) return value[0];
  return value === undefined || value === null ? undefined : String(value);
}

function parsePositiveInt(value, name, { min = 1, max = Number.MAX_SAFE_INTEGER, fallback } = {}) {
  const raw = asString(value);
  if (raw === undefined || raw === "") {
    if (fallback !== undefined) return fallback;
    throw new BadRequestError(`El parámetro "${name}" es obligatorio.`);
  }
  if (!/^\d+$/.test(raw)) {
    throw new BadRequestError(`El parámetro "${name}" debe ser un entero positivo.`);
  }
  const parsed = Number.parseInt(raw, 10);
  if (parsed < min || parsed > max) {
    throw new BadRequestError(`El parámetro "${name}" debe estar entre ${min} y ${max}.`);
  }
  return parsed;
}

function parseOptionalString(value, name, { maxLength, pattern } = {}) {
  const raw = asString(value);
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > (maxLength ?? 80)) {
    throw new BadRequestError(`El parámetro "${name}" es demasiado largo.`);
  }
  if (pattern && !pattern.test(trimmed)) {
    throw new BadRequestError(`El parámetro "${name}" tiene un formato inválido.`);
  }
  return trimmed;
}

function parseRange(value, name) {
  const raw = parseOptionalString(value, name, { maxLength: 24 });
  if (raw === undefined) return undefined;
  if (!/^\d+(?:-\d+)?\+?$/.test(raw)) {
    throw new BadRequestError(
      `El parámetro "${name}" debe tener el formato min-max, min- o min+ (por ejemplo 1000-50000).`,
    );
  }
  return raw;
}

function parsePlayersQuery(query) {
  const page = parsePositiveInt(query.page, "page", {
    min: 1,
    max: 10_000,
    fallback: 1,
  });
  const search = parseOptionalString(query.search ?? query.q, "search", {
    maxLength: 60,
  });
  const sort = parseOptionalString(query.sort, "sort", {
    maxLength: 40,
    pattern: /^[A-Za-z0-9_]+$/,
  });
  const orderRaw = parseOptionalString(query.order, "order", { maxLength: 4 });
  const order = orderRaw ? orderRaw.toLowerCase() : undefined;
  if (order && !["asc", "desc"].includes(order)) {
    throw new BadRequestError('El parámetro "order" debe ser "asc" o "desc".');
  }

  const applied = { page, search, sort, order };

  if (query.position !== undefined) {
    const position = parseOptionalString(query.position, "position", {
      maxLength: 80,
    });
    if (position) {
      const positions = position
        .split(",")
        .map((value) => value.trim().toUpperCase())
        .filter(Boolean);
      const invalid = positions.filter((value) => !POSITIONS.has(value));
      if (!positions.length || invalid.length) {
        throw new BadRequestError(
          `Posiciones inválidas: ${invalid.join(", ") || "(vacío)"}. Válidas: ${[...POSITIONS].join(", ")}.`,
        );
      }
      applied.position = positions.join(",");
      const posType = (
        parseOptionalString(query.pos_type, "pos_type", { maxLength: 8 }) ?? "all"
      ).toLowerCase();
      if (!["all", "main", "alt"].includes(posType)) {
        throw new BadRequestError('El parámetro "pos_type" debe ser all, main o alt.');
      }
      applied.pos_type = posType;
    }
  }

  for (const key of ["nation", "league", "club"]) {
    if (query[key] === undefined) continue;
    applied[key] = parsePositiveInt(query[key], key, { min: 1, max: 10_000_000 });
  }

  if (query.min_skills !== undefined) {
    applied.min_skills = parsePositiveInt(query.min_skills, "min_skills", {
      min: 1,
      max: 5,
    });
  }
  if (query.min_wf !== undefined) {
    applied.min_wf = parsePositiveInt(query.min_wf, "min_wf", { min: 1, max: 5 });
  }

  if (query.accelerate !== undefined) {
    const accelerate = (
      parseOptionalString(query.accelerate, "accelerate", { maxLength: 16 }) ?? ""
    ).toLowerCase();
    if (!ACCELERATE_TYPES.has(accelerate)) {
      throw new BadRequestError(
        'El parámetro "accelerate" debe ser explosive, controlled o lengthy.',
      );
    }
    applied.accelerate = accelerate;
  }

  if (query.gender !== undefined) {
    const gender = (
      parseOptionalString(query.gender, "gender", { maxLength: 8 }) ?? ""
    ).toLowerCase();
    if (!GENDERS.has(gender)) {
      throw new BadRequestError('El parámetro "gender" debe ser male o female.');
    }
    applied.gender = gender;
  }

  const bodyType = parseOptionalString(query.body_type, "body_type", {
    maxLength: 24,
    pattern: /^[a-z_]+$/i,
  });
  if (bodyType) applied.body_type = bodyType.toLowerCase();

  const playstylesplus = parseOptionalString(
    query.playstylesplus,
    "playstylesplus",
    { maxLength: 48 },
  );
  if (playstylesplus) applied.playstylesplus = playstylesplus;

  const holo = parseOptionalString(query.holo, "holo", { maxLength: 8 });
  if (holo) {
    if (!/^(true|false|1|0)$/i.test(holo)) {
      throw new BadRequestError('El parámetro "holo" debe ser true o false.');
    }
    applied.holo = holo.toLowerCase();
  }

  const psPrice = parseRange(query.ps_price, "ps_price");
  if (psPrice) applied.ps_price = psPrice;
  const pcPrice = parseRange(query.pc_price, "pc_price");
  if (pcPrice) applied.pc_price = pcPrice;

  return applied;
}

function buildPlayersPath(config, applied) {
  const params = new URLSearchParams();
  params.set("page", String(applied.page));
  for (const [key, value] of Object.entries(applied)) {
    if (key === "page" || value === undefined) continue;
    params.set(key, String(value));
  }
  return `/${config.gameVersion}/players?${params.toString()}`;
}

function assertPlayerData(player, id) {
  if (!player || (!player.name && player.rating === null)) {
    throw new NotFoundError(`No se encontró el jugador ${id} en Futbin.`, { id });
  }
}

function mergeLivePrices(data, snapshot) {
  if (!snapshot?.data?.prices) return data;
  const prices = { ...data.prices };
  for (const platform of ["ps", "pc"]) {
    const live = snapshot.data.prices[platform];
    const base = prices[platform] ?? null;
    if (live?.value === null || live?.value === undefined) {
      prices[platform] = base;
      continue;
    }
    prices[platform] = {
      ...(base ?? {}),
      lowestBin: live.value,
      lowestBinDisplay: live.display,
      display: live.display,
      live: true,
    };
  }
  return {
    ...data,
    prices,
    priceSource: "hover",
    priceUpdatedAt: snapshot.data.priceChangedAt ?? null,
    priceCheckedAt: snapshot.data.priceCheckedAt ?? null,
    priceChanged: snapshot.data.priceChanged ?? null,
  };
}

export function createFutbinService({ config, fetcher, cache }) {
  const inflight = new Map();
  const priceStates = new Map();

  async function withCache(key, ttlSeconds, loader, { force = false } = {}) {
    if (!force) {
      const cached = cache.get(key);
      if (cached) {
        return {
          data: cached.value.data,
          meta: {
            cached: true,
            fetchedAt: new Date(cached.storedAt).toISOString(),
            sourceUrl: cached.value.sourceUrl,
          },
        };
      }
    }

    const pending = inflight.get(key);
    if (pending) {
      const entry = await pending;
      return {
        data: entry.data,
        meta: {
          cached: false,
          shared: true,
          fetchedAt: entry.fetchedAt,
          sourceUrl: entry.sourceUrl,
        },
      };
    }

    const promise = (async () => {
      const { data, sourceUrl } = await loader();
      const entry = {
        data,
        sourceUrl,
        fetchedAt: new Date().toISOString(),
      };
      cache.set(key, entry, ttlSeconds * 1_000);
      return entry;
    })();

    inflight.set(key, promise);
    try {
      const entry = await promise;
      return {
        data: entry.data,
        meta: {
          cached: false,
          fetchedAt: entry.fetchedAt,
          sourceUrl: entry.sourceUrl,
        },
      };
    } finally {
      inflight.delete(key);
    }
  }

  async function getPlayers(rawQuery) {
    const applied = parsePlayersQuery(rawQuery);
    const path = buildPlayersPath(config, applied);
    const { data, meta } = await withCache(
      `players:${path}`,
      config.cacheTtlSeconds.players,
      async () => {
        const { body, url } = await fetcher.fetchHtml(path);
        const parsed = parsePlayersPage(body, { baseUrl: config.baseUrl });
        return { data: parsed, sourceUrl: url };
      },
    );

    return {
      data: {
        ...data,
        count: data.players.length,
        hasNextPage: data.page < data.totalPages,
        query: applied,
      },
      meta,
    };
  }

  async function getPlayer(id) {
    const playerId = parsePositiveInt(id, "id", { min: 1, max: 99_999_999 });
    const path = `/${config.gameVersion}/player/${playerId}/_`;
    const { data, meta } = await withCache(
      `player:${playerId}`,
      config.cacheTtlSeconds.player,
      async () => {
        const { body, url } = await fetcher.fetchHtml(path);
        const parsed = parsePlayerPage(body, {
          id: playerId,
          baseUrl: config.baseUrl,
          gameVersion: config.gameVersion,
        });
        assertPlayerData(parsed, playerId);
        return { data: parsed, sourceUrl: url };
      },
    );

    const snapshot = cache.peek(`prices:${playerId}`);
    return {
      data: snapshot
        ? mergeLivePrices(data, {
            data: snapshot.value.data,
            storedAt: snapshot.storedAt,
          })
        : data,
      meta,
    };
  }

  async function getPlayerPrices(id, platform = "all", { refresh = false } = {}) {
    const normalized = String(asString(platform) ?? "all").toLowerCase();
    if (!["all", "ps", "pc"].includes(normalized)) {
      throw new BadRequestError(
        'El parámetro "platform" debe ser all, ps o pc.',
      );
    }

    const playerResult = await getPlayer(id);
    let snapshotResult = null;
    try {
      snapshotResult = refresh
        ? await refreshPrices(playerResult.data.id)
        : await getPriceSnapshot(playerResult.data.id);
    } catch (error) {
      const hasPrice = Object.values(playerResult.data.prices ?? {}).some(
        (price) => price?.lowestBin,
      );
      if (!hasPrice) throw error;
    }

    const data = snapshotResult
      ? mergeLivePrices(playerResult.data, {
          data: snapshotResult.data,
          storedAt: Date.parse(snapshotResult.meta.fetchedAt),
        })
      : playerResult.data;
    const prices =
      normalized === "all"
        ? { ps: data.prices.ps, pc: data.prices.pc }
        : { [normalized]: data.prices[normalized] };

    return {
      data: {
        id: data.id,
        name: data.name,
        url: data.url,
        platform: normalized,
        prices,
        priceSource: snapshotResult ? "hover" : "player-page",
        priceChanged: snapshotResult?.data.priceChanged ?? null,
        priceUpdatedAt: data.priceUpdatedAt ?? null,
        priceCheckedAt: data.priceCheckedAt ?? null,
      },
      meta: {
        ...playerResult.meta,
        cached:
          playerResult.meta.cached &&
          (snapshotResult ? snapshotResult.meta.cached : true),
        priceCached: snapshotResult?.meta.cached ?? null,
        priceFetchedAt: snapshotResult?.meta.fetchedAt ?? null,
      },
    };
  }

  async function fetchHover(playerId) {
    const path = `/${config.gameVersion}/playerhover/${playerId}`;
    const { body, url } = await fetcher.fetchHtml(path);
    const parsed = parseHoverPage(body);
    if (!parsed.name) {
      throw new NotFoundError(`No se encontró el jugador ${playerId} en Futbin.`, {
        id: playerId,
      });
    }
    return { parsed, sourceUrl: url };
  }

  async function getHover(id) {
    const playerId = parsePositiveInt(id, "id", { min: 1, max: 99_999_999 });
    const { data, meta } = await withCache(
      `hover:${playerId}`,
      config.cacheTtlSeconds.hover,
      async () => {
        const { parsed, sourceUrl } = await fetchHover(playerId);
        return {
          data: {
            id: playerId,
            ...parsed,
            url: `${config.baseUrl}/${config.gameVersion}/player/${playerId}`,
          },
          sourceUrl,
        };
      },
    );
    return { data, meta };
  }

  function rememberPriceState(playerId, parsed, checkedAt) {
    const next = {
      ps: parsed.prices?.ps?.value ?? null,
      pc: parsed.prices?.pc?.value ?? null,
    };
    const previous = priceStates.get(playerId);
    const changed = Boolean(
      previous && (previous.ps !== next.ps || previous.pc !== next.pc),
    );
    const state = {
      ...next,
      priceChangedAt: changed
        ? checkedAt
        : (previous?.priceChangedAt ?? null),
      priceCheckedAt: checkedAt,
    };
    priceStates.delete(playerId);
    priceStates.set(playerId, state);
    while (priceStates.size > 1_000) {
      const oldest = priceStates.keys().next().value;
      priceStates.delete(oldest);
    }
    return { ...state, priceChanged: changed };
  }

  async function loadPriceSnapshot(playerId) {
    const { parsed, sourceUrl } = await fetchHover(playerId);
    const checkedAt = new Date().toISOString();
    const state = rememberPriceState(playerId, parsed, checkedAt);
    return {
      data: {
        id: playerId,
        name: parsed.name,
        prices: parsed.prices,
        url: `${config.baseUrl}/${config.gameVersion}/player/${playerId}`,
        priceChangedAt: state.priceChangedAt,
        priceCheckedAt: state.priceCheckedAt,
        priceChanged: state.priceChanged,
      },
      sourceUrl,
    };
  }

  function getPriceSnapshot(id) {
    const playerId = parsePositiveInt(id, "id", { min: 1, max: 99_999_999 });
    return withCache(
      `prices:${playerId}`,
      config.cacheTtlSeconds.prices,
      () => loadPriceSnapshot(playerId),
    );
  }

  function refreshPrices(id) {
    const playerId = parsePositiveInt(id, "id", { min: 1, max: 99_999_999 });
    return withCache(
      `prices:${playerId}`,
      config.cacheTtlSeconds.prices,
      () => loadPriceSnapshot(playerId),
      { force: true },
    );
  }

  async function search(rawQuery) {
    const query = parseOptionalString(rawQuery.q ?? rawQuery.query, "q", {
      maxLength: 60,
    });
    if (!query || query.length < 2) {
      throw new BadRequestError(
        'El parámetro "q" es obligatorio y debe tener al menos 2 caracteres.',
      );
    }
    const year = parseOptionalString(rawQuery.year, "year", {
      maxLength: 2,
      pattern: /^\d{2}$/,
    }) ?? config.gameVersion;
    const type = parseOptionalString(rawQuery.type, "type", { maxLength: 16 });
    const path = `/search/universal?query=${encodeURIComponent(query)}&year=${encodeURIComponent(year)}`;
    const { data, meta } = await withCache(
      `search:${year}:${query.toLowerCase()}`,
      config.cacheTtlSeconds.search,
      async () => {
        const { body, url } = await fetcher.fetchHtml(path);
        const parsed = parseSearchPage(body, { baseUrl: config.baseUrl });
        return { data: parsed, sourceUrl: url };
      },
    );

    let results = data.results;
    if (type) {
      const wanted = type.toUpperCase();
      results = results.filter((item) => item.type === wanted);
    }

    return {
      data: {
        query,
        year,
        type: type ? type.toUpperCase() : null,
        count: results.length,
        results,
      },
      meta,
    };
  }

  function meta() {
    return {
      name: config.name,
      version: config.version,
      gameVersion: config.gameVersion,
      baseUrl: config.baseUrl,
      auth: {
        type: "api-key",
        headers: ["X-API-Key", "Authorization: Bearer <key>"],
      },
      platforms: {
        ps: "Console (PS/Xbox)",
        pc: "PC",
      },
      endpoints: [
        "GET /health",
        "GET /api/v1/meta",
        "GET /api/v1/players",
        "GET /api/v1/players/:id",
        "GET /api/v1/players/:id/prices",
        "POST /api/v1/players/:id/prices/refresh",
        "GET /api/v1/players/:id/hover",
        "GET /api/v1/search",
      ],
      cacheTtlSeconds: config.cacheTtlSeconds,
      rateLimitPerMin: config.rateLimitPerMin,
      priceAutoRefresh: {
        enabled: config.priceAutoRefresh,
        intervalSeconds: config.priceRefreshIntervalSeconds,
        batchSize: config.priceRefreshBatchSize,
        maxTracked: config.priceRefreshMaxTracked,
        watchPlayers: config.priceWatchPlayers,
      },
    };
  }

  async function deepHealth() {
    const startedAt = Date.now();
    const path = `/${config.gameVersion}/playerhover/8`;
    const { body, url, fetcher: usedFetcher } = await fetcher.fetchHtml(path);
    const parsed = parseHoverPage(body);
    if (!parsed.name) {
      throw new UpstreamError("Futbin respondió pero el contenido no es válido.", 502, {
        url,
      });
    }
    return {
      ok: true,
      upstream: {
        reachable: true,
        fetcher: usedFetcher,
        latencyMs: Date.now() - startedAt,
        samplePlayer: parsed.name,
      },
    };
  }

  return {
    getPlayers,
    getPlayer,
    getPlayerPrices,
    getHover,
    refreshPrices,
    search,
    meta,
    deepHealth,
  };
}
