# Smart Knowledge Hub

Smart Knowledge Hub là pipeline thu thập và xử lý tri thức dành cho một người dùng. Hệ thống theo dõi nguồn web, trích xuất bài viết, tạo bản tóm tắt tiếng Việt bằng Anthropic, ghi ghi chú vào Obsidian qua GitHub, gửi thông báo LINE và chuyển thuật ngữ kỹ thuật sang AnkiFlow dưới dạng draft.

## Trạng thái hiện tại

Repository đã hoàn thành nền tảng ứng dụng và watcher: Workers/Hono scaffold, Bun package, hai migration D1, admin session, RSS/Atom adapter, HTML-list adapter, browser placeholder, backfill/dedupe, source health và run logging. Processor, các external integrations, ingest routes và admin UI đầy đủ vẫn đang được triển khai theo các phase tiếp theo.

Nguồn thiết kế chính là [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). [`docs/prompt.md`](docs/prompt.md) chỉ lưu đầu vào ban đầu và kết thúc giữa phần LINE, vì vậy không được dùng để thay thế tài liệu kiến trúc.

## Luồng chính

```text
Watcher / LINE / bookmarklet
  -> articles(status=new)
  -> processor
  -> extract
  -> Anthropic analysis
  -> GitHub / Obsidian
  -> LINE
  -> AnkiFlow term drafts
  -> processed
```

Ba cron được cấu hình; hiện chỉ watcher đã được triển khai:

- `0 * * * *`: kiểm tra các nguồn đang bật mỗi giờ — đã triển khai.
- `*/5 * * * *`: xử lý tối đa ba article đang chờ hoặc có lỗi retryable — chưa triển khai.
- `0 22 * * *`: gửi daily digest khi được bật — chưa triển khai.

Không sử dụng Cloudflare Queues trong phase 1; D1 và state machine của `articles` đóng vai trò hàng đợi.

## Stack

- Cloudflare Workers và Hono, TypeScript strict mode
- D1/SQLite với numbered migrations và SQL tham số hóa, không ORM
- Bun cho package management và scripts
- Wrangler cho local development, migrations và deployment
- Vitest với `@cloudflare/vitest-pool-workers`
- Hono JSX SSR cho admin UI, không dùng SPA framework

## Tài liệu

| Tài liệu | Vai trò |
| --- | --- |
| [`AGENTS.md`](AGENTS.md) | Quy tắc chuẩn cho AI coding agents |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Thiết kế kỹ thuật và quyết định phase 1 |
| [`docs/prompt.md`](docs/prompt.md) | Đầu vào lịch sử, không phải specification hoàn chỉnh |
| [`docs/REFERENCE.md`](docs/REFERENCE.md) | Tham chiếu vận hành và kiến trúc ngắn gọn |
| [`docs/API.md`](docs/API.md) | HTTP, auth và external integration contracts |
| [`docs/DATABASE.md`](docs/DATABASE.md) | D1 schema, state machine và migration rules |
| [`docs/CONTRIBUTING.md`](docs/CONTRIBUTING.md) | Git workflow và quy tắc đóng góp |
| [`docs/VERIFICATION.md`](docs/VERIFICATION.md) | Chiến lược kiểm chứng |

## Lệnh phát triển

`package.json` cung cấp các lệnh đã được kiểm chứng trong Phase 1:

```bash
bun run dev
bun run typecheck
bun run test
bun run verify
bun run deploy:check
```

Không dùng `npm` hoặc `pnpm`. Deployment production, migration D1 remote và thay đổi Wrangler secrets luôn cần xác nhận ngay trước khi thực hiện.

## Cấu hình và secrets

Các binding/secret dự kiến gồm:

```text
ANTHROPIC_API_KEY
LLM_MODEL
GITHUB_TOKEN
GITHUB_REPO
GITHUB_BRANCH
OBSIDIAN_INBOX_PATH
LINE_CHANNEL_SECRET
LINE_CHANNEL_ACCESS_TOKEN
LINE_USER_ID
ANKIFLOW_API_URL
ANKIFLOW_INTEGRATION_TOKEN
INGEST_TOKEN
ADMIN_PASSWORD
SESSION_SECRET
```

Secret production được lưu bằng Wrangler secret storage. Secret local đặt trong `.dev.vars`; không commit, in ra log hoặc chép giá trị thật vào bookmarklet, fixtures hay tài liệu.

## Runbook hiện tại

- Chạy migration local: `bunx wrangler d1 migrations apply knowledge-hub --local`.
- Kiểm tra đầy đủ trước khi commit: `bun run verify`.
- Watcher chạy adapter theo từng source độc lập; lỗi một source được ghi vào `last_error` và không chặn source khác.
- Lần kiểm tra đầu áp `backfill_limit`; item vượt giới hạn được lưu `skipped` để không bị phát hiện lặp vô hạn.
- Ba lần discover rỗng liên tiếp ở source từng có article ghi `SELECTOR_SUSPECT`; một lần discover thành công sẽ reset cảnh báo.
- Admin Sources, processor và external integrations chưa có runtime UI/flow hoàn chỉnh; không dùng các phần contract tương ứng như thể đã triển khai.

## Ngoài phạm vi phase 1

- Multi-user
- Cloudflare Queues
- Reader/highlight UI
- Browser adapter thật hoặc Chrome extension
- RAG, embeddings, related articles và recommendation tự động
- Spaced repetition cho Obsidian memo
