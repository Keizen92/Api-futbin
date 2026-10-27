import { randomUUID } from "node:crypto";
import express from "express";
import { createAuthMiddleware } from "./auth.js";
import { createTtlCache } from "./cache.js";
import { AppError, NotFoundError, RateLimitError } from "./errors.js";
import { createFetcher } from "./fetcher.js";
import { createLogger } from "./logger.js";
import { createRateLimiter } from "./rateLimit.js";
import { createFutbinService } from "./service.js";

export function createApp({
  config,
  service,
  cache,
  logger = createLogger(config.logLevel),
  priceRefresher = null,
}) {
  const resolvedCache =
    cache ?? createTtlCache({ maxEntries: config.cacheMaxEntries });
  const resolvedService =
    service ??
    createFutbinService({
      config,
      fetcher: createFetcher(config),
      cache: resolvedCache,
    });
  const auth = createAuthMiddleware(config);
  const limiter = createRateLimiter({ perMinute: config.rateLimitPerMin });

  const app = express();
  app.disable("x-powered-by");
  app.disable("etag");
  app.set("trust proxy", config.trustProxy);

  app.use((req, res, next) => {
    req.id = randomUUID();
    req.startedAt = process.hrtime.bigint();
    res.set("X-Request-Id", req.id);
    res.set("X-Content-Type-Options", "nosniff");
    res.set("X-Frame-Options", "DENY");
    res.set("Referrer-Policy", "no-referrer");
    res.set("Cache-Control", "no-store");

    if (config.corsOrigin) {
      res.set("Access-Control-Allow-Origin", config.corsOrigin);
      res.set("Vary", "Origin");
      res.set("Access-Control-Allow-Headers", "X-API-Key, Authorization, Content-Type");
      res.set("Access-Control-Allow-Methods", "GET, OPTIONS");
    }

    res.on("finish", () => {
      const durationMs =
        Number(process.hrtime.bigint() - req.startedAt) / 1_000_000;
      logger.info("request", {
        requestId: req.id,
        method: req.method,
        path: req.originalUrl,
        status: res.statusCode,
        durationMs: Number(durationMs.toFixed(1)),
        authenticated: Boolean(req.apiKey),
      });
    });

    next();
  });

  if (config.corsOrigin) {
    app.options(/.*/, (_req, res) => res.sendStatus(204));
  }

  function sendResult(req, res, result) {
    const durationMs =
      Number(process.hrtime.bigint() - req.startedAt) / 1_000_000;
    res.set("X-Cache", result.meta.cached ? "HIT" : "MISS");
    res.json({
      meta: {
        source: "futbin",
        gameVersion: config.gameVersion,
        cached: Boolean(result.meta.cached),
        ...(result.meta.shared ? { shared: true } : {}),
        fetchedAt: result.meta.fetchedAt ?? null,
        ...(result.meta.priceCached !== undefined
          ? {
              priceCached: Boolean(result.meta.priceCached),
              priceFetchedAt: result.meta.priceFetchedAt ?? null,
            }
          : {}),
        durationMs: Number(durationMs.toFixed(1)),
        requestId: req.id,
        sourceUrl: result.meta.sourceUrl ?? null,
      },
      data: result.data,
    });
  }

  app.get("/", (_req, res) => {
    res.json({
      name: config.name,
      version: config.version,
      description: "API REST privada para datos de Futbin (EA FC).",
      docs: "README.md",
      health: "/health",
      meta: "/api/v1/meta",
      auth: "X-API-Key o Authorization: Bearer <clave>",
    });
  });

  app.get("/health", async (req, res, next) => {
    try {
      const payload = {
        status: "ok",
        name: config.name,
        version: config.version,
        gameVersion: config.gameVersion,
        uptimeSeconds: Number(process.uptime().toFixed(1)),
        cache: resolvedCache.stats(),
        upstream: {
          configuredFetcher: config.fetcher,
          cookieConfigured: Boolean(config.cookie),
          proxyConfigured: Boolean(config.proxy),
        },
        priceAutoRefresh: priceRefresher?.status() ?? {
          enabled: config.priceAutoRefresh,
          intervalSeconds: config.priceRefreshIntervalSeconds,
          tracked: 0,
        },
      };

      if (String(req.query.deep ?? "") === "1") {
        try {
          const deep = await resolvedService.deepHealth();
          payload.status = deep.ok ? "ok" : "degraded";
          payload.upstreamCheck = deep.upstream;
        } catch (error) {
          payload.status = "degraded";
          payload.upstreamCheck = {
            reachable: false,
            error: error.message,
          };
          res.status(502).json(payload);
          return;
        }
      }

      res.json(payload);
    } catch (error) {
      next(error);
    }
  });

  app.use("/api", auth, (req, res, next) => {
    const rate = limiter.consume(req.apiKey ?? req.ip ?? "anonymous");
    res.set("X-RateLimit-Limit", String(rate.limit));
    res.set("X-RateLimit-Remaining", String(rate.remaining));
    res.set("X-RateLimit-Reset", String(rate.retryAfterSeconds));
    if (!rate.allowed) {
      res.set("Retry-After", String(rate.retryAfterSeconds));
      next(
        new RateLimitError("Has superado el límite de peticiones por minuto.", {
          limit: rate.limit,
          retryAfterSeconds: rate.retryAfterSeconds,
        }),
      );
      return;
    }
    next();
  });

  app.get("/api/v1/meta", (req, res, next) => {
    try {
      res.json({
        meta: { requestId: req.id, source: "futbin" },
        data: resolvedService.meta(),
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/v1/players", async (req, res, next) => {
    try {
      sendResult(req, res, await resolvedService.getPlayers(req.query));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/v1/players/:id", async (req, res, next) => {
    try {
      const result = await resolvedService.getPlayer(req.params.id);
      priceRefresher?.touch(req.params.id);
      sendResult(req, res, result);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/v1/players/:id/prices", async (req, res, next) => {
    try {
      const result = await resolvedService.getPlayerPrices(
        req.params.id,
        req.query.platform,
      );
      priceRefresher?.touch(req.params.id);
      sendResult(req, res, result);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/v1/players/:id/prices/refresh", async (req, res, next) => {
    try {
      const result = await resolvedService.getPlayerPrices(
        req.params.id,
        req.query.platform,
        { refresh: true },
      );
      priceRefresher?.touch(req.params.id);
      sendResult(req, res, result);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/v1/players/:id/hover", async (req, res, next) => {
    try {
      const result = await resolvedService.getHover(req.params.id);
      priceRefresher?.touch(req.params.id);
      sendResult(req, res, result);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/v1/search", async (req, res, next) => {
    try {
      sendResult(req, res, await resolvedService.search(req.query));
    } catch (error) {
      next(error);
    }
  });

  app.use((req, _res, next) => {
    next(new NotFoundError(`Ruta no encontrada: ${req.method} ${req.path}`));
  });

  app.use((error, req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    const isKnown = error instanceof AppError;
    const status = isKnown ? error.status : 500;
    const code = isKnown ? error.code : "internal_error";
    if (status >= 500) {
      logger.error("request_failed", {
        requestId: req.id,
        path: req.originalUrl,
        code,
        message: error.message,
        stack: error.stack,
      });
    }
    if (status === 429 && error.details?.retryAfterSeconds) {
      res.set("Retry-After", String(error.details.retryAfterSeconds));
    }
    res.status(status).json({
      error: {
        code,
        message:
          status === 500
            ? "Error interno del servidor."
            : error.message,
        ...(isKnown && error.details ? { details: error.details } : {}),
      },
      requestId: req.id,
    });
  });

  return {
    app,
    service: resolvedService,
    cache: resolvedCache,
    limiter,
    priceRefresher,
  };
}
