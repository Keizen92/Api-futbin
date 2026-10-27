import { createHash, timingSafeEqual } from "node:crypto";
import { UnauthorizedError } from "./errors.js";

function safeEqual(left, right) {
  const a = createHash("sha256").update(String(left)).digest();
  const b = createHash("sha256").update(String(right)).digest();
  return timingSafeEqual(a, b);
}

export function createAuthMiddleware(config) {
  if (!config.apiKeys.length) {
    return (req, _res, next) => {
      req.apiKey = null;
      next();
    };
  }

  return (req, res, next) => {
    const direct = req.get("x-api-key");
    const authorization = req.get("authorization");
    const bearer =
      authorization && /^Bearer\s+/i.test(authorization)
        ? authorization.replace(/^Bearer\s+/i, "").trim()
        : null;
    const provided = direct?.trim() || bearer;

    if (!provided) {
      res.set("WWW-Authenticate", 'Bearer realm="futbin-private-api"');
      next(
        new UnauthorizedError(
          "Falta la API key. Envía la cabecera X-API-Key o Authorization: Bearer <clave>.",
        ),
      );
      return;
    }

    const matched = config.apiKeys.find((key) => safeEqual(key, provided));
    if (!matched) {
      res.set("WWW-Authenticate", 'Bearer realm="futbin-private-api"');
      next(new UnauthorizedError("La API key no es válida."));
      return;
    }

    req.apiKey = matched;
    next();
  };
}
