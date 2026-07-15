# Smart Knowledge Hub

Smart Knowledge Hub là pipeline thu thập và xử lý tri thức dành cho một người dùng. Hệ thống theo dõi nguồn web, trích xuất bài viết, tạo bản tóm tắt tiếng Việt bằng Anthropic, ghi ghi chú vào Obsidian qua GitHub, gửi thông báo LINE và chuyển thuật ngữ kỹ thuật sang AnkiFlow dưới dạng draft.

## Trạng thái hiện tại

Repository đang ở giai đoạn **documentation-first**. Chưa có application scaffold, `package.json`, migration D1, test suite hoặc Git worktree. Các lệnh phát triển bên dưới là contract dự kiến cho giai đoạn scaffold, chưa phải lệnh đã được kiểm chứng.

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

Hai cron mặc định dự kiến:

- `0 * * * *`: kiểm tra các nguồn đang bật.
- `*/5 * * * *`: xử lý tối đa ba article đang chờ hoặc có lỗi retryable.

Không sử dụng Cloudflare Queues trong phase 1; D1 và state machine của `articles` đóng vai trò hàng đợi.

## Stack dự kiến

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
| [`docs/CONTRIBUTING.md`](docs/CONTRIBUTING.md) | Git workflow và quy tắc đóng góp |
| [`docs/VERIFICATION.md`](docs/VERIFICATION.md) | Chiến lược kiểm chứng |

## Contract lệnh dự kiến

Khi scaffold được tạo, `package.json` cần cung cấp ít nhất:

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

## Runbook phase 1

- Thêm nguồn: vào Admin → Sources → Test; chỉ Save khi selector trả về kết quả hợp lệ.
- Đổi model: cập nhật setting `llm_model`; `LLM_MODEL` chỉ là fallback.
- `EXTRACT_TOO_SHORT`: kiểm tra DOM và selector trước; browser adapter thật thuộc phase 2.
- Retry: network, timeout, HTTP 429 và 5xx được retry tối đa ba lần; auth, validation, extraction logic và 4xx khác dừng ngay.
- Bài gốc không được archive toàn trang. Nếu URL chết, hệ thống chỉ còn summary đã ghi vào Obsidian.

## Ngoài phạm vi phase 1

- Multi-user
- Cloudflare Queues
- Reader/highlight UI
- Browser adapter thật hoặc Chrome extension
- RAG, embeddings, related articles và recommendation tự động
- Spaced repetition cho Obsidian memo
