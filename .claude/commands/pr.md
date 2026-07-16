---
description: Open a pull request against main using the Knowledge Hub conventions
---

Open a pull request following `AGENTS.md` and `docs/CONTRIBUTING.md`.

1. Confirm this is a Git repository and the current branch is not `main`.
2. Inspect `git status`, `git log main..HEAD`, and `git diff main...HEAD`. Stop if required changes are uncommitted or the branch has no commits.
3. Run the applicable verification and record exact results. Never claim unavailable commands passed.
4. Push the current feature branch if needed. Invoking this command counts as a request to publish the branch and open the PR, but do not perform unrelated remote changes.
5. Create the PR with base `main` and a Conventional Commit title: English type/scope, Vietnamese subject.
6. Write the body in Vietnamese with these sections: `Tóm tắt`, `Thay đổi`, `Kiểm chứng`, `Rủi ro và giới hạn`, and `Checklist`.
7. Never add AI attribution, `Co-Authored-By`, or generated-by footers.
8. Report the PR URL, base/head branches, and any verification that was not run.

Additional user arguments: `$ARGUMENTS`
