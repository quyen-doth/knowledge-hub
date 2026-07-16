---
name: debug
description: Diagnose Knowledge Hub failures in Workers, Hono routes, D1 state, scheduled jobs, adapters, LLM parsing, external clients, or tests. Use when behavior is incorrect or verification fails.
---

# Debugging

## Method

1. Reproduce the smallest failing case and record the exact command/request, input class, expected behavior, actual behavior, and relevant state.
2. Classify the failure before editing: configuration, Worker runtime, route/auth, D1/query/state, extraction/adapter, provider contract, rendering, or test harness.
3. Trace the failing boundary from caller to persisted/external effect. Inspect structured errors and redacted state; do not dump secrets or complete article bodies.
4. Form one testable root-cause hypothesis. Add or tighten a regression test that fails for the right reason.
5. Apply the narrowest fix without opportunistic refactoring.
6. Run the regression test, related suite, then full applicable verification.
7. Report root cause, fix, evidence, and any remaining uncertainty.

## Project-specific checks

### Scheduled/processor failures

- Did the invocation win the atomic claim?
- Is `updated_at` being refreshed at each checkpoint?
- Is retry classification correct and below the cap?
- Which of analysis, Obsidian, LINE, and AnkiFlow checkpoints already exists?
- Could a crash after an external success cause a duplicate effect?

### Adapter/extraction failures

- Compare live DOM only when authorized/network is available, then reproduce with a dated local fixture.
- Distinguish `SELECTOR_SUSPECT`, HTTP blocking, malformed feed, canonical redirect, and `EXTRACT_TOO_SHORT`.
- Do not implement the phase-2 browser adapter as a shortcut.

### API/auth failures

- Verify raw-body handling for LINE before JSON parsing.
- Check constant-time token comparison and missing binding behavior.
- Confirm Hono middleware and route-specific auth are not being confused.

### External client failures

- Preserve HTTP status, timeout, provider error class, and retryability without logging credentials.
- Mock the exact failure in tests; do not use a real LINE message, vault write, Anthropic call, or AnkiFlow draft as a debugging shortcut.

## Hard rules

- Do not weaken validation, auth, tests, or retry limits to make a failure disappear.
- Do not reset/delete D1 data without explicit authorization.
- Do not claim a root cause until the evidence distinguishes it from plausible alternatives.
- Update API/database/verification docs if the diagnosed behavior changes a contract.
