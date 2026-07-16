---
name: git-workflow
description: Apply the Knowledge Hub Git workflow for branches, Conventional Commits, pull requests, and history review. Use when creating a branch, committing, pushing, or preparing a PR.
---

# Git Workflow

## Source of truth

Follow `docs/CONTRIBUTING.md`. Git is initialized, but inspect the current branch, remote, CI, hooks, and branch protection instead of assuming how they are configured.

## Branches

- `main` is the stable base and PR target.
- Do not commit or push directly to `main`.
- Create short-lived branches with an English kebab-case slug: `feat/`, `fix/`, `docs/`, `refactor/`, `test/`, or `chore/`.
- If a remote exists, update `main` with `git pull --ff-only` before branching, but never pull/switch over a dirty working tree without reviewing the impact.
- Preserve unrelated user changes and do not rewrite shared history without explicit authorization.

## Commits

Use Conventional Commits:

```text
<english-type>(<english-scope>)?: <Vietnamese subject>
```

Examples:

```text
feat(watcher): thêm adapter RSS và Atom
fix(processor): ngăn hai cron xử lý cùng một article
docs(api): mô tả contract term draft
```

- Keep the subject concise, normally at most 72 characters.
- Explain the reason in a Vietnamese body when needed.
- Stage explicit files and split unrelated intents.
- Never add AI attribution, `Co-Authored-By`, or generated-by footers.

## Pull requests

- Base: `main`.
- Title: same Conventional Commit style with Vietnamese subject.
- Body language: Vietnamese.
- Required sections: Tóm tắt, Thay đổi, Kiểm chứng, Rủi ro và giới hạn, Checklist.
- Review `git log main..HEAD` and `git diff main...HEAD` before publishing.

## Authorization

Do not initialize Git, commit, push, open a PR, force-push, tag, or modify a remote unless the active user request includes that action. Invoking `/commit` or `/pr` is explicit authorization for that command's documented scope.

If a hook blocks an action, read the reason and fix the underlying issue. Never bypass hooks or branch protections just to complete the workflow.
