# ullage

Your wine cellar, run by your AI agent — OpenClaw, Hermes, or any MCP client.

## What it does

- Chat with your agent to manage your cellar: add, list, search, update, consume (rating + notes), hold, release, recommend, export.
- **Drank something outside the cellar?** A glass at a restaurant or a friend's bottle is recorded as a tasting — inventory untouched — and shows up in one unified drink history with your cellar pours.
- Share a wine **label or receipt photo** — your agent reads it and saves confirmed wines in one batch. ullage runs no OCR; your agent's own vision does it.
- **Idempotent confirmed writes** — repeated chat/button actions can use the same idempotency key without creating duplicates.
- **Hold protection** — mark bottles that should not be opened yet; ordinary consumption and recommendations respect the hold.
- **Consumption history** — every bottle opened is logged with date, rating, and notes.
- **You own the data** — SQLite is the default adapter (`~/.ullage/cellar.db`), export anytime. OSS, MIT.

## Install — tell your agent

Give OpenClaw / Hermes / any MCP client this one line:

> Check https://github.com/nukk-pain/ullage and install it.

The agent reads [docs/agent-install.md](docs/agent-install.md), installs the MCP server for your
runner (SQLite default adapter — no token, no Docker), starts a fresh session, and then manages
your cellar per that runbook.

The npm package is not published yet, so `npx @ullage/mcp` is unavailable. Use the checkout
instructions in the runbook until a package release is available.

> **Agent reading this repo:** follow [docs/agent-install.md](docs/agent-install.md) to install
> and then operate the cellar. You need a shell with `git` and Node.js 20+.

Then just talk:
- *"Add a Barolo 2016."* — or share a **wine label photo**; it reads the label and adds the bottle.
- Share a **receipt photo** — it confirms the wine rows, saves all of them atomically, captures price / purchase date / store, and skips non-wine items.
- *"I drank the Chablis tonight — 2/5, too light."* — logged with your rating and note.
- *"Had a great Brunello at the steakhouse — 4.5."* — recorded as an outside tasting; your cellar stays untouched.
- *"Hold the Barolo for our anniversary."* — marked so it will not be opened accidentally.
- *"What should I drink with fried chicken?"* — it recommends from your cellar.

## How it works

ullage is the **system of record** — a wine cellar your agent reads and writes through MCP
tools. The intelligence (reading labels, pairing, "what should I drink") is your agent's own LLM
working over that data. By default there is no server, no token, and no Docker — just a local
SQLite adapter file you own.

**Input and error compatibility:** explicitly supplied `null` or empty quantities are rejected;
omit `quantity` to use the default of one. Date fields accept real calendar dates and, when a time is
included, require `HH:MM[:SS[.fff]]` followed by an optional `Z` or `±HH:MM` offset. Integer fields
such as `vintage`, `limit`, and `offset` reject booleans, arrays, and objects. Beginning with this
release, the HTTP adapter sends `Idempotency-Key` headers in the `ullage-v1-*` SHA-256 format while
keeping the original key for local replay checks; the previous public release sent no such header.
The HTTP tools transport returns `409` for partial consumption and `501` for operations unsupported
by its backend.

For HTTP cellar adapters, `add_wine` sends the `varietal` and `grape_variety` fields with the same
value for compatibility with servers that recognize either name, and sends `vintage` as a number.
Set `ULLAGE_HTTP_MAX_RESPONSE_BYTES` to an integer from 1 through 1073741824 to change the maximum
HTTP response size; it defaults to 33554432 bytes (32 MiB) so large cellar lists remain readable.
If a write may have reached the server but its response was lost, retry with the same idempotency key;
without persistent server-side idempotency support, the outcome may remain uncertain.

**Date and time policy:** dates use exactly four-digit years from `0000` through `9999` and must be
real Gregorian calendar dates. A date field that includes a time keeps the written calendar date.
`consumedAt` timestamps with an explicit `Z` or numeric offset identify an instant; without an offset,
the runtime's local timezone determines the instant. These are the existing semantics, including the
timezone-dependent interpretation of offset-free timestamps.

The public install path is intentionally independent of any external wine API. Experimental
alternate storage adapters are selected only by environment variable and are not needed for normal
agent setup.

Optional safety mode: set `ULLAGE_APPEND_ONLY=true` with SQLite to reject every `update_wine` change
to an existing wine. Later changes should be recorded as consume, hold, release, or note events.

Advanced HTTP adapter settings: set `ULLAGE_BACKEND=http`, `ULLAGE_HTTP_BASE_URL`, and optionally
`ULLAGE_HTTP_HEADERS`, `ULLAGE_HTTP_TIMEOUT_MS` (1–300000; default 10000), and
`ULLAGE_HTTP_MAX_RESPONSE_BYTES` (1–1073741824; default 33554432).

## License

MIT — see [LICENSE](LICENSE).
