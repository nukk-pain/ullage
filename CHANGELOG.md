# Changelog

All notable changes to ullage are documented here. This project follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## 2026-10-18

### Added

- Persistent schema migration for legacy cellar databases, including duplicate active-hold cleanup, one-time tasting image URL backfill, and idempotency metadata columns.
- Validation for explicit null or empty quantities, real calendar dates, and safe integer fields.

### Changed

- Foreign-currency prices on `add_wine` and wine import tools are converted to the configured home currency using the purchase date when available.
- SQLite schema initialization is serialized for concurrent processes, and consume retries preserve already-recorded progress.
- HTTP adapter idempotency keys are sent as deterministic `Idempotency-Key` headers while the original keys remain available for local replay checks. The HTTP tools transport returns `409` for partial consumption and `501` for operations unsupported by its backend.
- HTTP wine creation sends `varietal` and `grape_variety` with the same value for server compatibility and sends `vintage` as a number.

## 2026-10-17

### Changed

- The former OpenClaw-specific storage backend was replaced by the generic HTTP backend. Set `ULLAGE_BACKEND=http` and configure `ULLAGE_HTTP_BASE_URL`; the old `openclaw` backend name is no longer accepted. **Breaking change.**
- Public Git history was rewritten. Checkouts created before that rewrite may not be able to fast-forward and may need a clean reset to `origin/main` after their local work is reviewed.
- README and installation guidance now direct agents to install from a Git checkout because the npm package is not published.
- Built-in historical exchange-rate lookup through Frankfurter's ECB provider. Setting `ULLAGE_HOME_CURRENCY` is enough to enable it; `ULLAGE_FX_RATE_URL` remains an optional custom-provider override. The `get_exchange_rate` tool reports the provider's observation date and source.

### Added

- A documented migration path for unsupported HTTP backend operations and idempotent retries.

### Fixed

- Explicit `null` and empty-string quantities are rejected rather than treated as an omitted quantity. **Breaking change.** Omit `quantity` to use the default of one.
- Partial consume retries and date/integer validation now preserve cellar state and reject invalid input consistently.
