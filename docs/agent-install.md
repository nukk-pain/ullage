# Installing ullage (agent runbook)

You are an AI agent setting up **ullage** — a local wine cellar — for your user. Follow these
steps, then manage the cellar.

## 0. Prerequisites

- A shell with `git` and **Node.js 20+** (`git --version`, `node --version`).
- Know your runner: **Hermes**, **OpenClaw**, or another **MCP client**.

## 1. Get and build

The npm package is not published yet, so `npx @ullage/mcp` is unavailable. Install from a checkout:

```bash
git clone https://github.com/nukk-pain/ullage
cd ullage
npm ci
npm run build
```

Note the absolute path to `apps/mcp/dist/index.js`.

## 2. Register the MCP server

- **Hermes:** `hermes mcp add ullage --command node --args <ABS>/apps/mcp/dist/index.js`
- **OpenClaw / generic MCP client:** add to your MCP config:
  ```json
  { "mcpServers": { "ullage": { "command": "node", "args": ["<ABS>/apps/mcp/dist/index.js"] } } }
  ```

Then **start a fresh session** so the tools load. SQLite is the default adapter and stores the
cellar at `~/.ullage/cellar.db` (override with `ULLAGE_DB`; optional `ULLAGE_BACKEND=sqlite` or
`ULLAGE_STORE=sqlite`). No token, no server, no Docker are required for the default mode.

Optional local safety mode: set `ULLAGE_APPEND_ONLY=true` if the user wants saved wine
identity/purchase fields protected from direct edits. In that mode, record later changes with
`consume_wine`, `hold_wine`, `release_hold`, or `add_note`.
This mode protects identity and purchase fields only. `quantity` and wine-level `notes` remain
editable through `update_wine`; use `consume_wine` when a bottle was opened and `add_note` for a
dated tasting note.

Do not require or configure any external wine API for a normal install. Alternate storage adapters
are private/advanced integrations selected only by environment variable; leave them unset unless
the user explicitly provides backend-specific instructions. OCR and receipt parsing still belong
to you, the agent; ullage only stores and retrieves cellar data.

## 3. Tools

`cellar_summary`, `list_wines`, `get_wine`, `resolve_wine`, `add_wine`, `update_wine`,
`consume_wine`, `list_consumptions`, `update_consumption`, `record_tasting`, `list_tastings`,
`add_note`, `list_notes`, `list_activity`, `export_cellar`, `import_label_photo_wines`,
`import_receipt_wines`, `hold_wine`, `release_hold`, `list_holds`, `recommend_wines`,
`get_exchange_rate`.
Verify the install by calling `cellar_summary`.

## 4. Then manage the cellar

- Add wines the user mentions — capture **name, producer, vintage** (year in the `vintage`
  field, not the name) plus **region / varietal / drink-by** when known; `quantity` defaults to 1.
- When the user shares a **wine label or receipt photo, read it yourself** (your own vision), ask
  for confirmation when needed, then call `import_label_photo_wines` or `import_receipt_wines`
  once with all confirmed wine rows and a stable `idempotencyKey`. For a receipt, include **only
  the wine bottles** and skip whisky, beer, soju, snacks, sauces, and other non-wine items; also
  record each wine's **price, purchase date, and store** from the receipt. Do not invent a vintage
  that isn't shown.
- Let the user **list / update** wines, **consume** bottles (decrement + rating + notes, logged
  to consumption history), review **`list_consumptions`**, and **export** everything.
- Record **tasting notes any time** with `add_note` (no need to open a bottle) and review them
  with `list_notes`; show the cellar's change history with `list_activity`.
- Use `hold_wine`, `release_hold`, and `list_holds` for bottles that should not be opened yet.
  For aging holds ("keep the Barolo until 2030") pass `until` (YYYY-MM-DD); calling `hold_wine`
  again on a held wine updates its date. Do not call `consume_wine` on held wine unless the user
  explicitly confirms releasing the hold first.
- When the user opened a bottle earlier ("we drank it yesterday"), pass `consumedAt` (YYYY-MM-DD)
  to `consume_wine` so the history carries the real date.
- When the user names a wine ("the Barolo", "Chablis 2020"), call `resolve_wine` first; on an
  `ambiguous` result, ask the user to pick a candidate before any write.
- When the user drank a wine **outside the cellar** (restaurant, bar, a friend's bottle), record
  it with `record_tasting` — it never touches inventory. `consume_wine` is only for bottles
  opened from the cellar. Review everything actually drunk with `list_tastings`.
- Fix the rating/notes on a past pour with `update_consumption` (event id from `list_consumptions`).
- Use stable `idempotencyKey` values for every user-confirmed write (`add_wine`, `update_wine`,
  `consume_wine`, `update_consumption`, `record_tasting`, `add_note`, import tools, `hold_wine`,
  `release_hold`) so retries do not duplicate work.
- Use `recommend_wines` for hold-aware recommendations before suggesting a bottle to open.
- Always call `cellar_summary` first so you work from current state.

## 5. Wine details — your knowledge, the cellar's memory

ullage never fetches wine data from the internet. When the user asks "what's this wine like?",
"when should I open it?", or "is this producer any good?", answering is your job — use your own
wine knowledge, and web search when you need current or specific facts. Then persist what is
durable, so the cellar answers first next time:

- Corrected or newly learned **identity facts** (varietal, region, country, producer) →
  `update_wine`.
- A **drinking window** → `update_wine` with `drinkByDate`; for a bottle worth aging, offer
  `hold_wine` with `until` set to the window's start.
- A **style profile or critic consensus** worth keeping → `add_note`, with the source URL in
  the note text. Check `list_notes` before searching the web again — earlier lookups may
  already answer.
- Do **not** store volatile data such as market prices; look those up fresh each time and
  compare against the stored purchase `price` when the user asks whether they paid well.
- Never overwrite user-entered facts with fetched ones without confirmation; the user's label
  and receipt are the primary source for identity and purchase fields.
