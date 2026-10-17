# @ullage/mcp

An MCP server that gives an agent (OpenClaw, Hermes, any MCP client) a wine cellar with
**zero setup**: one config entry, no token, no Docker.

On first use it opens the SQLite default adapter at `~/.ullage/cellar.db` (override with
`ULLAGE_DB`; set `ULLAGE_BACKEND=sqlite` explicitly if you want to pin the adapter). The agent
uses its own LLM (including vision for labels/receipts) and calls these tools:

- `cellar_summary` — in-stock counts + recent wines (call first)
- `list_wines` — full cellar, with optional `query` search and `inStock` filter
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
npx @ullage/mcp           # speaks MCP over stdio
```

Requires **Node 20+**. The default SQLite adapter uses `better-sqlite3` (native, prebuilt
binaries), so no experimental flags.

From a checkout instead of npm:

```bash
npm run build
node apps/mcp/dist/index.js
```

## Register with an agent

**OpenClaw / Hermes / generic MCP client** — add one stdio server entry, e.g.:

```json
{
  "mcpServers": {
    "ullage": { "command": "npx", "args": ["-y", "@ullage/mcp"] }
  }
}
```

Hermes one-liner: `hermes mcp add ullage --command npx --args -y @ullage/mcp`.

That is the whole setup — start talking ("add a Barolo 2016", "what's in my cellar").

## Backends

SQLite is the default adapter and remains zero setup: omit backend configuration, or set
`ULLAGE_BACKEND=sqlite` / `ULLAGE_STORE=sqlite`. `ULLAGE_DB` selects the local database file and
defaults to `~/.ullage/cellar.db`.

Set `ULLAGE_APPEND_ONLY=true` with SQLite to reject direct edits to saved wine
identity/purchase fields and record later changes as consume, hold, release, or note events.

To keep `price` in one currency, set `ULLAGE_HOME_CURRENCY` (e.g. `KRW`) and `ULLAGE_FX_RATE_URL`
together. The URL takes `{currency}` and `{date}` placeholders and must return JSON with a positive
`rate` (home-currency units per one foreign unit). `add_wine` and the import tools then accept a
`currency` for a foreign price, convert it at the purchase-date rate, and append the original
amount to `notes`. Without these variables a foreign `currency` is rejected, never stored as-is.

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
sequential `POST /wines/{id}/consume` requests. MCP `idempotencyKey` values remain client-side
deduplication keys and are not sent to the HTTP server.

The client treats `404` as not found only for the wine lookup and consume requests. Other non-2xx
responses fail the operation, and the error omits the server response body. Successful responses
must match the JSON shapes above. Operations that require import, update, tasting, note, hold,
recommendation, activity, or export semantics are unsupported by this adapter and fail before
making an HTTP request.

Normal installs should leave backend variables unset. Alternate storage adapters are private or
advanced integrations selected only by environment variable, and are not part of the zero-setup
agent path.
