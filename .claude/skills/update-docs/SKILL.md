---
name: update-docs
description: Create or update Knowledge Hub documentation after implementation, contract, architecture, workflow, or operational changes. Use to keep README and docs synchronized without duplicating sources of truth.
---

# Documentation Updates

## Language and authority

- Project documentation (`README.md`, `docs/`) is written in Vietnamese.
- Agent/config/skills/commands are written in English.
- Preserve literal external field names, error codes, commands, and API payloads.
- Executable code, migrations, types, and tests override stale documentation.
- `docs/ARCHITECTURE.md` records accepted decisions; `docs/prompt.md` is incomplete historical input and is not a living specification.

## Document map

| Change | Primary document |
| --- | --- |
| Project status, setup, env, runbook | `README.md` |
| Architecture decision or phase boundary | `docs/ARCHITECTURE.md` |
| Operational/architecture quick reference | `docs/REFERENCE.md` |
| HTTP/auth/payload/status/retry contract | `docs/API.md` |
| D1 table/column/enum/state/migration | `docs/DATABASE.md` |
| Git and contribution workflow | `docs/CONTRIBUTING.md` |
| Verification layer/scenario/evidence | `docs/VERIFICATION.md` |
| Durable agent behavior | `AGENTS.md`, `.claude/`, `.codex/` |

Keep the detailed fact in one authoritative document and link from summaries. Do not copy the full schema or payload into every file.

## Process

1. Read the changed implementation, tests, current docs, and source decision.
2. Identify current-state facts versus planned behavior.
3. Update the narrowest authoritative document and any summary/link that would otherwise become misleading.
4. Preserve headings/anchors when practical and remove obsolete instructions rather than appending contradictions.
5. Check local links, code fences, language policy, commands, paths, and terminology.
6. Report what changed and any unresolved mismatch.

Routine documentation synchronized with an explicitly requested implementation does not require a second approval. Ask for a decision only when updating docs would create/change product behavior, architecture, public contract, destructive migration policy, or phase scope.

## Hard rules

- Do not claim planned commands, routes, migrations, tests, CI, or deployment are implemented.
- Do not add dates/status claims without evidence.
- Do not place secrets, personal absolute paths, real tokens, or production bookmarklets in docs.
- Do not rewrite `docs/prompt.md` to make it appear complete.
- Do not retain copied AnkiFlow assumptions unless they describe the intentional integration boundary.
