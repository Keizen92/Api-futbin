const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

export function createLogger(level = "info") {
  const threshold = LEVELS[level] ?? LEVELS.info;

  function emit(levelName, message, extra) {
    if ((LEVELS[levelName] ?? LEVELS.info) < threshold) return;
    const line = {
      time: new Date().toISOString(),
      level: levelName,
      message,
      ...(extra === undefined ? {} : { extra }),
    };
    const text = JSON.stringify(line);
    if (levelName === "error") process.stderr.write(`${text}\n`);
    else process.stdout.write(`${text}\n`);
  }

  return {
    debug: (message, extra) => emit("debug", message, extra),
    info: (message, extra) => emit("info", message, extra),
    warn: (message, extra) => emit("warn", message, extra),
    error: (message, extra) => emit("error", message, extra),
  };
}
