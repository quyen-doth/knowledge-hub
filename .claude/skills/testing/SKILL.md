---
name: testing
description: Write, run, or review Knowledge Hub tests for Workers/Hono/D1, adapters, processor state, integrations, admin SSR, security, and deployment checks.
---

# Testing

## Source of truth

Read `docs/VERIFICATION.md` and the relevant API/database contracts before adding tests. Use existing scripts and layout once they exist; do not invent successful commands in a documentation-only repository.

## Test layers

### Unit

Use for pure behavior: URL normalization, retry classification, state transitions, zod schemas, slug/frontmatter escaping, feed parsing, LINE signatures, LLM tool parsing, and payload mapping.

### Worker integration

Use Vitest with `@cloudflare/vitest-pool-workers` for Hono routes, bindings, D1 migrations/queries, scheduled dispatch, atomic claims, stale recovery, and admin actions.

### Contract mocks

Mock `fetch` at the provider boundary and assert request shape plus error classification for Anthropic, GitHub, LINE, and AnkiFlow. Include 400/422/401/429/5xx and timeout cases as applicable.

### Admin E2E

Use local Wrangler/D1 with mocked external clients. Test auth/session tampering, same-origin protection, source Test-without-insert, pagination/filtering, retry actions, settings validation, and escaped rendering.

## Required failure scenarios

- Competing processor invocations claim one article only once.
- Stale `processing` recovery increments retry state once.
- Analysis saved but Obsidian incomplete.
- Obsidian complete but LINE incomplete.
- LINE sent but local checkpoint missing (known duplicate risk).
- LINE checkpoint complete but AnkiFlow incomplete.
- AnkiFlow timeout after server-side creation returns duplicate on retry.
- Selector empty three times becomes `SELECTOR_SUSPECT`.
- Prompt injection, malformed feed/HTML, invalid raw signature, hostile YAML/HTML values, and unsafe URLs are rejected/escaped.

## Fixtures and side effects

- Keep dated fixtures for Anthropic Research/News, RSS 2.0, Atom, empty and malformed inputs.
- Never store secret values or complete private articles in fixtures/snapshots.
- Automated tests never call real Anthropic, vault, LINE, AnkiFlow, remote D1, or production Worker endpoints.
- Playwright MCP is exploratory agent tooling, not the CI E2E runner.

## Workflow

1. Reproduce the target behavior with the smallest test.
2. Confirm the test fails for the intended reason when fixing a bug.
3. Run the narrow test, related suite, then full `bun run verify` when available.
4. Report exact commands, test counts/results, and anything not run.

Never weaken an assertion or replace a deterministic fixture with a live call merely to get a pass.
