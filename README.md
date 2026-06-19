# ullage

Your wine cellar, run by your AI agent — OpenClaw, Hermes, or any MCP client.

## What it does

- Chat with your agent to manage your cellar: add, list, update, consume (rating + notes), export.
- Share a wine **label or receipt photo** — your agent reads it and adds the wine(s). ullage runs
  no OCR; your agent's own vision does it.
- **Consumption history** — every bottle opened is logged with date, rating, and notes.
- **You own the data** — a local SQLite file (`~/.ullage/cellar.db`), export anytime. OSS, MIT.

## Install — tell your agent

Give OpenClaw / Hermes / any MCP client this one line:

> Check https://github.com/nukk-pain/ullage and install it.

The agent reads [docs/agent-install.md](docs/agent-install.md), installs the MCP server for your
runner (local SQLite — no token, no Docker), starts a fresh session, and then manages your cellar
per that runbook.

> **Agent reading this repo:** follow [docs/agent-install.md](docs/agent-install.md) to install
> and then operate the cellar. You need a shell with `git` and Node.js 20+.

Then just talk:
- *"Add a Barolo 2016."* — or share a **wine label photo**; it reads the label and adds the bottle.
- Share a **receipt photo** — it adds the wines (with price, purchase date, and store) and skips
  whisky, snacks, and other non-wine items.
- *"I drank the Chablis tonight — 2/5, too light."* — logged with your rating and note.
- *"What should I drink with fried chicken?"* — it recommends from your cellar.

## How it works

ullage is the **system of record** — a local wine cellar your agent reads and writes through MCP
tools. The intelligence (reading labels, pairing, "what should I drink") is your agent's own LLM
working over that data. No server, no token, no Docker — just a local SQLite file you own.

## License

MIT — see [LICENSE](LICENSE).
