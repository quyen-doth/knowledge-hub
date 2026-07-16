---
name: api
description: Create or modify Knowledge Hub HTTP routes, webhooks, admin form actions, or external API clients. Use for Hono routing, authentication, validation, response contracts, and integration error handling.
---

# API Development

## Required context

Read, in order:

1. `AGENTS.md`
2. `docs/API.md`
3. The relevant section of `docs/ARCHITECTURE.md`
4. Existing routes, schemas, services, types, and tests once they exist

Executable code and tests override planned documentation. If they differ, report the mismatch and update the appropriate source in the same change.

## Process

1. Identify the route/client, caller, trust boundary, auth mechanism, and external side effects.
2. Trace similar code before introducing a helper or response shape.
3. Define or reuse a zod schema at the inbound/outbound boundary.
4. Keep the Hono handler thin: parse/authenticate, call a service, map the typed result to a response.
5. Put database logic in query helpers and provider logic in its dedicated client.
6. Classify errors as retryable, non-retryable, or configuration failures.
7. Add focused tests for success, invalid input, auth failure, duplicate/idempotent behavior, timeout, and partial failure.
8. Update `docs/API.md` when the route, payload, auth, status, or retry contract changes.

## Project rules

- Use Cloudflare-compatible `Request`, `Response`, `fetch`, Web Crypto, and AbortSignal APIs.
- Do not add Node HTTP/filesystem assumptions to Worker runtime code.
- Do not invent a response envelope without updating `docs/API.md` and locking it with tests.
- Validate URLs and reject non-HTTP(S) schemes or embedded credentials.
- Compare static tokens safely in constant time, including unequal-length input.
- Redact secrets, signatures, cookies, article bodies, and third-party payloads from logs.
- Every outbound request needs a timeout and typed error classification.

## Auth matrix

| Surface | Required mechanism |
| --- | --- |
| `POST /line/webhook` | HMAC-SHA256 over the exact raw body before JSON parsing |
| `POST /api/ingest` | `x-ingest-token` |
| `GET /ingest` | Phase-1 query token; never reuse this pattern elsewhere |
| `/admin/*` | HMAC-signed session cookie plus same-origin/CSRF defense for mutations |
| AnkiFlow client | `x-integration-token` |

## Critical integration behavior

- LINE irrelevant events return 200 without side effects.
- Duplicate ingestion is idempotent and must not create a second article.
- AnkiFlow 400 and 422 are non-retryable validation failures; 401 is configuration failure; 429, timeout, and 5xx are retryable.
- Knowledge Hub submits term drafts only and never triggers a second enrichment pass.
- Real LINE, GitHub vault, Anthropic, or AnkiFlow writes require explicit scope/authorization and never run in automated tests.

## Completion checklist

- [ ] Applicable docs and existing code were read.
- [ ] Input/output schemas and auth are explicit.
- [ ] Handler delegates business/database/provider work.
- [ ] Retry and idempotency behavior are tested.
- [ ] Worker compatibility and secret redaction were reviewed.
- [ ] `docs/API.md` is synchronized.
