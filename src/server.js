import { createApp } from "./app.js";
import { createTtlCache } from "./cache.js";
import { loadConfig, validateConfig } from "./config.js";
import { createFetcher } from "./fetcher.js";
import { createLogger } from "./logger.js";
import { createPriceRefresher } from "./price-refresher.js";
import { createFutbinService } from "./service.js";

try {
  process.loadEnvFile?.();
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

const config = validateConfig(loadConfig());
const logger = createLogger(config.logLevel);
const cache = createTtlCache({ maxEntries: config.cacheMaxEntries });

let fetcher;
try {
  fetcher = createFetcher(config);
} catch (error) {
  logger.error("fetcher_init_failed", { message: error.message });
  process.exit(1);
}

const service = createFutbinService({ config, fetcher, cache });
const priceRefresher = createPriceRefresher({ config, service, logger });
for (const id of config.priceWatchPlayers) {
  priceRefresher.watch(id, { pinned: true });
}
const { app } = createApp({
  config,
  service,
  cache,
  logger,
  priceRefresher,
});

const server = app.listen(config.port, config.host, () => {
  logger.info("server_started", {
    url: `http://${config.host}:${config.port}`,
    gameVersion: config.gameVersion,
    fetcher: fetcher.order.join(","),
    curlAvailable: fetcher.curlAvailable,
    authEnabled: config.apiKeys.length > 0,
    rateLimitPerMin: config.rateLimitPerMin,
    priceAutoRefresh: priceRefresher.status(),
  });
});
priceRefresher.start();

server.headersTimeout = 65_000;
server.requestTimeout = 120_000;

function shutdown(signal) {
  logger.info("server_stopping", { signal });
  priceRefresher.stop();
  server.close((error) => {
    if (error) {
      logger.error("server_close_failed", { message: error.message });
      process.exit(1);
    }
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("unhandledRejection", (reason) => {
  logger.error("unhandled_rejection", {
    message: reason instanceof Error ? reason.message : String(reason),
  });
});
