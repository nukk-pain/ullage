# @ullage/mcp

An MCP server that gives an agent (OpenClaw, Hermes, any MCP client) a wine cellar with
**zero setup**: one config entry, no token, no Docker.

On first use it opens a local SQLite cellar at `~/.ullage/cellar.db` (override with `ULLAGE_DB`).
The agent uses its own LLM (including vision for labels/receipts) and calls these tools:

- `cellar_summary` — counts + recent wines (call first)
- `list_wines` — full cellar
- `add_wine` — `{ name, producer?, vintage?, quantity? }`
- `consume_wine` — `{ id, quantity?, rating?, notes? }`
- `export_cellar` — full cellar as JSON

The agent does label/receipt OCR itself (its vision LLM) and calls `add_wine` with the
extracted fields — the server stores data, it does not run OCR.

## Run

```bash
npx @ullage/mcp           # speaks MCP over stdio
```

Requires **Node 20+**. Storage uses `better-sqlite3` (native, prebuilt binaries),
so no experimental flags.

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

## Local vs remote

This prototype is **local-only** (SQLite, single machine, no auth — trusts the local OS user
over stdio). For sync / multi-device / web access, a future remote mode points the server at a
hosted ullage with a scoped token (the ADR 0002 connector path, over MCP).
