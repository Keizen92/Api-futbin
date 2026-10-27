function toPlayerId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id >= 1 && id <= 99_999_999 ? id : null;
}

export function createPriceRefresher({
  config,
  service,
  logger = null,
  now = () => Date.now(),
}) {
  const tracked = new Map();
  const stats = {
    refreshes: 0,
    changes: 0,
    failures: 0,
    lastRunAt: null,
    lastResult: null,
    lastError: null,
  };
  const intervalMs = config.priceRefreshIntervalSeconds * 1_000;
  const tickMs = config.priceRefreshTickSeconds * 1_000;
  const trackTtlMs = config.priceRefreshTrackTtlSeconds * 1_000;
  let timer = null;
  let running = false;

  function enforceLimit() {
    while (tracked.size > config.priceRefreshMaxTracked) {
      let evicted = false;
      for (const [id, entry] of tracked) {
        if (entry.pinned) continue;
        tracked.delete(id);
        evicted = true;
        break;
      }
      if (!evicted) return;
    }
  }

  function watch(id, { pinned = false, dueNow = true } = {}) {
    const playerId = toPlayerId(id);
    if (playerId === null) return false;
    const existing = tracked.get(playerId);
    tracked.delete(playerId);
    tracked.set(playerId, {
      lastAccessAt: now(),
      lastRefreshAt: existing?.lastRefreshAt ?? (dueNow ? 0 : now()),
      lastError: existing?.lastError ?? null,
      pinned: pinned || Boolean(existing?.pinned),
    });
    enforceLimit();
    return true;
  }

  function touch(id) {
    if (!config.priceAutoRefresh) return false;
    return watch(id, { dueNow: false });
  }

  function prune(at) {
    const cutoff = at - trackTtlMs;
    for (const [id, entry] of tracked) {
      if (entry.pinned) continue;
      if (entry.lastAccessAt <= cutoff && entry.lastRefreshAt <= cutoff) {
        tracked.delete(id);
      }
    }
  }

  function duePlayers(at) {
    return [...tracked.entries()]
      .filter(([, entry]) => at - entry.lastRefreshAt >= intervalMs)
      .sort(
        (left, right) =>
          left[1].lastRefreshAt - right[1].lastRefreshAt ||
          left[1].lastAccessAt - right[1].lastAccessAt,
      )
      .slice(0, config.priceRefreshBatchSize);
  }

  async function runOnce() {
    if (!config.priceAutoRefresh) {
      return { skipped: true, reason: "disabled" };
    }
    if (running) {
      return { skipped: true, reason: "running" };
    }

    running = true;
    const summary = { attempted: 0, refreshed: 0, changed: 0, failed: 0 };
    try {
      prune(now());
      for (const [id, entry] of duePlayers(now())) {
        summary.attempted += 1;
        try {
          const result = await service.refreshPrices(id);
          entry.lastRefreshAt = now();
          entry.lastError = null;
          stats.refreshes += 1;
          summary.refreshed += 1;
          if (result?.data?.priceChanged) {
            stats.changes += 1;
            summary.changed += 1;
          }
        } catch (error) {
          entry.lastRefreshAt = now();
          entry.lastError = error.message;
          stats.failures += 1;
          summary.failed += 1;
          logger?.warn("price_autorefresh_failed", {
            id,
            message: error.message,
          });
        }
      }

      stats.lastRunAt = new Date().toISOString();
      stats.lastResult = summary;
      stats.lastError =
        summary.failed > 0 ? "Una o más actualizaciones fallaron." : null;
      if (summary.attempted > 0) {
        logger?.info("price_autorefresh", {
          ...summary,
          tracked: tracked.size,
        });
      }
      return summary;
    } finally {
      running = false;
    }
  }

  function start() {
    if (!config.priceAutoRefresh || timer) return false;
    timer = setInterval(() => {
      runOnce().catch((error) => {
        logger?.error("price_autorefresh_error", { message: error.message });
      });
    }, tickMs);
    timer.unref?.();
    logger?.info("price_autorefresh_started", {
      intervalSeconds: config.priceRefreshIntervalSeconds,
      tickSeconds: config.priceRefreshTickSeconds,
      batchSize: config.priceRefreshBatchSize,
      maxTracked: config.priceRefreshMaxTracked,
      watchPlayers: config.priceWatchPlayers,
    });
    return true;
  }

  function stop() {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
  }

  function status() {
    return {
      enabled: config.priceAutoRefresh,
      running,
      intervalSeconds: config.priceRefreshIntervalSeconds,
      tickSeconds: config.priceRefreshTickSeconds,
      batchSize: config.priceRefreshBatchSize,
      maxTracked: config.priceRefreshMaxTracked,
      tracked: tracked.size,
      pinned: [...tracked.values()].filter((entry) => entry.pinned).length,
      refreshes: stats.refreshes,
      changes: stats.changes,
      failures: stats.failures,
      lastRunAt: stats.lastRunAt,
      lastResult: stats.lastResult,
      lastError: stats.lastError,
    };
  }

  return { touch, watch, runOnce, start, stop, status };
}

