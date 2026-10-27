import { readFileSync } from "node:fs";

const pkg = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);

export const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

function toInt(value, fallback) {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) ? n : fallback;
}

function toBool(value, fallback = false) {
  if (value === undefined) return fallback;
  return /^(1|true|yes|on)$/i.test(String(value));
}

function parseIdList(value) {
  return [
    ...new Set(
      String(value ?? "")
        .split(",")
        .map((item) => Number.parseInt(item.trim(), 10))
        .filter((id) => Number.isInteger(id) && id >= 1 && id <= 99_999_999),
    ),
  ];
}

export function loadConfig(env = process.env) {
  const fetcher = (env.FUTBIN_FETCHER ?? "auto").toLowerCase();
  const priceRefreshIntervalSeconds = Math.max(
    toInt(env.PRICE_REFRESH_INTERVAL_SECONDS, 60),
    15,
  );
  const priceRefreshMaxTracked = Math.min(
    Math.max(toInt(env.PRICE_REFRESH_MAX_TRACKED, 20), 1),
    100,
  );

  return {
    name: pkg.name,
    version: pkg.version,
    gameVersion: env.FUTBIN_GAME_VERSION ?? "27",
    baseUrl: (env.FUTBIN_BASE_URL ?? "https://www.futbin.com").replace(
      /\/+$/,
      "",
    ),
    apiKeys: (env.FUTBIN_API_KEY ?? "")
      .split(",")
      .map((key) => key.trim())
      .filter(Boolean),
    host: env.HOST ?? "127.0.0.1",
    port: toInt(env.PORT, 8787),
    fetcher,
    curlPath: env.FUTBIN_CURL_PATH ?? "curl",
    cookie: env.FUTBIN_COOKIE ?? "",
    proxy: env.FUTBIN_PROXY ?? "",
    userAgent: env.FUTBIN_USER_AGENT ?? DEFAULT_USER_AGENT,
    requestTimeoutMs: toInt(env.REQUEST_TIMEOUT_MS, 25_000),
    maxRetries: Math.min(toInt(env.FUTBIN_MAX_RETRIES, 2), 5),
    cacheMaxEntries: toInt(env.CACHE_MAX_ENTRIES, 400),
    cacheTtlSeconds: {
      players: toInt(env.CACHE_TTL_PLAYERS, 120),
      player: toInt(env.CACHE_TTL_PLAYER, 60),
      prices: toInt(env.CACHE_TTL_PRICES, 45),
      search: toInt(env.CACHE_TTL_SEARCH, 120),
      hover: toInt(env.CACHE_TTL_HOVER, 90),
    },
    priceAutoRefresh: toBool(env.PRICE_AUTO_REFRESH, true),
    priceRefreshIntervalSeconds,
    priceRefreshTickSeconds: Math.min(
      Math.max(toInt(env.PRICE_REFRESH_TICK_SECONDS, 15), 5),
      priceRefreshIntervalSeconds,
    ),
    priceRefreshBatchSize: Math.min(
      Math.max(toInt(env.PRICE_REFRESH_BATCH_SIZE, 3), 1),
      priceRefreshMaxTracked,
    ),
    priceRefreshMaxTracked,
    priceRefreshTrackTtlSeconds: Math.max(
      toInt(env.PRICE_REFRESH_TRACK_TTL_SECONDS, 900),
      priceRefreshIntervalSeconds * 2,
    ),
    priceWatchPlayers: parseIdList(env.PRICE_WATCH_PLAYERS).slice(
      0,
      priceRefreshMaxTracked,
    ),
    rateLimitPerMin: toInt(env.RATE_LIMIT_PER_MIN, 60),
    trustProxy: toBool(env.TRUST_PROXY, false),
    corsOrigin: env.CORS_ORIGIN ?? "",
    logLevel: (env.LOG_LEVEL ?? "info").toLowerCase(),
    allowInsecureNoKey: toBool(env.FUTBIN_ALLOW_NO_KEY, false),
    upstreamConcurrency: Math.max(toInt(env.UPSTREAM_CONCURRENCY, 4), 1),
  };
}

export function validateConfig(config) {
  if (!["auto", "fetch", "curl"].includes(config.fetcher)) {
    throw new Error(
      `FUTBIN_FETCHER inválido: "${config.fetcher}". Usa auto, fetch o curl.`,
    );
  }
  if (!/^\d{2}$/.test(config.gameVersion)) {
    throw new Error(
      `FUTBIN_GAME_VERSION inválido: "${config.gameVersion}". Usa dos dígitos, por ejemplo 27.`,
    );
  }
  if (!/^https?:\/\//i.test(config.baseUrl)) {
    throw new Error("FUTBIN_BASE_URL debe comenzar por http:// o https://");
  }
  if (config.port < 1 || config.port > 65_535) {
    throw new Error(`PORT inválido: ${config.port}`);
  }
  if (config.rateLimitPerMin < 1) {
    throw new Error("RATE_LIMIT_PER_MIN debe ser mayor que 0");
  }
  if (!config.apiKeys.length && !config.allowInsecureNoKey) {
    throw new Error(
      "Falta FUTBIN_API_KEY. Define una clave privada en .env o arranca con FUTBIN_ALLOW_NO_KEY=1 solo en local.",
    );
  }
  return config;
}
