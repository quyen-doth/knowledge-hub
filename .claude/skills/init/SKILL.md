---
name: init
description: Initialize the Knowledge Hub application scaffold or a new feature/module within it. Use for Workers/Hono setup, routes, adapters, integrations, admin screens, migrations, and test structure.
---

# Initialize Scaffold or Feature

## Required context

Read `AGENTS.md`, `docs/ARCHITECTURE.md`, `docs/REFERENCE.md`, and the relevant API/database/verification docs. Inspect the current tree first: this repository may still be documentation-only, so never assume `package.json`, `src/`, migrations, or tests exist.

## Decide the initialization level

- **Repository scaffold**: create the phase-1 Workers/Hono/D1 structure and stable Bun scripts defined in the docs.
- **HTTP route/client**: follow the `api` skill and reuse services/schemas.
- **D1 table/query/migration**: follow the `database` skill.
- **Watcher adapter**: implement only URL/metadata discovery behind `SourceAdapter`.
- **Processor/integration**: follow the `pipeline` skill.
- **Admin screen/action**: follow the `admin-ui` skill.

Do not create a full repository scaffold when the request is for one narrow feature.

## Scaffold rules

- Cloudflare Workers + Hono + TypeScript strict mode.
- Bun scripts for dev, typecheck, test, verify, and deploy dry-run.
- Wrangler bindings/cron configuration with placeholder names only; no real secrets.
- D1 migrations and typed parameterized query helpers; no ORM.
- Vitest with Workers pool and fixture directories.
- Hono JSX SSR and static CSS; no frontend SPA scaffold.
- `browser` adapter exists only as an explicit phase-2 placeholder.

## Feature layout principles

- Keep route/JSX, domain service, database helper, provider client, schema/type, and tests separate.
- Follow existing naming/layout once code exists; do not duplicate a parallel architecture from the document tree.
- Reuse shared URL, auth, error, JSON codec, and external-client helpers.
- Add minimal boilerplate that compiles; do not prebuild unused phase-2 abstractions.

## Completion

1. Verify every created path is needed by the requested scope.
2. Run the narrowest available check, then full applicable verification.
3. Update docs only for actual new behavior; label planned pieces honestly.
4. Report created files, commands/results, TODOs, and external actions not performed.

Never initialize Git, install dependencies over the network, deploy, migrate remotely, or set secrets unless those actions are explicitly in scope.
