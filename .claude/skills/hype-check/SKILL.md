---
name: hype-check
description: Adversarially evaluate an AI tool, paper, product, source, or technique before Knowledge Hub adopts or tracks it. Use when the user asks whether a trending claim is credible, reproducible, or worth the operational cost.
---

# AI Hype Check

## Goal

Judge whether the target is worth adopting or tracking in real work. Separate an interesting idea from a maintainable, evidence-backed capability.

Write the result in Vietnamese and lead with the conclusion.

## Investigation

1. Classify the target: repository, paper, product, article, source feed, benchmark, or technique.
2. Prefer primary sources: official docs, repository code/releases/issues, paper and implementation, changelog, pricing, security, license, and reproducible benchmarks.
3. Use independent production reports to test the claims, not as a substitute for primary evidence.
4. Separate explicit claims, implied expectations, verified effects, and weakly supported effects.
5. Compare against the existing Knowledge Hub architecture and simpler alternatives.
6. Evaluate adoption cost, Worker compatibility, maintenance, privacy, vendor lock-in, token/cost impact, failure modes, and exit strategy.
7. State what could not be verified instead of filling gaps with guesses.

## Required critical angles

- Demo-only scale or cherry-picked benchmark
- Low contributor/maintenance depth
- Missing tests, security posture, license, or operational evidence
- Node/server assumptions incompatible with Cloudflare Workers
- A renamed wrapper around existing capability
- Cost or complexity greater than the marginal benefit
- Prompt injection, data retention, credential, or supply-chain risk
- Phase-2 scope disguised as a small phase-1 addition

## Output

Use these sections:

1. `Kết luận` — one verdict and concise rationale
2. `Tuyên bố và bằng chứng`
3. `Giá trị thực chiến`
4. `Điểm đáng ngờ`
5. `Giả thuyết thay thế`
6. `Phán quyết áp dụng cho Knowledge Hub`
7. `Cách kiểm chứng nhỏ` — only when a trial is justified
8. `Nguồn tham khảo`

Default to answering in chat. Save a report only when the user provides or approves a destination; never assume a personal Obsidian vault path or write directly to the production vault.
