# ullage installation and agent runbook

You are an AI agent installing or operating ullage for the user. SQLite is the default backend and stores the cellar at `~/.ullage/cellar.db`. The user may override that location with `ULLAGE_DB` in the MCP server environment.

## 1. Check before installing

1. Check the active runner's MCP server list for `ullage`.
2. Check the configured MCP command path and find whether it belongs to an existing ullage checkout.
3. If either check finds an installation, follow [Upgrade an existing installation](#3-upgrade-an-existing-installation) before making another checkout.
4. If neither check finds an installation, continue with [Install from a checkout](#2-install-from-a-checkout).

## 2. Install from a checkout

1. Confirm the shell has Git and Node.js 20 or newer with `git --version` and `node --version`.
2. Clone and build ullage:

   ```bash
   git clone https://github.com/nukk-pain/ullage
   cd ullage
   npm ci
   npm run build
   ```

3. From the checkout root, run `pwd` and use its output as `<REPO>`, the absolute path to the cloned repository. The server entry point is `<REPO>/apps/mcp/dist/index.js`.
4. Register ullage with the runner:

   - **OpenClaw:** `openclaw mcp add ullage --command node --arg <REPO>/apps/mcp/dist/index.js`
     Add one `--env KEY=VALUE` for each environment variable the server needs. OpenClaw probes the server before it saves the definition. The CLI manages the OpenClaw `mcp.servers` configuration; a generic `mcpServers` JSON file is not an OpenClaw configuration format.
   - **Hermes:** `hermes mcp add ullage --command node --args <REPO>/apps/mcp/dist/index.js`
     Add each `--env KEY=VALUE` before `--args` when needed, because `--args` consumes the remaining arguments.
   - **Generic MCP client:** configure a stdio server using this generic MCP JSON shape:

     ```json
     {
       "mcpServers": {
         "ullage": {
           "command": "node",
           "args": ["<REPO>/apps/mcp/dist/index.js"]
         }
       }
     }
     ```

5. Start a new runner session so it discovers the tools.
6. Call `cellar_summary` to verify that the MCP server starts and can read the cellar.

The default SQLite adapter needs no token, Docker, or separate server. Do not configure an external wine API for a normal install. ullage does not perform OCR: read label and receipt images with your own vision, confirm uncertain rows with the user, and send only confirmed wine data to an import tool.

For an explicitly requested HTTP cellar integration, set `ULLAGE_BACKEND=http` and the required `ULLAGE_HTTP_BASE_URL` in the MCP server environment. `ULLAGE_HTTP_HEADERS` is optional JSON containing string-valued headers; `ULLAGE_HTTP_TIMEOUT_MS` accepts 1 through 300000 and defaults to 10000; `ULLAGE_HTTP_MAX_RESPONSE_BYTES` accepts 1 through 1073741824 and defaults to 33554432. Do not choose a remote backend or invent endpoint or authentication values for the user.

## 3. Upgrade an existing installation

Use the exact database path from the MCP server's `ULLAGE_DB` environment when it is set; otherwise the database is `~/.ullage/cellar.db`. If the runner does not pass `ULLAGE_DB` to your shell, set `DB` to the configured database path. The backup commands preserve that explicit `DB` value, verify the source path before copying, then check the backup integrity and compare its wine row count and quantity total with the source:

```bash
DB="${DB:-${ULLAGE_DB:-$HOME/.ullage/cellar.db}}"
BACKUP="$HOME/ullage-backups/cellar-before-update-$(date +%Y%m%d-%H%M%S).db"
test -f "$DB" || { echo "Database does not exist: $DB" >&2; exit 1; }
DB="$(cd "$(dirname "$DB")" && pwd)/$(basename "$DB")"
printf 'Backing up database: %s\n' "$DB"
mkdir -p "$HOME/ullage-backups"
sqlite3 "$DB" ".backup '$BACKUP'"
test -s "$BACKUP" || { echo "Backup is missing or empty: $BACKUP" >&2; exit 1; }
SOURCE_CHECK="$(sqlite3 "$DB" 'PRAGMA integrity_check; SELECT count(*) FROM wines; SELECT coalesce(sum(quantity), 0) FROM wines;')"
BACKUP_CHECK="$(sqlite3 "$BACKUP" 'PRAGMA integrity_check; SELECT count(*) FROM wines; SELECT coalesce(sum(quantity), 0) FROM wines;')"
printf 'Source integrity, wine rows, bottle total:\n%s\n' "$SOURCE_CHECK"
printf 'Backup integrity, wine rows, bottle total:\n%s\n' "$BACKUP_CHECK"
test "$SOURCE_CHECK" = "$BACKUP_CHECK" || { echo "Backup verification differs from source" >&2; exit 1; }
```

If `sqlite3` is unavailable, stop the runner and every other Ullage process that can write to the database before copying. Then copy the database and any existing sidecars with:

```bash
cp "$DB" "$BACKUP"
test ! -f "$DB-wal" || cp "$DB-wal" "$BACKUP-wal"
test ! -f "$DB-shm" || cp "$DB-shm" "$BACKUP-shm"
```

Keep the sidecars beside the copied database until SQLite opens it. Install or use `sqlite3` to run the integrity and row-count checks above before continuing. Never copy a live database file by itself.

1. Tell the user that you are about to upgrade ullage.
2. Create a readable SQLite backup before changing the checkout, then confirm the backup integrity, wine row count, and bottle total against the source.
3. Call `cellar_summary` and record its wine count before the upgrade.
4. In the existing checkout, run `git fetch origin`.
5. Check for local changes and commits before applying the fetched update:

   ```bash
   git status --porcelain
   git rev-list --left-right --count HEAD...origin/main
   ```

   Stop and ask the user before continuing if the working tree is not clean or if there are local-only commits that must be kept. On a checkout with normal history and no local-only commits, fast-forward it:

   ```bash
   git merge --ff-only origin/main
   ```

   If fast-forward fails because this checkout predates the 2026-10-17 history rewrite, first confirm again that `git status --porcelain` is empty and inspect the commits shown by `git log --oneline origin/main..HEAD`. Reset only when those commits are solely the old pre-rewrite history and there are no local changes or local work to preserve:

   ```bash
   git reset --hard origin/main
   ```

   If you cannot confirm that nothing local needs to be kept, stop and ask the user. Do not reset a dirty checkout or discard local work.
6. Before building or replacing a running process, confirm that the checkout is exactly at the fetched target:

   ```bash
   test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)"
   ```

   Stop if this check fails; do not build or restart from a different commit.
7. Before starting the updated server, inspect the existing MCP environment for both `ULLAGE_STORE` and `ULLAGE_BACKEND`. The code uses any non-empty `ULLAGE_STORE` value before `ULLAGE_BACKEND`; when changing backends, remove `ULLAGE_STORE` or set it to the same backend value so it cannot override the new setting.
8. If the existing environment has `ULLAGE_BACKEND=openclaw`, change it to `ULLAGE_BACKEND=http` before starting the updated server and set `ULLAGE_HTTP_BASE_URL` to the HTTP service URL supplied by the user. `ULLAGE_HTTP_BASE_URL` is required for HTTP; do not start the new server until it is set. Do not invent the URL or credentials.
9. Run `npm ci && npm run build` from the checkout.
10. Replace the running MCP process and start a new agent session. For Hermes, start a fresh session or restart the process that owns the MCP connection. For OpenClaw, restart the Gateway that owns the MCP connection with `openclaw gateway restart`; `openclaw mcp reload` refreshes only runtimes owned by that CLI process and does not refresh a separate Gateway. See [OpenClaw MCP connection guidance](https://docs.openclaw.ai/tools/mcp) and [OpenClaw gateway restart guidance](https://docs.openclaw.ai/cli/gateway/restart-and-supervision).
11. Call `cellar_summary` and compare the wine count with the count recorded before the update. This count alone does not prove that the new version is running: duplicate active holds can change the summary after migration, while a stale version may return the same count. If SQLite CLI (`sqlite3`) is available, also check the configured database for the migration schema:

   ```bash
   DB="${DB:-${ULLAGE_DB:-$HOME/.ullage/cellar.db}}"
   sqlite3 "$DB" "PRAGMA table_info(idempotency_keys); SELECT key, value FROM schema_meta WHERE key = 'tasting-image-url-backfill-v1';"
   ```

   Confirm that `idempotency_keys` includes `hash_version` and that `schema_meta` reports `tasting-image-url-backfill-v1` as `complete`. These markers are created by the current migration code. If `sqlite3` is unavailable, skip this supplemental database check; do not treat the `cellar_summary` comparison by itself as proof of the running version. If the summary counts differ, compare `SELECT count(*) FROM wines;` and `SELECT coalesce(sum(quantity), 0) FROM wines;` before and after to confirm the wine rows and bottle total.
12. Tell the user what happened during migration: existing wine and event records remain in place; if duplicate active holds exist for one wine, the newest active hold remains and older ones are released; legacy tasting image URLs are copied into their image field once; and idempotency metadata columns are added. Also explain the breaking changes: the old `openclaw` backend name is now `http`, and explicitly sending a null or empty `quantity` is rejected. Omit details that do not apply to the user's configured backend or database.

## 4. MCP tools

ullage exposes these 22 tools:

| Tool | Use |
| --- | --- |
| `cellar_summary` | Read the current wine and bottle counts. Call this first. |
| `list_wines` | List and search cellar wines. |
| `get_wine` | Read one wine by ID. |
| `resolve_wine` | Resolve a name to one wine; ask the user when the result is ambiguous. |
| `add_wine` | Add one wine. |
| `update_wine` | Update fields of an existing wine when append-only mode is off. |
| `consume_wine` | Open cellar bottles and record the pour. |
| `list_consumptions` | Review cellar pour history. |
| `update_consumption` | Correct a past pour's rating or notes. |
| `record_tasting` | Record wine tasted outside the cellar without changing inventory. |
| `list_tastings` | Review the unified history of cellar pours and outside tastings. |
| `add_note` | Add a dated wine note without opening a bottle. |
| `list_notes` | Review wine notes. |
| `list_activity` | Review cellar changes. |
| `export_cellar` | Export cellar data. |
| `import_label_photo_wines` | Add confirmed wine rows read from a label image. |
| `import_receipt_wines` | Add confirmed wine rows read from a receipt. |
| `hold_wine` | Protect a wine from ordinary recommendations and consumption. |
| `release_hold` | Release a wine's active hold. |
| `list_holds` | Review active and released holds. |
| `recommend_wines` | Get recommendations that account for holds. |
| `get_exchange_rate` | Look up a configured home-currency rate for a date. |

## 5. Input rules for agent calls

- Omit `quantity` to use one for `add_wine`, imports, and `consume_wine`. When supplied, it must be a non-negative safe integer for inventory edits, or a positive integer for `consume_wine`. Never send `null`, an empty string, a boolean, an array, an object, or a fractional value as a quantity.
- Use four-digit-year Gregorian dates in `YYYY-MM-DD` form. Date fields can also contain a time in `YYYY-MM-DD[T ]HH:MM[:SS[.fff]][Z|±HH:MM]` form; the date field stores the written calendar date. Do not send impossible calendar dates.
- `consumedAt` accepts a date or that date-time form. A date is stored at midnight UTC. A timestamp with `Z` or an offset identifies an instant; a timestamp without a zone is interpreted in the runtime's local timezone. Include `Z` or an offset when the user gave an exact instant or timezone.
- Integer fields such as `vintage`, `limit`, and `offset` must be safe integers. Do not send booleans, arrays, objects, fractions, or unsafe integers. Omit an unknown optional integer instead of guessing it.
- Every confirmed write tool requires a stable `idempotencyKey`. Reuse the same key only when retrying the same action with the same data; use a new key for a different action.
- For `record_tasting`, ask for the tasting date if it is unknown. This tool records an outside tasting and never changes cellar stock.
- For `consume_wine` and `hold_wine`, resolve a wine name first. If `resolve_wine` returns multiple candidates, ask the user to choose before writing. A held bottle cannot be consumed until the user confirms release.

## 6. Currency and exchange rates

`ULLAGE_HOME_CURRENCY` enables exchange-rate lookup and must be a three-letter ISO 4217 code, such as `KRW`. With only this variable set, Ullage uses its built-in historical ECB rates through Frankfurter. `ULLAGE_FX_RATE_URL` is optional and overrides the built-in provider. It must be an `http://` or `https://` URL template containing `{currency}` and may contain `{date}`. The custom endpoint must return JSON with a positive numeric `rate`; it may include `date` or `rateDate` for the actual observation date.

For `add_wine`, `import_label_photo_wines`, and `import_receipt_wines`, send `currency` with any foreign-currency `price`. Ullage converts the amount to the configured home currency using the purchase date, the batch purchase date, or today's date, in that order. It rounds the converted amount to a whole unit and adds the original amount, rate, observation date, and source to `notes`. Same-currency prices need no lookup. Without a `currency` field, Ullage leaves the supplied price unchanged; therefore, identify the currency whenever the price is not already in the home currency.

`get_exchange_rate` accepts an ISO currency and optional `YYYY-MM-DD` date. Its result reports the rate, home currency, observation date, and source. Without `ULLAGE_HOME_CURRENCY`, the tool reports that no home currency is configured; a foreign-currency price with a `currency` field is rejected instead of being stored unconverted. If the provider is offline or returns an invalid response, the write fails and can be retried after the provider is available. Failed lookups are not cached. Prices without a `currency` field and tastings recorded with `record_tasting` are not converted.

## 7. Append-only mode

`ULLAGE_APPEND_ONLY=true` enables append-only behavior for the SQLite adapter. In this mode, every non-empty `update_wine` call on an existing wine is rejected, including quantity and notes changes. Record later information with `add_note`; use `consume_wine`, `hold_wine`, and `release_hold` for their corresponding cellar events. `update_consumption` remains available to correct a past pour's rating or notes, and `record_tasting` can still add an outside tasting.

## 8. Cellar operation

- Always call `cellar_summary` first. Use `list_wines` or `resolve_wine` to identify an existing wine before consuming or holding it.
- Save confirmed facts only. Keep the year in `vintage`, not in the wine `name`; do not invent a vintage or overwrite user-entered identity and purchase facts without confirmation.
- For a label or receipt image, read it yourself, ask the user to confirm uncertain details, and then send all confirmed wine rows in one import call with a stable `idempotencyKey`. For receipts, exclude non-wine items and capture each wine's price, purchase date, and store when shown.
- Use `record_tasting` for wine tasted outside the cellar. Use `consume_wine` only for a bottle opened from the cellar. Pass `consumedAt` when the user says the bottle was opened earlier.
- Use `hold_wine` for bottles the user wants to protect. An `until` value is informational and does not automatically release the hold. Do not consume a held wine unless the user confirms that it can be released.
- Use `recommend_wines` before suggesting a cellar bottle to open. Do not fetch wine facts through an external wine API; answer from your own knowledge and use web research only when current or specific facts are needed. Persist durable, sourced observations with `add_note` when useful.
- Use `export_cellar` when the user asks for an export. Do not move, delete, or directly edit the SQLite database as part of ordinary cellar operation.

## 9. Troubleshooting

- **Node version or engine error:** run `node --version` and use Node.js 20 or newer, then repeat `npm ci` and `npm run build`.
- **`better-sqlite3` native module build fails:** confirm that Node.js is 20 or newer, inspect the `npm ci` build error for missing platform C/C++ build tools, install the tools required by that platform, and rerun `npm ci`.
- **Tools are missing in the agent:** restart the process that owns the MCP connection and start a new session. For OpenClaw, `openclaw mcp reload` only refreshes the current CLI process; use the owning Gateway's supported reload or restart path.
- **`cellar_summary` fails:** confirm that the MCP server process can read and write the configured `ULLAGE_DB` file, or the default `~/.ullage/cellar.db`; check the runner's MCP startup error and confirm that the backup from an upgrade is intact.
- **A foreign-currency write fails:** confirm that `ULLAGE_HOME_CURRENCY` is set and valid, and that the configured rate source is reachable. Do not retry with the currency removed, because that would store the unconverted amount as if it were already in the home currency.
