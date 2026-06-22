# @ullage/mcp

An MCP server that gives an agent (OpenClaw, Hermes, any MCP client) a wine cellar with
**zero setup**: one config entry, no token, no Docker.

On first use it opens the SQLite default adapter at `~/.ullage/cellar.db` (override with
`ULLAGE_DB`; set `ULLAGE_BACKEND=sqlite` explicitly if you want to pin the adapter). The agent
uses its own LLM (including vision for labels/receipts) and calls these tools:

- `cellar_summary` — counts + recent wines (call first)
- `list_wines` — full cellar
- `add_wine` — `{ name, producer?, vintage?, quantity?, idempotencyKey }`
- `import_label_photo_wines` / `import_receipt_wines` — atomic confirmed batch saves
- `hold_wine`, `release_hold`, `list_holds` — protect bottles that should not be opened yet
- `consume_wine` — `{ id, quantity?, rating?, notes?, idempotencyKey }`
- `recommend_wines` — hold-aware recommendations
- `export_cellar` — full cellar as JSON, including holds/imports

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
npm run build --workspace @ullage/mcp
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

Normal installs should leave backend variables unset. Alternate storage adapters are private or
advanced integrations selected only by environment variable, and are not part of the zero-setup
agent path.
