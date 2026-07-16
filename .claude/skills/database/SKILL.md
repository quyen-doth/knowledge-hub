---
name: database
description: Design, query, migrate, or review the Knowledge Hub D1 database. Use for tables, columns, JSON codecs, article state transitions, atomic claims, indexes, settings, and migration work.
---

# D1 Database

## Required context

Read `AGENTS.md`, `docs/DATABASE.md`, applicable architecture sections, all existing migrations, query helpers, types, and tests before changing database behavior.

The current migration and executable tests are authoritative once they exist. Never infer a deployed schema from TypeScript alone.

## Process

1. State the data behavior and invariant being changed.
2. Trace every reader, writer, state transition, admin action, and scheduled job affected.
3. Decide whether the change needs a new migration, query/helper update, codec/schema update, and backfill.
4. Add the next numbered forward migration; never edit an applied migration.
5. Keep SQL parameterized and JSON parsing centralized behind validated codecs.
6. Test a fresh database, upgrade path, existing-data compatibility, and relevant concurrent/state behavior.
7. Update `docs/DATABASE.md` in the same change.

## State and concurrency rules

- Claim an article with a conditional `UPDATE` and process it only when `changes() = 1`.
- Never select work and later update it without a guard.
- Use `updated_at` as the phase-1 processing lease; stale recovery must increment retry state exactly once.
- Do not hold a D1 transaction while calling Anthropic, GitHub, LINE, AnkiFlow, or any network service.
- Preserve valid analysis and downstream checkpoints when resuming a partial failure.
- Treat external effects as at-least-once unless the destination proves idempotency.
- Apply the retry cap consistently; do not let `processing` rows remain stuck forever.

## Data rules

- `articles.url` is the ingestion deduplication key after validation/normalization.
- `summary_vi`, `tags`, `terms`, `sources.config`, and `runs.stats` are validated JSON TEXT.
- `settings` uses an allowlist and never stores secrets.
- Disable referenced sources instead of hard-deleting them.
- Use UTC at storage boundaries.
- Add indexes only for observed/planned query shapes and test the relevant query behavior.

## Migration safety

Remote migrations are external, potentially destructive operations and require explicit approval immediately before execution. Do not silently delete or rebuild production data. Fix a bad deployed migration with a new forward migration.

## Completion checklist

- [ ] Fresh migration and upgrade path are tested.
- [ ] Queries are parameterized and Worker/D1 compatible.
- [ ] JSON columns use shared schemas/codecs.
- [ ] Atomic claim, stale recovery, and retry cap remain correct.
- [ ] No transaction crosses a network boundary.
- [ ] Types, tests, and `docs/DATABASE.md` agree.
