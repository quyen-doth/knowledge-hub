---
name: review-code
description: Review Knowledge Hub code or diffs for correctness, security, Workers compatibility, D1 state safety, integration idempotency, testing gaps, and documentation drift.
---

# Code Review

## Collect evidence

1. Read `AGENTS.md` and the applicable API/database/verification docs.
2. Inspect the exact diff. For a feature branch use `git diff main...HEAD`; for an uninitialized or dirty repository inspect the requested files/working changes directly.
3. Trace changed callers, types, migrations, routes, scheduled handlers, and tests. Do not review a patch in isolation when state or external effects are involved.

## Review priorities

### 1. Data loss and duplicate effects

- Unguarded D1 claim, stuck `processing` row, incorrect retry cap, or invalid state transition.
- Transaction held across network calls.
- Checkpoint written before a step actually succeeds.
- GitHub/LINE/AnkiFlow side effect repeated without documented at-least-once behavior or destination idempotency.
- Migration that drops/reinterprets existing data without a safe forward path.

### 2. Security and privacy

- Secret/token/session/signature in code, logs, HTML, fixture, snapshot, or D1 settings.
- LINE signature verified after parsing instead of on the exact raw body.
- Missing constant-time compare, URL validation, timeout/body/redirect limits, or admin same-origin defense.
- Prompt injection from fetched content or unescaped HTML/YAML/LINE output.
- Over-broad GitHub token or unsafe bookmarklet token handling.

### 3. Contract and runtime correctness

- Node-only APIs in Worker runtime.
- Hono route, zod schema, response status, binding, or external payload inconsistent with docs/tests.
- Treating AnkiFlow 400/422 incorrectly or running a second enrichment pass.
- Adapter processing article bodies instead of only discovering items.
- Business/SQL/provider logic embedded in JSX or route handlers.

### 4. Tests and maintainability

- Missing concurrency, stale recovery, partial-failure, auth, malformed-input, or retry tests.
- Automated tests calling real external systems.
- Live selector check without a deterministic dated fixture.
- Duplicate abstractions, unnecessary phase-2 scope, or docs claiming unimplemented behavior.

## Output

Write the review in Vietnamese. Findings come first, ordered by severity, each with:

- Severity
- Concrete file and line
- Observed behavior and evidence
- Impact/failure scenario
- Specific remediation

Then list questions/assumptions and a short residual-risk summary. If there are no findings, say so explicitly and still name untested areas.

Do not post a review to GitHub or modify code unless the user explicitly asks for that action.
