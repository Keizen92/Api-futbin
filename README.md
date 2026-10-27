# Futbin Private API

API REST privada y no oficial para consultar jugadores, precios, resumen rápido y búsqueda de Futbin (EA FC 27). El servidor se ejecuta por defecto en `127.0.0.1:8787`, exige una clave privada, cachea las respuestas y actualiza en segundo plano los precios de los jugadores consultados para reducir peticiones al sitio original.

Este proyecto no está afiliado a Futbin ni a EA. Úsalo únicamente con fines personales y respeta los términos de Futbin. El scraping puede dejar de funcionar si cambian el HTML o las protecciones del sitio.

## Requisitos

- Node.js 20.12 o superior.
- `curl` disponible en el `PATH` (recomendado en Windows para evitar bloqueos de Cloudflare).
- Una clave privada en `FUTBIN_API_KEY`.

En este equipo hay un Node portable en `.runtime/node-v24.22.1-win-x64`. Para usarlo en PowerShell:

```powershell
$env:PATH = "C:\Users\pablo\futbin-api\.runtime\node-v24.22.1-win-x64;" + $env:PATH
```

## Instalación y arranque

```powershell
npm install
Copy-Item .env.example .env
# Edita .env y define una clave larga y aleatoria en FUTBIN_API_KEY
npm start
```

El servidor carga `.env` automáticamente si existe. También puedes definir las variables en el entorno.

```text
http://127.0.0.1:8787
```

Para desarrollo con recarga automática:

```powershell
npm run dev
```

## Autenticación

Todas las rutas `/api/v1/*` requieren una de estas cabeceras:

```http
X-API-Key: tu-clave
```

```http
Authorization: Bearer tu-clave
```

`GET /` y `GET /health` son públicos. Para aceptar varias claves, sepáralas con comas en `FUTBIN_API_KEY`.

No expongas esta API directamente a Internet sin TLS y un proxy inverso. Si necesitas escuchar en todas las interfaces, usa `HOST=0.0.0.0`, pero mantén la clave y el firewall configurados.

## Endpoints

### `GET /health`

Estado del servicio, caché, configuración del fetcher y estado del refresco automático de precios (`priceAutoRefresh`).

```powershell
curl.exe http://127.0.0.1:8787/health
```

`GET /health?deep=1` realiza además una petición real a Futbin para comprobar la conectividad.

### `GET /api/v1/meta`

Metadatos de la API: versión del juego, endpoints, plataformas, TTL de caché, límite de peticiones y configuración del refresco automático de precios.

```powershell
curl.exe -H "X-API-Key: $env:FUTBIN_API_KEY" `
  http://127.0.0.1:8787/api/v1/meta
```

### `GET /api/v1/players`

Listado paginado de jugadores. Devuelve 30 jugadores por página.

Parámetros:

| Parámetro | Descripción | Ejemplo |
| --- | --- | --- |
| `page` | Página, desde 1 | `page=2` |
| `search` | Búsqueda por nombre | `search=messi` |
| `position` | Posiciones separadas por comas | `position=ST,CAM` |
| `pos_type` | `main`, `alt` o `all` (por defecto `all`) | `pos_type=main` |
| `nation` | ID de nación de Futbin | `nation=18` |
| `league` | ID de liga de Futbin | `league=53` |
| `club` | ID de club de Futbin | `club=243` |
| `min_skills` | Estrellas de filigrana mínimas (1-5) | `min_skills=4` |
| `min_wf` | Pierna mala mínima (1-5) | `min_wf=4` |
| `accelerate` | `explosive`, `controlled` o `lengthy` | `accelerate=explosive` |
| `gender` | `male` o `female` | `gender=male` |
| `body_type` | Tipo de cuerpo | `body_type=lean` |
| `playstylesplus` | Estilos de juego plus | `playstylesplus=quick_step` |
| `holo` | `true` o `false` | `holo=true` |
| `ps_price` | Rango de precio PS: `min-max`, `min-` o `min+` | `ps_price=1000-50000` |
| `pc_price` | Rango de precio PC | `pc_price=1000-50000` |
| `sort` | Campo de ordenación de Futbin | `sort=Player_Rating` |
| `order` | `asc` o `desc` | `order=desc` |

```powershell
curl.exe -H "X-API-Key: $env:FUTBIN_API_KEY" `
  "http://127.0.0.1:8787/api/v1/players?page=1&search=messi"
```

Respuesta abreviada:

```json
{
  "meta": {
    "source": "futbin",
    "gameVersion": "27",
    "cached": false,
    "fetchedAt": "2026-10-26T00:00:00.000Z",
    "durationMs": 812.4,
    "requestId": "...",
    "sourceUrl": "https://www.futbin.com/27/players?page=1&search=messi"
  },
  "data": {
    "page": 1,
    "totalPages": 776,
    "count": 30,
    "hasNextPage": true,
    "players": [
      {
        "id": 22,
        "name": "Lionel Messi",
        "rating": 89,
        "position": "CAM",
        "prices": {
          "ps": { "value": 150000, "display": "150K" },
          "pc": { "value": 120000, "display": "120K" }
        }
      }
    ],
    "query": { "page": 1, "search": "messi" }
  }
}
```

Cada jugador incluye, cuando está disponible: `id`, `name`, `shortName`, `slug`, `version`, `rating`, `itemScore`, `position`, `positionPlus`, `altPositions`, `nation`, `league`, `club`, `prices` (PS/PC con tendencia), `skills`, `weakFoot`, `height`, `acceleration`, `stats`, `popularity`, `inGameStats`, `images` y `url`.

### `GET /api/v1/players/:id`

Ficha completa del jugador: carta, atributos, filigranas, pierna mala, altura, pie, edad, playstyles, roles, precios PS/PC, gráfico de precios recientes, rango de precio, imagen y URL canónica.

```powershell
curl.exe -H "X-API-Key: $env:FUTBIN_API_KEY" `
  http://127.0.0.1:8787/api/v1/players/8
```

### `GET /api/v1/players/:id/prices`

Precios de un jugador. `platform` acepta `all` (por defecto), `ps` o `pc`.

```powershell
curl.exe -H "X-API-Key: $env:FUTBIN_API_KEY" `
  "http://127.0.0.1:8787/api/v1/players/8/prices?platform=pc"
```

`lowestBin` y `lowestBinDisplay` proceden de un snapshot ligero de la página hover que se refresca automáticamente. El resto de campos (`lowestPrices`, `recentPrices`, `trend`, `priceRange` y `updatedText`) procede de la ficha completa. La respuesta incluye `priceSource` (`hover` o `player-page`), `priceChanged` (si el último chequeo detectó un cambio), `priceUpdatedAt` (último cambio real de precio en Futbin) y `priceCheckedAt` (última comprobación, aunque el precio no cambiara).

### `POST /api/v1/players/:id/prices/refresh`

Fuerza una comprobación manual del precio, sin esperar al planificador. Acepta el mismo `platform` que el endpoint anterior.

```powershell
curl.exe -X POST -H "X-API-Key: $env:FUTBIN_API_KEY" `
  "http://127.0.0.1:8787/api/v1/players/8/prices/refresh?platform=pc"
```

Devuelve `priceChanged`, `priceUpdatedAt` y `priceCheckedAt`. Si Futbin mantiene el mismo precio, `priceChanged` es `false` y `priceUpdatedAt` no cambia.

### `GET /api/v1/players/:id/hover`

Resumen ligero del jugador, útil para previsualizaciones. Es más rápido que la ficha completa y también devuelve precios cacheados.

```powershell
curl.exe -H "X-API-Key: $env:FUTBIN_API_KEY" `
  http://127.0.0.1:8787/api/v1/players/8/hover
```

### `GET /api/v1/search`

Búsqueda universal en Futbin. `q` es obligatorio y debe tener al menos 2 caracteres. `year` es opcional (por defecto la versión configurada). `type` filtra por tipo de resultado, por ejemplo `PLAYER` o `EVOLUTION`.

```powershell
curl.exe -H "X-API-Key: $env:FUTBIN_API_KEY" `
  "http://127.0.0.1:8787/api/v1/search?q=mbappe"
```

## Actualización automática de precios

Con el servidor arrancado, la API mantiene frescos los precios de los jugadores consultados recientemente. Cada petición a `/api/v1/players/:id`, `/api/v1/players/:id/prices` o `/api/v1/players/:id/hover` registra el jugador; un planificador en segundo plano consulta su página hover (mucho más ligera que la ficha completa) cada `PRICE_REFRESH_INTERVAL_SECONDS` (60 s por defecto) y actualiza el snapshot de precios aunque no lleguen más peticiones.

- Se refrescan como máximo `PRICE_REFRESH_BATCH_SIZE` jugadores por ciclo y se siguen como máximo `PRICE_REFRESH_MAX_TRACKED` jugadores.
- Un jugador deja de refrescarse tras `PRICE_REFRESH_TRACK_TTL_SECONDS` sin consultas.
- `PRICE_WATCH_PLAYERS=8,22` fija una lista permanente que se refresca aunque nadie consulte la API.
- `PRICE_AUTO_REFRESH=false` desactiva el planificador; en ese caso los precios solo se actualizan al caducar la caché (`CACHE_TTL_PRICES`).
- Cada comprobación actualiza `priceCheckedAt`, pero `priceUpdatedAt` solo cambia cuando el `lowestBin` de PS o PC cambia realmente en Futbin; puede ser `null` hasta el primer cambio observado. El refresco manual (`POST /api/v1/players/:id/prices/refresh`) aplica el mismo criterio.
- El estado de comparación de precios vive en memoria: tras reiniciar el servidor, la primera comprobación de cada jugador solo fija la referencia y no marca `priceUpdatedAt` (queda `null` hasta que Futbin cambie el precio). Después, las comprobaciones sin variación conservan `priceUpdatedAt`.
- El estado (`tracked`, `refreshes`, `changes`, `failures`, `lastRunAt`, etc.) aparece en `GET /health`; la configuración, en `GET /api/v1/meta`.
- El planificador se inicia con `npm start`/`src/server.js`; las pruebas crean la app sin él.

## Formato de errores

```json
{
  "error": {
    "code": "bad_request",
    "message": "El parámetro \"page\" debe ser un entero positivo."
  },
  "requestId": "..."
}
```

Códigos habituales: `unauthorized` (401), `bad_request` (400), `not_found` (404), `rate_limited` (429), `upstream_error` (502) y `internal_error` (500). Las respuestas incluyen `X-Request-Id` y las respuestas de datos incluyen `X-Cache: HIT|MISS`.

## Configuración

Copia `.env.example` a `.env` y ajusta lo necesario.

| Variable | Por defecto | Descripción |
| --- | --- | --- |
| `FUTBIN_API_KEY` | vacío | Clave(s) privada(s), separadas por comas. Obligatoria. |
| `HOST` | `127.0.0.1` | Interfaz de escucha. |
| `PORT` | `8787` | Puerto HTTP. |
| `FUTBIN_GAME_VERSION` | `27` | Versión de Futbin/EA FC. |
| `FUTBIN_BASE_URL` | `https://www.futbin.com` | URL base de Futbin. |
| `FUTBIN_FETCHER` | `auto` | `auto`, `curl` o `fetch`. En Windows usa `auto` o `curl`. |
| `FUTBIN_CURL_PATH` | `curl` | Ruta al ejecutable de curl. |
| `FUTBIN_COOKIE` | vacío | Cookies de navegador si Futbin bloquea las peticiones. |
| `FUTBIN_PROXY` | vacío | Proxy para curl, por ejemplo `http://127.0.0.1:8080`. |
| `FUTBIN_USER_AGENT` | Chrome de Windows | User-Agent usado en las peticiones. |
| `REQUEST_TIMEOUT_MS` | `25000` | Timeout por petición upstream. |
| `FUTBIN_MAX_RETRIES` | `2` | Reintentos para errores de red/5xx. |
| `UPSTREAM_CONCURRENCY` | `4` | Peticiones simultáneas máximas a Futbin. |
| `RATE_LIMIT_PER_MIN` | `60` | Límite de peticiones por clave/IP y minuto. |
| `CACHE_MAX_ENTRIES` | `400` | Entradas máximas en caché. |
| `CACHE_TTL_PLAYERS` | `120` | TTL del listado, en segundos. |
| `CACHE_TTL_PLAYER` | `60` | TTL de la ficha, en segundos. |
| `CACHE_TTL_PRICES` | `45` | TTL de precios, en segundos. |
| `CACHE_TTL_SEARCH` | `120` | TTL de búsqueda, en segundos. |
| `CACHE_TTL_HOVER` | `90` | TTL del resumen, en segundos. |
| `PRICE_AUTO_REFRESH` | `true` | Refresca precios en segundo plano mientras el servidor está arrancado. |
| `PRICE_REFRESH_INTERVAL_SECONDS` | `60` | Cada cuántos segundos se refresca cada jugador seguido. |
| `PRICE_REFRESH_TICK_SECONDS` | `15` | Cada cuántos segundos revisa el planificador qué jugadores toca refrescar. |
| `PRICE_REFRESH_BATCH_SIZE` | `3` | Máximo de jugadores refrescados por ciclo. |
| `PRICE_REFRESH_MAX_TRACKED` | `20` | Máximo de jugadores seguidos a la vez. |
| `PRICE_REFRESH_TRACK_TTL_SECONDS` | `900` | Tiempo sin consultas tras el cual se deja de seguir a un jugador. |
| `PRICE_WATCH_PLAYERS` | vacío | IDs separados por comas que se refrescan siempre, por ejemplo `8,22`. |
| `CORS_ORIGIN` | vacío | Origen permitido para CORS. |
| `TRUST_PROXY` | `false` | Confía en `X-Forwarded-*` de un proxy inverso. |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` o `silent`. |
| `FUTBIN_ALLOW_NO_KEY` | `false` | Solo para pruebas locales sin clave. No usar expuesto. |

## Notas sobre Futbin

- Futbin devuelve `403` a peticiones nativas sin firma de navegador; por eso el fetcher usa `curl` primero cuando está disponible.
- Los listados usan HTML paginado y los precios cambian con frecuencia. La API cachea y marca `meta.cached`.
- Algunos filtros de Futbin no funcionan de forma fiable. La API valida y reenvía los parámetros soportados; `version` y los filtros de rating no se incluyen porque no filtran correctamente en el sitio actual.
- Si Futbin empieza a bloquear, configura `FUTBIN_COOKIE` con cookies de una sesión de navegador o `FUTBIN_PROXY`.

## Pruebas

```powershell
npm test
```

Las pruebas unitarias y de API usan fixtures locales y no hacen peticiones a Futbin. Incluyen el planificador de precios, los snapshots y la superposición de precios frescos sobre la ficha del jugador.

Prueba end-to-end contra Futbin real (requiere `.env`, red y curl):

```powershell
npm run test:live
```

Verificación del catálogo completo (23.433 cartas en FC 27; el endpoint interno de búsqueda del Squad Builder se usa porque `/players` aplica un WAF agresivo):

```powershell
node scripts/verify-squad-catalog.mjs --end 1563 --delay 250 --detail-sample 80
```

El script es reanudable (`reports/squad-catalog.jsonl`), comprueba IDs duplicados, campos ausentes, recuentos por página y una muestra determinista de fichas completas contra el catálogo. El informe queda en `reports/squad-catalog-report.json` e incluye `ok`; las dos cartas sin nombre en el índice se validan además contra su ficha (`missingNameChecks`). La comprobación de las 23.433 fichas completas una a una no es viable (cientos de MB y decenas de miles de peticiones); la cobertura total se hace sobre las cartas del catálogo y la muestra de detalle cubre todas las posiciones.

## Estructura

```text
src/
  app.js             Rutas, autenticación, rate limit y errores
  server.js          Arranque y apagado ordenado
  config.js          Carga y validación de variables
  fetcher.js         curl/fetch, reintentos y detección de bloqueos
  service.js         Casos de uso, validación, caché y snapshots de precios
  price-refresher.js Planificador de actualización automática de precios
  parsers/           Extracción de HTML con cheerio
  utils/             Utilidades numéricas
fixtures/            HTML recortado para pruebas
test/                Pruebas con node:test
scripts/             Utilidades de fixtures y comprobación live
```
