---
description: Commit the requested changes using the Knowledge Hub Git conventions
---

Commit the current task following `AGENTS.md` and `docs/CONTRIBUTING.md`.

1. Confirm this directory is a Git repository. If it is not, stop and report that Git has not been initialized; do not run `git init` unless the user explicitly asks.
2. Run `git status`, inspect the full unstaged and staged diff, and identify unrelated user changes.
3. If the current branch is `main`, stop before committing and offer to create an appropriately prefixed feature branch. Do not switch branches with a dirty working tree without explaining the impact.
4. Run the narrowest applicable verification. If the scaffold or script does not exist, report that fact instead of inventing a pass.
5. Group changes by intent. Stage explicit relevant paths; never use `git add -A` when unrelated changes are present.
6. Use Conventional Commits: English type/scope and a Vietnamese subject, normally no longer than 72 characters.
7. Never add AI attribution, `Co-Authored-By`, or “Generated with” footers.
8. Report each commit hash, message, included scope, and verification result.

Example:

```text
docs(api): mô tả contract ingest và AnkiFlow
```

Additional user arguments: `$ARGUMENTS`
