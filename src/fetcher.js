import { execFile, spawnSync } from "node:child_process";
import { NotFoundError, UpstreamError } from "./errors.js";

const CURL_MARKER = "__FUTBIN_CURL_STATUS__:";
const CHALLENGE_PATTERN =
  /Just a moment\.\.\.|cf-challenge|Attention Required|Enable JavaScript and cookies to continue/i;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function detectCurl(curlPath) {
  try {
    const result = spawnSync(curlPath, ["--version"], {
      encoding: "utf8",
      timeout: 5_000,
      windowsHide: true,
    });
    return result.status === 0 && /curl/i.test(result.stdout ?? "");
  } catch {
    return false;
  }
}

function browserHeaders(config) {
  return {
    "user-agent": config.userAgent,
    accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "accept-language": "es-ES,es;q=0.9,en;q=0.8",
    "cache-control": "no-cache",
    pragma: "no-cache",
    ...(config.cookie ? { cookie: config.cookie } : {}),
  };
}

function normalizeUrl(baseUrl, pathOrUrl) {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  return new URL(pathOrUrl, `${baseUrl}/`).toString();
}

function isChallenge(body) {
  if (!body) return false;
  return CHALLENGE_PATTERN.test(body.slice(0, 20_000));
}

function blockedError(url, status) {
  return new UpstreamError(
    "Futbin rechazó la petición. Si se repite, configura FUTBIN_COOKIE con las cookies de tu navegador o FUTBIN_PROXY con un proxy válido.",
    502,
    { url, upstreamStatus: status, reason: "upstream_blocked" },
  );
}

async function requestWithNativeFetch(url, headers, timeoutMs) {
  let response;
  try {
    response = await fetch(url, {
      headers,
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new UpstreamError(
      `No se pudo conectar con Futbin: ${error.message}`,
      502,
      { url, reason: "network_error" },
    );
  }
  const body = await response.text();
  return { status: response.status, body, method: "fetch" };
}

function requestWithCurl(url, headers, config, timeoutMs) {
  return new Promise((resolve, reject) => {
    const args = [
      "-sS",
      "-L",
      "--compressed",
      "--max-redirs",
      "5",
      "--max-time",
      String(Math.ceil(timeoutMs / 1000)),
      "-A",
      headers["user-agent"],
      "-H",
      `Accept: ${headers.accept}`,
      "-H",
      `Accept-Language: ${headers["accept-language"]}`,
      "-H",
      "Cache-Control: no-cache",
      "-H",
      "Pragma: no-cache",
    ];

    for (const [name, value] of Object.entries(headers)) {
      if (["user-agent", "accept", "accept-language", "cache-control", "pragma"].includes(name)) {
        continue;
      }
      args.push("-H", `${name}: ${value}`);
    }
    if (config.proxy) args.push("--proxy", config.proxy);
    args.push("-w", `${CURL_MARKER}%{http_code}`, url);

    execFile(
      config.curlPath,
      args,
      {
        encoding: "utf8",
        maxBuffer: 30 * 1024 * 1024,
        timeout: timeoutMs + 5_000,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            new UpstreamError(
              `curl no pudo descargar ${url}: ${(stderr || error.message).trim()}`,
              502,
              { url, reason: "network_error" },
            ),
          );
          return;
        }
        const markerIndex = stdout.lastIndexOf(CURL_MARKER);
        if (markerIndex === -1) {
          reject(
            new UpstreamError(
              "curl devolvió una respuesta sin código HTTP.",
              502,
              { url, reason: "invalid_upstream_response" },
            ),
          );
          return;
        }
        const status = Number.parseInt(
          stdout.slice(markerIndex + CURL_MARKER.length).trim(),
          10,
        );
        resolve({
          status: Number.isFinite(status) ? status : 0,
          body: stdout.slice(0, markerIndex),
          method: "curl",
        });
      },
    );
  });
}

function createLimiter(maxConcurrent) {
  let active = 0;
  const queue = [];

  const next = () => {
    if (active >= maxConcurrent) return;
    const job = queue.shift();
    if (!job) return;
    active += 1;
    job
      .run()
      .then(job.resolve, job.reject)
      .finally(() => {
        active -= 1;
        next();
      });
  };

  return (run) =>
    new Promise((resolve, reject) => {
      queue.push({ run, resolve, reject });
      next();
    });
}

export function createFetcher(config) {
  const curlAvailable = config.fetcher === "fetch" ? false : detectCurl(config.curlPath);

  if (config.fetcher === "curl" && !curlAvailable) {
    throw new Error(
      `FUTBIN_FETCHER=curl pero no se encontró el ejecutable "${config.curlPath}".`,
    );
  }

  const order =
    config.fetcher === "curl"
      ? ["curl"]
      : config.fetcher === "fetch"
        ? ["fetch"]
        : curlAvailable
          ? ["curl", "fetch"]
          : ["fetch"];

  const limit = createLimiter(config.upstreamConcurrency);

  async function requestWithFallback(url, headers, timeoutMs) {
    let blocked = null;
    let lastError = null;

    for (const method of order) {
      try {
        const response =
          method === "curl"
            ? await requestWithCurl(url, headers, config, timeoutMs)
            : await requestWithNativeFetch(url, headers, timeoutMs);
        if ([403, 429, 503].includes(response.status) || isChallenge(response.body)) {
          blocked = response;
          continue;
        }
        return response;
      } catch (error) {
        lastError = error;
      }
    }

    if (blocked) return blocked;
    throw lastError;
  }

  async function fetchHtml(pathOrUrl, options = {}) {
    const url = normalizeUrl(config.baseUrl, pathOrUrl);
    const timeoutMs = options.timeoutMs ?? config.requestTimeoutMs;
    const headers = { ...browserHeaders(config), ...(options.headers ?? {}) };
    let lastError = null;

    for (let attempt = 0; attempt <= config.maxRetries; attempt += 1) {
      try {
        const response = await limit(() =>
          requestWithFallback(url, headers, timeoutMs),
        );

        if (response.status === 404) {
          throw new NotFoundError(
            "Futbin no encontró el recurso solicitado.",
            { url, upstreamStatus: 404 },
          );
        }
        if (response.status === 403 || isChallenge(response.body)) {
          throw blockedError(url, response.status);
        }
        if (response.status === 429) {
          throw new UpstreamError(
            "Futbin está limitando las peticiones (429). Inténtalo más tarde.",
            503,
            { url, upstreamStatus: 429, reason: "upstream_rate_limited" },
          );
        }
        if (response.status >= 500) {
          throw new UpstreamError(
            `Futbin devolvió un error ${response.status}.`,
            502,
            { url, upstreamStatus: response.status, reason: "upstream_server_error" },
          );
        }
        if (response.status < 200 || response.status >= 300) {
          throw new UpstreamError(
            `Futbin devolvió un estado inesperado ${response.status}.`,
            502,
            { url, upstreamStatus: response.status },
          );
        }
        return { body: response.body, url, fetcher: response.method };
      } catch (error) {
        lastError = error;
        const status = error?.details?.upstreamStatus;
        const retryable =
          error?.details?.reason === "network_error" ||
          status === 429 ||
          (typeof status === "number" && status >= 500);
        if (!retryable || attempt >= config.maxRetries) break;
        await sleep(300 * 2 ** attempt);
      }
    }

    throw lastError;
  }

  return { fetchHtml, curlAvailable, order };
}
