# ullage

Your wine cellar, run by your AI agent — OpenClaw, Hermes, or any MCP client.

## What it does

- Chat with your agent to manage your cellar: add, list, update, consume (rating + notes), hold, release, recommend, export.
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

> **Agent reading this repo:** follow [docs/agent-install.md](docs/agent-install.md) to install
> and then operate the cellar. You need a shell with `git` and Node.js 20+.

Then just talk:
- *"Add a Barolo 2016."* — or share a **wine label photo**; it reads the label and adds the bottle.
- Share a **receipt photo** — it confirms the wine rows, saves all of them atomically, captures price / purchase date / store, and skips non-wine items.
- *"I drank the Chablis tonight — 2/5, too light."* — logged with your rating and note.
- *"Hold the Barolo for our anniversary."* — marked so it will not be opened accidentally.
- *"What should I drink with fried chicken?"* — it recommends from your cellar.

## How it works

ullage is the **system of record** — a wine cellar your agent reads and writes through MCP
tools. The intelligence (reading labels, pairing, "what should I drink") is your agent's own LLM
working over that data. By default there is no server, no token, and no Docker — just a local
SQLite adapter file you own.

The public install path is intentionally independent of any external wine API. Experimental
alternate storage adapters are selected only by environment variable and are not needed for normal
agent setup.

Optional safety mode: set `ULLAGE_APPEND_ONLY=true` with SQLite to prevent direct edits to saved
wine identity/purchase fields. Later changes should be recorded as consume, hold, release, or note
events.

## License

MIT — see [LICENSE](LICENSE).
