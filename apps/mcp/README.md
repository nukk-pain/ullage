# @ullage/mcp

An MCP server that gives an agent (OpenClaw, Hermes, any MCP client) a wine cellar with
**zero setup**: one config entry, no token, no Docker.

On first use it opens the SQLite default adapter at `~/.ullage/cellar.db` (override with
`ULLAGE_DB`; set `ULLAGE_BACKEND=sqlite` explicitly if you want to pin the adapter). The agent
uses its own LLM (including vision for labels/receipts) and calls these tools:

- `cellar_summary` — in-stock counts + recent wines (call first)
- `list_wines` — full cellar, with optional `query` search and `inStock` filter
- `get_exchange_rate` — quote a currency in the configured home currency for a date
- `resolve_wine` — natural-language name → one wine, candidates to disambiguate, or none
- `add_wine` — `{ name, producer?, vintage?, quantity?, idempotencyKey }`
- `import_label_photo_wines` / `import_receipt_wines` — atomic confirmed batch saves, with
  batch-level `purchaseDate` and `receiptImageUrl`
- `hold_wine`, `release_hold`, `list_holds` — protect bottles that should not be opened yet;
  aging holds carry an `until` date and re-holding updates it
- `consume_wine` — `{ id, quantity?, rating?, notes?, consumedAt?, idempotencyKey }`
- `update_consumption` — fix the rating/notes on a past pour
- `record_tasting` / `list_tastings` — wines drunk outside the cellar (restaurant, bar) plus a
  unified drink history across cellar pours and outside tastings
- `recommend_wines` — hold-aware recommendations
- `export_cellar` — full cellar as JSON, including holds/imports/tastings

The agent does label/receipt OCR itself (its vision LLM), asks for confirmation when needed, and
calls the import tools with extracted fields. The server stores data; it does not run OCR.

## Run

```bash
git clone https://github.com/nukk-pain/ullage
cd ullage
npm ci
npm run build
node apps/mcp/dist/index.js
```

Requires **Node 20+**. The npm package is not published yet, so `npx @ullage/mcp` is unavailable.
The default SQLite adapter uses `better-sqlite3` (native, prebuilt binaries), so no experimental
flags are required.

## Register with an agent

**OpenClaw / Hermes / generic MCP client** — build the checkout above, then add one stdio server
entry using the absolute path to the built file, e.g.:

```json
{
  "mcpServers": {
    "ullage": { "command": "node", "args": ["<ABS>/ullage/apps/mcp/dist/index.js"] }
  }
}
```

Hermes one-liner: `hermes mcp add ullage --command node --args <ABS>/ullage/apps/mcp/dist/index.js`.

That is the whole setup — start talking ("add a Barolo 2016", "what's in my cellar").

## Backends

SQLite is the default adapter and remains zero setup: omit backend configuration, or set
`ULLAGE_BACKEND=sqlite` / `ULLAGE_STORE=sqlite`. `ULLAGE_DB` selects the local database file and
defaults to `~/.ullage/cellar.db`.

Set `ULLAGE_APPEND_ONLY=true` with SQLite to reject direct edits to saved wine
identity/purchase fields and record later changes as consume, hold, release, or note events.

To keep `price` in one currency, set `ULLAGE_HOME_CURRENCY` (e.g. `KRW`). With no other FX setting,
Ullage uses the built-in Frankfurter ECB provider. Frankfurter requires no API key and offers daily
historical rates; it is a reference-rate source, not a live trading feed. A requested date can map to
another provider observation date when no rate was published that day; `get_exchange_rate` returns
that actual `rateDate` and the `source`. Ullage searches the previous ten calendar days plus the
requested date and uses the latest available ECB observation in that range; it returns an error if
the provider has no matching rate in that window.

`ULLAGE_FX_RATE_URL` remains optional and overrides the built-in provider for compatibility. Its
template may use `{currency}` and `{date}` and must return JSON with a positive numeric `rate`
(home-currency units per one foreign unit). Include a `date` or `rateDate` field when the custom
source reports an observation date; older `{rate}`-only responses continue to use the requested date.
`add_wine` and the import tools accept `currency` for a foreign price, convert it at the purchase-date
rate, and append the original amount, provider, and applied rate date to `notes`. Without
`ULLAGE_HOME_CURRENCY`, a foreign `currency` is rejected, never stored as-is.

### HTTP backend

Set `ULLAGE_BACKEND=http` and provide `ULLAGE_HTTP_BASE_URL`. The base URL is required and has no
default; trailing slashes are removed. `ULLAGE_STORE=http` is also accepted as the backend variable
alias. Set `ULLAGE_HTTP_HEADERS` only when the server requires additional headers. Its value must
be a JSON object whose values are strings, for example:

```sh
ULLAGE_BACKEND=http
ULLAGE_HTTP_BASE_URL=https://cellar.example/api
ULLAGE_HTTP_HEADERS='{"Authorization":"Bearer example"}'
```

The client always sends `Accept: application/json`; JSON requests also include `Content-Type` and
`Content-Length`. Configured headers are added to those requests. The server must implement this
contract:

| Request | Request body | Successful response |
| --- | --- | --- |
| `GET /wines` | None | `{ "wines": [Wine, ...] }` |
| `POST /wines` | `{ name, quantity, producer?, vintage?, region?, country?, varietal?, grape_variety?, price?, store?, purchase_date?, notes? }` | A `Wine` object |
| `GET /wines/{id}` | None | A `Wine` object; `404` means not found |
| `POST /wines/{id}/consume` | `{ rating?, note?, consumed_at? }` | A `Wine` object or `{ "sourceWine": Wine }`; `404` means not found |
| `GET /wines?status=Consumed&limit=100&offset={n}` | None | `{ "wines": [Consumption, ...], "total": number }` |

`Wine` responses use camelCase fields and must include non-empty `id`, `name`, `createdAt`, and
`updatedAt`. Optional fields include `producer`, `vintage`, `region`, `country`, `varietal` (or
`grapeVariety`), `price`, `quantity`, `rating`, `notes`, `store`, and `purchaseDate`. Consumption
rows must include non-empty `id`, `wineId`, and `consumedAt`; `quantity` defaults to one if omitted.
The client filters `GET /wines` results locally. A consume quantity greater than one becomes
sequential `POST /wines/{id}/consume` requests. MCP `idempotencyKey` values are sent to the HTTP
server as `Idempotency-Key` headers; each bottle request uses a stable per-bottle key derived from
the supplied key.

The client treats `404` as not found only for the wine lookup and consume requests. Other non-2xx
responses fail the operation, and the error omits the server response body. Successful responses
must match the JSON shapes above. Operations that require import, update, tasting, note, hold,
recommendation, activity, or export semantics are unsupported by this adapter and fail before
making an HTTP request.

The client coalesces and replays completed requests within the current process. The HTTP server must
honor and persist `Idempotency-Key` for per-request deduplication across restarts or clients; the
adapter cannot guarantee deduplication when that contract is absent. The adapter also cannot recover
the original clamped bottle count after a restart because the HTTP contract has no atomic multi-bottle
consume operation. If a consume fails after one or more successful bottle requests, the client
reports the confirmed partial count. A lost response can leave the outcome of the last request
unknown, so safe retry requires persistent server-side support for the idempotency header.

**Compatibility:** explicitly supplied `null` or empty quantities are rejected; omit `quantity` to
use the default of one. Original idempotency keys remain local, while upstream `Idempotency-Key`
headers contain a deterministic ASCII SHA-256 representation (and a per-bottle suffix for consume).
The HTTP tools transport maps partial consumption to `409 Conflict` and unsupported HTTP-backend
operations to `501 Not Implemented`, preserving each error message.

Normal installs should leave backend variables unset. Alternate storage adapters are private or
advanced integrations selected only by environment variable, and are not part of the zero-setup
agent path.
