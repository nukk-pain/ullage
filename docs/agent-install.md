# Installing ullage (agent runbook)

You are an AI agent setting up **ullage** — a local wine cellar — for your user. Follow these
steps, then manage the cellar.

## 0. Prerequisites

- A shell with `git` and **Node.js 20+** (`git --version`, `node --version`).
- Know your runner: **Hermes**, **OpenClaw**, or another **MCP client**.

## 1. Get and build

```bash
git clone https://github.com/nukk-pain/ullage
cd ullage
npm install
npm run build --workspace @ullage/mcp
```

Note the absolute path to `apps/mcp/dist/index.js`.

## 2. Register the MCP server

- **Hermes:** `hermes mcp add ullage --command node --args <ABS>/apps/mcp/dist/index.js`
- **OpenClaw / generic MCP client:** add to your MCP config:
  ```json
  { "mcpServers": { "ullage": { "command": "node", "args": ["<ABS>/apps/mcp/dist/index.js"] } } }
  ```

Then **start a fresh session** so the tools load. The cellar is a local SQLite file at
`~/.ullage/cellar.db` (override with the `ULLAGE_DB` env var). No token, no server, no Docker.

## 3. Tools

`cellar_summary`, `list_wines`, `get_wine`, `add_wine`, `update_wine`, `consume_wine`,
`list_consumptions`, `add_note`, `list_notes`, `list_activity`, `export_cellar`. Verify the
install by calling `cellar_summary`.

## 4. Then manage the cellar

- Add wines the user mentions — capture **name, producer, vintage** (year in the `vintage`
  field, not the name) plus **region / varietal / drink-by** when known; `quantity` defaults to 1.
- When the user shares a **wine label or receipt photo, read it yourself** (your own vision) and
  add the wine(s). For a receipt, add **only the wine bottles** and skip whisky, beer, soju,
  snacks, sauces, and other non-wine items. Do not invent a vintage that isn't shown.
- Let the user **list / update** wines, **consume** bottles (decrement + rating + notes, logged
  to consumption history), review **`list_consumptions`**, and **export** everything.
- Record **tasting notes any time** with `add_note` (no need to open a bottle) and review them
  with `list_notes`; show the cellar's change history with `list_activity`.
- Always call `cellar_summary` first so you work from current state.
