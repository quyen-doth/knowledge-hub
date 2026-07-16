# AGENTS.md

This file provides durable guidance to Codex and other AI coding agents working in this repository.

## Project Overview

**Knowledge Hub** is a single-user, headless knowledge-ingestion pipeline with a minimal admin UI. It discovers new web articles, extracts readable text, produces Vietnamese analysis with Anthropic, writes Markdown into an Obsidian vault through GitHub, sends notifications through LINE, and submits technical-term drafts to AnkiFlow.

The runtime is **Cloudflare Workers** with **Hono** and **D1**. Scheduled jobs are coordinated through article state in D1; Cloudflare Queues are explicitly out of scope for phase 1.

Main flow:

`Watcher / LINE / bookmarklet -> articles(status=new) -> processor -> extract -> LLM -> Obsidian -> LINE -> AnkiFlow -> processed`

Git, the application foundation, and the watcher are implemented. The repository has a Workers/Hono entry point, Bun package manifest and lockfile, numbered D1 migrations, admin-session scaffold, RSS/Atom and HTML-list adapters, watcher orchestration, dated Anthropic fixtures, and Worker integration tests. The browser adapter is intentionally a placeholder. The processor, external integrations, ingest routes, and complete admin UI remain unimplemented until their corresponding phases are verified. Do not describe later planned modules as existing.

## Sources of Truth

Use sources in this order:

1. Executable code, migrations, types, and tests once they exist.
2. `docs/ARCHITECTURE.md` for accepted product and technical decisions.
3. `docs/prompt.md` for original context only.

`docs/prompt.md` ends in the middle of the LINE section, so it is not a complete implementation specification. When it conflicts with `docs/ARCHITECTURE.md`, follow the architecture document and report the discrepancy.

The AnkiFlow work packages in `docs/ARCHITECTURE.md` describe a point-in-time prerequisite plan. AnkiFlow may already contain FSRS, the term-drafts endpoint, or the SRS cron. Inspect the current AnkiFlow code and contract before proposing work there. Never reimplement an already-shipped work package from the architecture document without verification.

Do not modify the AnkiFlow repository as part of a Knowledge Hub task unless the user explicitly includes that repository in scope.

## Documentation Map

- `README.md` is the entry point for project status, intended setup, operations, and known limits.
- `docs/ARCHITECTURE.md` records accepted phase-1 product and technical decisions.
- `docs/prompt.md` preserves the original request and is historical, incomplete input.
- `docs/REFERENCE.md` is the concise operational and architecture reference.
- `docs/CONTRIBUTING.md` defines the Git and contribution workflow.
- `docs/VERIFICATION.md` defines verification layers, scenarios, and evidence requirements.
- `docs/API.md` distinguishes implemented HTTP/scheduled surfaces from planned contracts; `docs/DATABASE.md` describes the executable D1 migrations and state rules.

Keep each fact in the narrowest authoritative document. Link to it instead of copying large contract or schema sections across multiple files.

## Language Policy

| Audience | Files or output | Language |
| --- | --- | --- |
| AI agents | `AGENTS.md`, `.claude/`, `.codex/`, skills, hooks, prompts, config | English |
| Project documentation | `docs/`, architecture notes, runbooks | Vietnamese |
| User | Chat responses and plan content | Vietnamese |
| Runtime code | Identifiers, type names, code comments, logs | English |
| Hub owner | Admin UI, LINE messages, Obsidian summaries | Vietnamese unless a fixed external contract requires otherwise |

Preserve literal external field names and response strings required by an API contract.

## Stack and Commands

- Cloudflare Workers, Hono, TypeScript strict mode
- D1 / SQLite with SQL migrations and typed query helpers; no ORM
- Bun for package management and local scripts
- Wrangler for local development, migrations, cron simulation, and deployment
- Vitest with `@cloudflare/vitest-pool-workers`
- Hono JSX server-side rendering for the admin UI; no SPA framework

Run commands from the repository root and prefer scripts declared in `package.json`. Stable Bun scripts exist for development, type checking, tests, and build/deploy checks. Report only commands actually run and their exact results. Use Bun, not npm or pnpm.

Production deploys, remote D1 migrations, and secret updates require explicit user approval immediately before execution.

## Architecture Boundaries

Keep these modules independent:

- **Watcher adapters** discover URLs and metadata only. Each adapter implements `SourceAdapter` and must not process articles.
- **Processor** owns the article state machine and orchestration. External clients must not update article status independently.
- **Extractor** converts fetched HTML into normalized article content. It must not call the LLM or write downstream artifacts.
- **LLM layer** exposes `LLMProvider`; callers must not depend on Anthropic-specific response blocks.
- **Obsidian, LINE, and AnkiFlow clients** own one external integration each and return explicit, typed results.
- **Admin routes** call the same services and query helpers as scheduled handlers; do not duplicate business logic in JSX files.
- **D1 helpers** use parameterized SQL and centralize JSON serialization/deserialization. Do not scatter raw parsing of `summary_vi`, `tags`, `terms`, or source `config`.

Use Cloudflare-compatible Web APIs in runtime code. Do not add Node-only libraries or filesystem assumptions without confirming Workers compatibility and bundle impact.

## Critical Data and State Rules

- `articles.url` is the ingestion deduplication key. Normalize and validate URLs before insert, but do not silently merge distinct canonical URLs without an explicit rule.
- Claim work atomically. Selecting rows and later setting `status='processing'` in separate unguarded operations can let overlapping cron invocations process the same article.
- A `processing` row needs a documented recovery/lease strategy. Never leave crashes permanently stuck without a way to reclaim work.
- Do not hold a D1 transaction open across network calls.
- Persist state only after validating the full output for that step. Partial JSON must never be treated as completed analysis.
- Preserve retry classification: timeout, network failure, HTTP 429, and 5xx are retryable; invalid input, extraction logic errors, auth failures, and other 4xx errors are not. Cap retries as defined by the architecture.
- Use ISO-8601 UTC timestamps at system boundaries. Convert time zones only for display or explicitly scheduled local behavior.
- Apply D1 schema changes through numbered migrations. Never mutate a deployed schema manually or edit an applied migration.

The architecture calls processor steps idempotent, but flags alone do not guarantee exactly-once external effects. In particular, a process can send LINE successfully and crash before recording `line_notified_at`. Treat integrations as at-least-once unless the destination or an idempotency key proves otherwise. Do not claim stronger guarantees in code or docs.

## External Integration Rules

Every outbound request must have a timeout, bounded response size where applicable, and an error type that preserves retryability. Do not log tokens, signatures, session cookies, article bodies, or complete third-party error payloads that may contain secrets.

### Anthropic

- Use plain `fetch`, not the Anthropic SDK, unless the architecture is deliberately revised.
- Force the `submit_analysis` tool and validate its input again with zod.
- Treat fetched article text as untrusted data. The system prompt must explicitly ignore instructions embedded in an article, page metadata, or quoted content.
- Truncate only after extraction and before the provider call; record enough context to diagnose truncation without logging the article body.

### GitHub / Obsidian

- Escape YAML frontmatter values derived from titles, authors, tags, URLs, or source names. Untrusted values must not break the Markdown structure.
- Keep path generation deterministic and bounded. Resolve collisions without overwriting an unrelated note.
- Use the GitHub Contents API SHA flow for retries. A retry must update the intended note or safely choose a new collision suffix; it must not create uncontrolled duplicates.
- Real writes to the user's vault require explicit authorization unless the active request already clearly asks for that write.

### LINE

- Verify the webhook signature against the exact raw request body before parsing JSON.
- Use constant-time comparison for signatures and tokens.
- Acknowledge irrelevant event types with HTTP 200 and no side effect.
- Redact bookmarklet and ingest tokens from logs. The phase-1 query-token tradeoff is documented; do not broaden its use.
- Sending a real reply, push, or digest is an external side effect and requires explicit authorization unless it is the stated task.

### AnkiFlow

The current integration boundary is:

```text
POST {ANKIFLOW_API_URL}/api/integrations/term-drafts
x-integration-token: <token>
content-type: application/json
```

The body has `source: 'knowledge-hub'` and `items` containing `term`, `language`, optional Vietnamese definition/context, and source URL/title. Keep batches within 1..20 items. Knowledge Hub phase 1 emits English or Japanese terms; do not silently broaden the LLM schema without a product decision.

Handle both HTTP 400 and 422 as non-retryable contract/validation failures because the architecture and the current AnkiFlow implementation use different validation statuses. Treat 401 as a configuration failure and timeouts/5xx as retryable. A successful response contains `created` entry IDs and `skipped` items.

The Hub submits drafts only. It must not call AnkiFlow's enrichment flow or perform a second enrichment pass.

## Security and Privacy

- Never read, print, commit, or transmit actual `.env` files or secret bindings. A placeholder-only `.env.example` may be read when needed for configuration work.
- Validate configuration with zod and distinguish required core bindings from feature-specific integrations so one disabled integration does not fail unrelated routes without an explicit design choice.
- Accept only `http:` and `https:` ingestion URLs. Reject credentials in URLs and apply timeouts, redirect limits, and size limits to fetched content.
- Parameterize all SQL. Validate JSON config before using CSS selectors, paths, counts, or modes.
- Admin authentication must use an HMAC-signed, `httpOnly`, `secure`, `sameSite` cookie in production. State-changing form routes need CSRF protection or a documented same-origin defense.
- Compare static tokens in constant time after handling unequal lengths safely.
- Keep secrets in Wrangler secret storage. Never place them in D1 settings, client-rendered HTML, bookmarklet examples with real values, fixtures, or test snapshots.
- Treat source pages, RSS fields, webhook messages, and integration responses as hostile input. Escape output according to its destination: HTML, Markdown/YAML, SQL, JSON, or LINE text.

## Code Conventions

- TypeScript strict mode; do not use `any`. Narrow `unknown` at boundaries.
- Use `interface` for stable object shapes and `type` for unions or mapped/composed types.
- Keep zod schemas adjacent to the boundary they validate and infer types when that avoids duplicate definitions.
- Use named exports for reusable modules and components.
- Keep files focused; avoid provider logic inside routes and SQL inside JSX views.
- Use dependency injection for external clients and clocks so processor behavior is testable.
- Return structured domain errors instead of matching arbitrary error-message substrings in the processor.
- Keep comments focused on non-obvious invariants and failure modes, not restating the code.
- Do not add Cloudflare Queues, an ORM, a frontend SPA framework, a browser adapter implementation, RAG, embeddings, or other phase-2 features unless explicitly requested.

## Testing Expectations

- Unit-test URL normalization, slug/frontmatter escaping, retry classification, state transitions, zod schemas, and adapter parsing.
- Test RSS 2.0 and Atom separately, including malformed and empty feeds.
- Validate Anthropic Research and News selectors against live HTML when implementing them, then store dated fixtures and run deterministic tests against the fixtures.
- Test concurrent claims so one article cannot be processed by two scheduled invocations.
- Test recovery from a stale `processing` state and the retry cap.
- Test every partial-failure boundary: analysis saved but Obsidian pending, Obsidian written but LINE pending, LINE sent but AnkiFlow pending, and each downstream retry.
- Mock Anthropic, GitHub, LINE, and AnkiFlow in automated tests. Never send real messages, write vault files, or create term drafts from a test suite.
- Test webhook signatures with the raw body, invalid signatures, irrelevant events, duplicate URLs, and bodies containing no URL.
- For admin UI changes, verify authentication, source Test-without-insert behavior, CRUD validation, pagination/filtering, retry actions, and escaped rendering.

Run the narrowest relevant tests first, then the full suite. Report commands and results exactly; never claim tests passed if the scaffold or command does not exist.

## Documentation and Review

- Editing files under `docs/` requires user approval in the active request. PreToolUse guards enforce this (`scripts/agent-hooks/docs-guard.mjs`): Claude Code prompts for approval; Codex is blocked and must ask in chat before retrying.
- Keep `docs/ARCHITECTURE.md` synchronized with deliberate architecture or contract changes.
- Treat `docs/prompt.md` as historical input; do not expand it into a second competing specification.
- Do not rewrite product decisions or phase boundaries as an incidental code change. Surface the proposed decision and its consequences first.
- Review findings in Vietnamese, ordered by severity, with a concrete file/line reference and remediation.
- During review, prioritize data loss, duplicate side effects, auth bypass, cross-boundary secret exposure, stuck jobs, and contract mismatches over style issues.

## Mandatory Workflow for Changes

1. **Read and trace**: inspect the current implementation, applicable docs, types, migrations, and tests before planning a change.
2. **Plan when non-trivial**: state the intended behavior, affected boundaries, migrations, failure modes, and verification.
3. **Confirm guarded actions**: ask immediately before production deploys, remote migrations, real external writes/messages, secret changes, destructive data operations, or scope expansion into another repository.
4. **Implement narrowly**: preserve unrelated user changes and avoid opportunistic refactors.
5. **Self-review**: inspect the full diff for scope, security, Workers compatibility, idempotency claims, and missing tests.
6. **Verify**: run targeted checks and the full applicable suite. If verification is impossible, state why and what remains unverified.
7. **Document**: update the architecture or runbook when the requested behavior changes them; do not create stale duplicate documentation.
8. **Report**: summarize changed files, behavior, test results, limitations, and any external action that was intentionally not performed.

Ordinary edits explicitly requested by the user do not need a second approval. Approval is required for the guarded side effects above and whenever the requested scope materially changes.
