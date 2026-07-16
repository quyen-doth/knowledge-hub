---
name: deploy
description: Prepare, validate, deploy, or operate Knowledge Hub on Cloudflare Workers and D1. Use for Wrangler dry-runs, migrations, secrets, cron configuration, production deploys, and rollback planning.
---

# Deployment

## Safety boundary

Local verification and `wrangler deploy --dry-run` are non-production checks. Production deploys, remote D1 migrations, secret changes, real external smoke tests, and rollbacks require explicit user approval immediately before execution.

## Pre-deploy review

1. Read `AGENTS.md`, `README.md`, `docs/REFERENCE.md`, `docs/DATABASE.md`, and `docs/VERIFICATION.md`.
2. Inspect repository status and the exact diff/commits being deployed.
3. Identify migration, binding, cron, route, auth, and external contract changes.
4. Confirm the intended Cloudflare environment/account/database without printing credentials.
5. Verify that rollback/forward-fix options and data compatibility are understood.

## Required checks

Run project scripts when they exist and report exact results:

```text
bun run typecheck
bun run test
bun run verify
bun run deploy:check
```

Also verify:

- Wrangler config parses and Worker bundle is Cloudflare-compatible.
- D1 migrations pass on a fresh local database and upgrade fixture.
- Cron expressions map to watcher, processor, and optional digest correctly.
- Required bindings exist for the selected environment; secret values remain unread.
- Automated tests mock Anthropic, GitHub, LINE, and AnkiFlow.

If a script or scaffold does not exist, stop and report the missing prerequisite. Do not substitute a successful narrative.

## Execution order

After explicit approval for the exact environment:

1. Apply remote migration only if the release requires it and compatibility is safe.
2. Update required secrets only when explicitly included in scope.
3. Deploy the Worker.
4. Check deployment status/logs without exposing sensitive payloads.
5. Run only the approved smoke tests; use test destinations where possible.

Do not deploy first and “see whether migrations work.” Do not automatically rollback a data migration; prefer a reviewed forward fix when rollback could lose data.

## Report

Include environment, deployed version/URL if available, migrations applied, commands and results, smoke tests, known risks, and any intentionally skipped external action.
