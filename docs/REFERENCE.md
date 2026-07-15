# Tham chiếu nhanh — Smart Knowledge Hub

> Trạng thái: thiết kế phase 1 đã được chốt, application scaffold chưa được tạo. Mọi đường dẫn module và lệnh runtime trong tài liệu này là contract dự kiến cho đến khi có code/test kiểm chứng.

## Mục tiêu hệ thống

Knowledge Hub là ứng dụng độc lập, single-user, chạy headless pipeline cùng admin UI tối thiểu. Hệ thống phát hiện bài mới, trích xuất nội dung, tạo phân tích tiếng Việt, ghi note vào Obsidian, thông báo qua LINE và gửi thuật ngữ kỹ thuật sang AnkiFlow dưới dạng draft.

```text
Watcher / LINE / bookmarklet
        │
        ▼
articles(status = new)
        │
        ▼
processor: claim → fetch → extract → LLM
        │
        ├── GitHub Contents API → Obsidian inbox
        ├── LINE push/digest
        └── AnkiFlow term-drafts API
        │
        ▼
articles(status = processed)
```

## Nguồn sự thật

Thứ tự ưu tiên:

1. Code, migration, type và test thực thi được, khi chúng tồn tại.
2. [`ARCHITECTURE.md`](ARCHITECTURE.md) cho quyết định sản phẩm và kỹ thuật đã chốt.
3. [`prompt.md`](prompt.md) cho bối cảnh ban đầu; file này kết thúc giữa phần LINE và không phải specification hoàn chỉnh.

Contract HTTP và D1 chi tiết được tách sang [`API.md`](API.md) và [`DATABASE.md`](DATABASE.md). Không lặp lại toàn bộ schema hoặc payload ở đây.

## Stack và ranh giới runtime

| Hạng mục | Lựa chọn |
| --- | --- |
| Runtime | Cloudflare Workers |
| Web framework | Hono + TypeScript strict mode |
| Database | D1/SQLite, SQL thuần có type, không ORM |
| Package manager | Bun |
| Local/deploy tooling | Wrangler |
| Test | Vitest + `@cloudflare/vitest-pool-workers` |
| Admin UI | Hono JSX SSR + một file CSS tĩnh, không SPA |
| LLM | Anthropic Messages API qua `fetch`, provider có thể thay thế |

Runtime code chỉ dùng Web APIs tương thích Workers. Thư viện Node-only, filesystem local, process dài hạn và browser automation không được đưa vào Worker nếu chưa có quyết định kiến trúc mới.

## Cấu trúc module dự kiến

```text
src/
├── index.ts                    # Hono app + scheduled router
├── watcher/
│   ├── index.ts
│   └── adapters/               # rss, html-list, browser placeholder
├── processor/
│   ├── index.ts
│   ├── extract.ts
│   └── obsidian.ts
├── llm/                        # LLMProvider + Anthropic implementation
├── line/                       # raw-body signature + push/reply
├── ankiflow/client.ts
├── admin/                      # Hono JSX SSR
├── db/                         # parameterized queries + JSON codecs
└── config.ts                   # zod validation cho bindings
migrations/
test/
wrangler.toml
```

Ranh giới bắt buộc:

- Watcher chỉ discover URL và metadata; không xử lý bài.
- Processor sở hữu state machine và orchestration.
- Extractor không gọi LLM hoặc ghi downstream artifact.
- Mỗi client ngoài chỉ sở hữu một integration.
- Admin routes tái sử dụng service/query helper; không nhúng business logic vào JSX.
- D1 helpers tập trung encode/decode JSON và SQL tham số hóa.

## Lịch chạy mặc định

| Cron UTC | Chức năng | Giới hạn |
| --- | --- | --- |
| `0 * * * *` | Watcher | Kiểm tra source đang bật mỗi giờ |
| `*/5 * * * *` | Processor | Claim và xử lý tối đa 3 article |
| `0 22 * * *` | Daily digest | Chỉ dùng khi `notify_mode=daily_digest` |

Cloudflare Queues không thuộc phase 1. `articles.status` cùng atomic claim trong D1 đóng vai trò job queue.

## Article state machine

```text
new ───────────────┐
                   ▼
failed_retryable → processing → processed
       │               │
       │               ├→ failed_retryable
       │               └→ failed
       └─ retry_count >= 3 → failed

skipped là trạng thái kết thúc cho item bị loại có chủ đích.
```

- Claim phải là conditional update và kiểm tra `changes()`, không select rồi update không guard.
- `processing` quá hạn được thu hồi dựa trên `updated_at`; mặc định thiết kế là 15 phút.
- Không giữ transaction qua network call.
- Checkpoint downstream: `obsidian_path`, `line_notified_at`, `ankiflow_pushed_at`.
- Hệ thống là at-least-once tại ranh giới ngoài. LINE có thể bị gửi lặp nếu process chết sau khi push nhưng trước khi ghi timestamp; không được tuyên bố exactly-once.

## Phân loại lỗi

| Nhóm | Retry | Ví dụ |
| --- | --- | --- |
| Tạm thời | Có, tối đa 3 lần | timeout, network, HTTP 429, HTTP 5xx |
| Input/logic | Không | URL không hợp lệ, `EXTRACT_TOO_SHORT`, JSON/schema sai |
| Auth/config | Không | token sai, secret/binding thiếu, HTTP 401/403 |
| HTTP client khác | Không | HTTP 4xx không thuộc 429 |

Anthropic tool output lỗi schema được retry đúng một lần với validation feedback; nếu vẫn lỗi thì bước phân tích chuyển sang lỗi retryable theo thiết kế.

## Auth và trust boundary

| Bề mặt | Cơ chế |
| --- | --- |
| `POST /line/webhook` | `x-line-signature`, HMAC-SHA256 trên raw body, constant-time compare |
| `POST /api/ingest` | `x-ingest-token` |
| `GET /ingest` | `token` trong query cho bookmarklet; chấp nhận rủi ro phase 1 |
| `/admin/*` | Password login, session cookie ký HMAC, `httpOnly`, `secure` ở production, `sameSite` và same-origin/CSRF defense |
| AnkiFlow outbound | `x-integration-token` |

Chỉ nhận URL `http:`/`https:`, cấm credential trong URL, giới hạn redirect/body/timeout và coi nội dung web là dữ liệu không tin cậy. Prompt LLM phải yêu cầu bỏ qua chỉ dẫn nằm trong article.

## External integrations

### Anthropic

- Gọi Messages API bằng `fetch` thuần.
- Bắt buộc ép tool `submit_analysis`, sau đó validate lại bằng zod.
- Model từ `settings.llm_model`, fallback `LLM_MODEL`; mặc định `claude-haiku-4-5`.
- Truncate nội dung sau extraction về tối đa 40.000 ký tự.

### GitHub / Obsidian

- Fine-grained token chỉ có Contents read/write cho đúng vault repo.
- Ghi vào `inbox/YYYY-MM-DD-<slug>.md`, slug ASCII tối đa 60 ký tự.
- Escape YAML frontmatter; retry theo GitHub Contents API SHA flow.
- Không ghi đè note không liên quan khi trùng path.

### LINE

- Hub dùng channel riêng với AnkiFlow.
- `immediate`: push text theo bài; nếu một chu kỳ có hơn 5 bài thì gộp digest.
- `daily_digest`: không push trong processor; cron riêng gom bài chưa notify.
- Event không liên quan trả HTTP 200 và không tạo side effect.

### AnkiFlow

- Knowledge Hub chỉ gửi term draft, không gọi enrichment và không chạy LLM lần hai.
- Batch 1–20 item; phase 1 chỉ phát `en` hoặc `ja`.
- Triển khai AnkiFlow hiện tại trả HTTP 400 khi body sai, trong khi architecture ghi 422. Hub phải coi cả 400 và 422 là validation failure không retry.
- 401 là lỗi cấu hình; timeout và 5xx là retryable.

## Bindings và secrets

| Nhóm | Tên |
| --- | --- |
| LLM | `ANTHROPIC_API_KEY`, `LLM_MODEL` |
| Obsidian | `GITHUB_TOKEN`, `GITHUB_REPO`, `GITHUB_BRANCH`, `OBSIDIAN_INBOX_PATH` |
| LINE | `LINE_CHANNEL_SECRET`, `LINE_CHANNEL_ACCESS_TOKEN`, `LINE_USER_ID` |
| AnkiFlow | `ANKIFLOW_API_URL`, `ANKIFLOW_INTEGRATION_TOKEN` |
| Ingest/Admin | `INGEST_TOKEN`, `ADMIN_PASSWORD`, `SESSION_SECRET` |

Secret production đặt bằng `wrangler secret put`; secret local nằm trong `.dev.vars`. Không đặt secret trong D1 settings, HTML, bookmarklet mẫu, fixture, snapshot hoặc log.

## Contract lệnh dự kiến

Sau khi scaffold tồn tại, `package.json` phải cung cấp:

```bash
bun run dev
bun run typecheck
bun run test
bun run verify
bun run deploy:check
```

Migration dùng `wrangler d1 migrations`. Deploy production, migration remote và thay đổi secret cần xác nhận ngay trước khi chạy.

## Giới hạn phase 1

- Không multi-user, reader/highlight UI hoặc archive full page.
- Không Cloudflare Queues, ORM hoặc frontend SPA.
- Không browser adapter thật, Chrome extension, RAG, embedding hay recommendation tự động.
- Browser adapter hiện chỉ là placeholder và phải báo rõ phase 2.
- Obsidian memo không tham gia spaced repetition; AnkiFlow là SRS master.
