# API Contract — Smart Knowledge Hub

> Trạng thái: contract thiết kế phase 1. Hub chưa có runtime implementation. Riêng endpoint AnkiFlow outbound đã được kiểm tra trên repo AnkiFlow local ngày 2026-07-15; sai khác được ghi rõ bên dưới.

## Quy ước

- Base URL là domain của Cloudflare Worker.
- JSON request dùng `content-type: application/json`.
- URL đầu vào chỉ chấp nhận `http:` hoặc `https:`, không chứa username/password.
- Token/signature được so sánh constant-time và không xuất hiện trong log/error.
- Runtime code dùng Web `Request`/`Response`; không phụ thuộc Node HTTP APIs.
- Mọi handler có timeout/size limit phù hợp và trả lỗi có chủ đích, không để uncaught exception lộ thông tin nội bộ.

Vì code chưa tồn tại, response envelope chung chưa được xem là ổn định. Khi scaffold API được tạo, implementation và tests phải chốt một error shape thống nhất rồi cập nhật tài liệu này. Những payload/status được ghi cụ thể dưới đây là contract bắt buộc.

## Tổng quan bề mặt HTTP

| Method | Path | Auth | Loại |
| --- | --- | --- | --- |
| `POST` | `/line/webhook` | LINE signature | Webhook JSON |
| `POST` | `/api/ingest` | `x-ingest-token` | JSON API |
| `GET` | `/ingest` | Query token | Bookmarklet HTML |
| `GET/POST` | `/admin/login` | Password → session | HTML form |
| `POST` | `/admin/logout` | Session + same-origin | HTML form |
| `GET` | `/admin` | Session | Dashboard HTML |
| `GET/POST` | `/admin/sources/*` | Session + same-origin cho mutation | HTML/forms |
| `GET/POST` | `/admin/articles/*` | Session + same-origin cho mutation | HTML/forms |
| `GET/POST` | `/admin/settings` | Session + same-origin cho mutation | HTML/forms |

Scheduled handlers của watcher, processor và daily digest không phải public HTTP endpoints; chúng được dispatch từ Worker `scheduled()` theo cron expression.

## `POST /line/webhook`

Nhận LINE Messaging API webhook cho Hub channel.

### Auth

Header:

```text
x-line-signature: <base64 HMAC-SHA256>
```

Tính chữ ký trên exact raw request body bằng `LINE_CHANNEL_SECRET`. Phải verify trước khi parse JSON.

### Behavior

- Invalid/missing signature: từ chối request, không parse và không tạo side effect.
- Text message chứa URL: lấy URL HTTP(S) đầu tiên, validate/normalize rồi insert article với `ingest_channel='line'`, `status='new'`.
- URL mới: reply `Đã lưu ✓`.
- URL đã tồn tại: reply `URL đã tồn tại`.
- Text không có URL: reply hướng dẫn ngắn.
- Event type khác: HTTP 200, không reply/persist nếu không cần.
- Delivery trùng từ LINE không được tạo article thứ hai nhờ unique URL.

### Security tests bắt buộc

- Raw body có whitespace khác nhau tạo chữ ký khác nhau.
- Signature sai độ dài không làm compare throw.
- Body malformed với chữ ký đúng không làm lộ stack/secret.
- Multiple URLs chỉ ingest URL hợp lệ đầu tiên.

## `POST /api/ingest`

Dùng bởi client tin cậy như bookmarklet thay thế hoặc browser adapter tương lai.

### Auth

```text
x-ingest-token: <INGEST_TOKEN>
```

### Request

```json
{
  "url": "https://example.com/article"
}
```

### Behavior

- Validate scheme, credential, độ dài và normalize trước insert.
- Insert article với `ingest_channel='bookmarklet'` cho client phase 1; browser adapter phase 2 phải dùng channel/metadata được chốt riêng trước khi triển khai.
- Duplicate URL là kết quả idempotent, không phải lỗi retryable.
- Token sai hoặc config thiếu là lỗi auth/config và không retry.
- Response JSON cụ thể sẽ được khóa bằng implementation tests khi scaffold route; không được tự nhận route đã tồn tại chỉ dựa trên tài liệu này.

## `GET /ingest`

Endpoint HTML tối thiểu cho bookmarklet không cần CORS.

### Query

```text
/ingest?token=<INGEST_TOKEN>&url=<percent-encoded URL>
```

### Behavior

- Token được so sánh constant-time.
- URL mới: insert với `ingest_channel='bookmarklet'` và trả trang HTML `Đã lưu ✓`.
- Duplicate: trả trang HTML cho biết URL đã tồn tại.
- Token/URL không hợp lệ: trả trang lỗi tối giản, không phản chiếu token hoặc raw unescaped URL.
- Header/caching phải hạn chế lưu URL có query token. Đây là trade-off chỉ được chấp nhận cho phase 1 single-user; không tái sử dụng query token ở API khác.

Bookmarklet hiển thị trong admin phải dùng placeholder hoặc token được inject tại runtime, không commit token thật.

## Admin routes

### Session

- `GET /admin/login`: render form.
- `POST /admin/login`: verify `ADMIN_PASSWORD`, tạo cookie session ký HMAC bằng `SESSION_SECRET`, thời hạn 30 ngày.
- `POST /admin/logout`: xóa session cookie.
- Cookie production: `httpOnly`, `secure`, `sameSite`; không chứa raw password.
- Mọi state-changing form action kiểm tra same-origin/CSRF defense.

### `/admin`

Dashboard hiển thị:

- Số article 7 ngày gần nhất.
- Số term đã push.
- Run gần nhất.
- Lỗi gần nhất từ `runs` và article `failed`.

### `/admin/sources`

- List/create/update source với `name`, `type`, `url`, validated JSON `config`, `enabled`.
- `Test`: gọi đúng adapter, trả tối đa 5 item và tuyệt đối không insert.
- `Check now`: chạy watcher cho một source bằng cùng service với scheduled watcher.
- Source đã được article tham chiếu được disable thay vì hard-delete.

### `/admin/articles`

- Pagination và filter theo status.
- Detail hiển thị summary, terms, error và Obsidian path/link đã escape.
- `Retry`: chỉ cho trạng thái lỗi hợp lệ; set `status='new'`, reset `retry_count`, giữ checkpoint đã hoàn tất để processor resume.

### `/admin/settings`

Cho phép sửa các key có allowlist:

- `llm_model`
- `notify_mode`: `immediate | daily_digest`
- `max_terms_per_article`
- `backfill_limit`

Không cho ghi secret vào bảng settings. Trang hiển thị bookmarklet đã escaped.

## Outbound contract: AnkiFlow term drafts

```text
POST {ANKIFLOW_API_URL}/api/integrations/term-drafts
x-integration-token: <ANKIFLOW_INTEGRATION_TOKEN>
content-type: application/json
```

### Request

```ts
interface TermDraftRequest {
  source: 'knowledge-hub'
  items: Array<{
    term: string
    language: 'en' | 'ja'
    definition_hint_vi?: string
    context_quote?: string // tối đa 200 ký tự
    source_url: string
    source_title: string
  }> // 1..20 item
}
```

### Success

HTTP 200:

```ts
interface TermDraftResponse {
  created: string[]
  skipped: Array<{
    term: string
    reason: string
  }>
}
```

`created` chứa entry IDs. Duplicate được trả trong `skipped`, không phải lỗi request. Hub chỉ tạo draft; user duyệt và chạy enrichment trong AnkiFlow.

### Failure và retry

| Status/kết quả | Phân loại Hub |
| --- | --- |
| `400` | Validation/contract failure, không retry |
| `401` | Token/config failure, không retry, hiển thị admin |
| `422` | Validation/contract failure, không retry |
| `429` | Retryable |
| `5xx` | Retryable |
| Timeout/network | Retryable |

Architecture ghi 422 cho body sai; implementation AnkiFlow được kiểm tra ngày 2026-07-15 hiện trả 400 và chấp nhận canonical BCP-47 language code. Hub vẫn cố ý giới hạn output phase 1 ở `en | ja` và phải xử lý cả 400/422.

## Outbound contract: Anthropic

- Endpoint: Anthropic Messages API qua `fetch` thuần.
- Bắt buộc một tool `submit_analysis`; `tool_choice` ép gọi tool này.
- Parse tool input rồi validate lại bằng zod.
- Schema fail: retry một lần với validation feedback; fail lần hai thành retryable analysis error.
- `max_tokens=2048`; model từ D1 settings, fallback binding.
- Article text là untrusted data; system prompt cấm tuân theo chỉ dẫn nằm trong article.

## Outbound contract: GitHub Contents API

- `GET /repos/{owner}/{repo}/contents/{path}` để kiểm tra path/SHA.
- `PUT /repos/{owner}/{repo}/contents/{path}` để create/update note.
- Branch từ `GITHUB_BRANCH`, mặc định `main`.
- Retry phải reconcile SHA/path; không tạo suffix mới vô hạn cho cùng article.
- Fine-grained token chỉ có Contents read/write trên đúng vault repo.

## Outbound contract: LINE push/reply

- Reply webhook ngay sau khi ingest decision hoàn tất.
- Immediate push gửi summary text; hơn 5 article trong một processor cycle thì gộp digest.
- Daily digest gom article processed chưa có `line_notified_at` trong 24 giờ.
- Không gửi real message trong automated tests.

## Type contracts

```ts
interface DiscoveredItem {
  url: string
  title?: string
  published_at?: string
}

interface SourceAdapter {
  discover(source: SourceRow, env: Env): Promise<DiscoveredItem[]>
}

interface ArticleAnalysis {
  summary_vi: string[] // 3..7 bullet, mỗi bullet tối đa 2 câu
  tags: string[]       // 2..5 english-lowercase-kebab
  terms: Array<{
    term: string
    language: 'en' | 'ja'
    definition_hint_vi: string
    context_quote: string // tối đa 200 ký tự
  }>
  lang_detected: 'en' | 'ja' | 'vi' | 'other'
}

interface LLMProvider {
  analyzeArticle(
    input: { title: string; text: string; url: string },
    options: { model: string; maxTerms: number },
  ): Promise<ArticleAnalysis>
}
```

Không mở rộng term language, response shape hoặc auth mechanism nếu chưa cập nhật architecture/API contract và tests.
