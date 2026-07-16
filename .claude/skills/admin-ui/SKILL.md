---
name: admin-ui
description: Build or modify the Knowledge Hub Hono JSX server-rendered admin interface, including login/session handling, forms, sources, articles, settings, and dashboard behavior.
---

# Admin UI

## Architecture

The admin is Hono JSX server-side rendering with one static CSS file. Do not introduce a frontend SPA framework, client-side state architecture, React hydration, or duplicate business logic in views.

Read `AGENTS.md`, admin sections of `docs/ARCHITECTURE.md`, `docs/API.md`, `docs/DATABASE.md`, and `docs/VERIFICATION.md` before implementation.

## Security baseline

- Authenticate with `ADMIN_PASSWORD` and issue an HMAC-signed session using `SESSION_SECRET`.
- Production cookie is `httpOnly`, `secure`, and `sameSite`; it never contains the password.
- Verify signature/expiry and reject tampered sessions safely.
- Protect every state-changing form with a documented same-origin/CSRF defense.
- Escape untrusted source names, titles, URLs, summaries, tags, terms, errors, and Obsidian paths in HTML.
- Never render secret values. Bookmarklet output must avoid committing/logging the ingest token.

## Screens

### Dashboard

Show seven-day article count, terms pushed, latest run, and latest failed article/run using query helpers.

### Sources

- CRUD validated fields and adapter-specific JSON config.
- `Test` runs discovery and shows at most five items without insertion.
- `Check now` calls the same watcher service used by scheduled execution.
- Disable referenced sources instead of hard-deleting them.

### Articles

- Paginated/filterable list with escaped links/status.
- Detail shows analysis, terms, error, and Obsidian link/path.
- Retry only valid failed states; reset retry metadata while preserving completed checkpoints for resume.

### Settings

Use an allowlist for `llm_model`, `notify_mode`, `max_terms_per_article`, and `backfill_limit`. Do not provide arbitrary settings or secret editing.

## Implementation rules

- Views call services/query helpers; no raw SQL or provider calls in JSX.
- Use Post/Redirect/Get for successful form submissions where appropriate.
- Validate both route params/query strings and form bodies.
- Return clear Vietnamese errors without exposing stack traces or external payloads.
- Keep layout accessible: semantic labels, keyboard operation, visible focus, status text beyond color, and explicit confirmation for destructive-looking actions.

## Verification

Test login failure/success, cookie tampering/expiry/flags, unauthenticated redirects, origin/CSRF rejection, escaped hostile data, source Test-without-insert, pagination/filtering, retry behavior, settings allowlist, and missing/invalid data states.
