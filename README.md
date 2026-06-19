# ullage

Your wine cellar, run by your AI agent — OpenClaw, Hermes, or any MCP client.

## What it does

- Chat with your agent to manage your cellar: add, list, update, consume (rating + notes), export.
- Share a wine **label or receipt photo** — your agent reads it and adds the wine(s). ullage runs
  no OCR; your agent's own vision does it.
- **Consumption history** — every bottle opened is logged with date, rating, and notes.
- **You own the data** — a local SQLite file (`~/.ullage/cellar.db`), export anytime. OSS, MIT.

## Install — give your agent this prompt

Paste this to OpenClaw / Hermes / your MCP client. The agent fetches the repo, reads the runbook,
and sets ullage up itself:

```text
Set up ullage as my wine cellar and then manage it for me.

1. Fetch https://github.com/nukk-pain/ullage and read docs/agent-install.md.
2. Follow that runbook: build the MCP server and register it with yourself (Hermes / OpenClaw /
   MCP client), then start a fresh session so the tools load.
3. After that, whenever I talk about wine:
   - Add bottles I mention — capture name, producer, and vintage (year in the vintage field),
     plus region/varietal/drink-by when known.
   - If I share a wine label or receipt photo, read it yourself and add the wine(s). For a
     receipt, add only the wine bottles and skip whisky, beer, soju, snacks, and non-wine items.
   - Let me list the cellar, update wines, consume bottles (with rating + notes), see consumption
     history, and export everything.
   Always check the cellar summary first so you work from the current state.
```

Then just talk: *"add a Barolo 2016"*, *"what's in my cellar?"*, *"I opened the Chablis — 4.5/5"*,
or share a photo.

(Install details: [docs/agent-install.md](docs/agent-install.md).)

## How it works

ullage is the **system of record** — a local wine cellar your agent reads and writes through MCP
tools. The intelligence (reading labels, pairing, "what should I drink") is your agent's own LLM
working over that data. No server, no token, no Docker — just a local SQLite file you own.

## License

MIT — see [LICENSE](LICENSE).
