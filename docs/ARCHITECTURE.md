# Smart Knowledge Hub — Thiết kế kỹ thuật chi tiết (v1.0)

> Tài liệu này dùng để giao cho Claude Code thực thi. Mọi quyết định đã được chốt qua thảo luận; phần đánh dấu `[DEFAULT]` là giá trị mặc định có thể đổi qua config mà không sửa thiết kế.

---

## 0. Tóm tắt quyết định đã chốt (Decision Log)

| #   | Quyết định                                                                                                                                                                             |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Hub là **app riêng, headless pipeline + admin UI tối thiểu**, không dùng chung codebase với AnkiFlow                                                                                   |
| D2  | Hạ tầng Hub: **Cloudflare Workers + D1 + Cron Triggers** (free tier). KHÔNG dùng CF Queues (yêu cầu paid plan) — job queue mô phỏng bằng bảng `articles.status` + cron                 |
| D3  | LLM: **Anthropic API**, model mặc định `claude-haiku-4-5`, thiết kế swappable qua interface `LLMProvider` + env `LLM_MODEL`                                                            |
| D4  | Ngôn ngữ summary: **tiếng Việt**                                                                                                                                                       |
| D5  | Ghi Obsidian qua **GitHub Contents API** vào repo vault private có sẵn, folder `inbox/`                                                                                                |
| D6  | SR **chỉ cho thuật ngữ**, chạy qua AnkiFlow. Obsidian memo KHÔNG vào SR                                                                                                                |
| D7  | **Model 2**: AnkiFlow là SRS master, ôn tập qua LINE (rating Nhớ/Quên). Anki Desktop chỉ là đích export phụ, không phải nguồn chân lý SRS                                              |
| D8  | AnkiFlow build **独自SRS bằng `ts-fsrs`** (FSRS thay SM-2), là prerequisite                                                                                                            |
| D9  | Hub đẩy **term draft** vào AnkiFlow qua API mới; enrich AI chạy trong AnkiFlow khi user duyệt (không LLM 2 lần)                                                                        |
| D10 | Nguồn khởi điểm: `https://www.anthropic.com/research`, `https://www.anthropic.com/news` (type `html_list`). Thiết kế adapter mở rộng được: `rss`, `html_list`, `browser` (placeholder) |
| D11 | Ingestion đa thiết bị: LINE bot (mọi thiết bị) + bookmarklet (PC/iPad). Chrome extension = phase 2                                                                                     |
| D12 | `[DEFAULT]` 2 LINE channel riêng: Hub bot (digest + nhận URL) và AnkiFlow bot (SRS) — tránh phải viết webhook router                                                                   |
| D13 | Phase 2 (KHÔNG làm ở phase này): embedding/related articles/RAG, recommendation nguồn tự động, Chrome extension, web reader UI, browser adapter thật                                   |

**Non-goals phase 1 (ghi rõ để Claude Code không tự ý làm):** không có reader/highlight UI trong Hub; không multi-user cho Hub; không SR cho memo Obsidian; không full-page archive; không Meilisearch/full-text search.

---

## 1. Kiến trúc tổng thể

```
                        ┌──────────────────────────────────────────┐
                        │  HUB (repo mới: knowledge-hub)           │
                        │  Cloudflare Workers + Hono + D1          │
                        │                                          │
  Cron (hourly) ───────▶│  [Watcher]                               │
                        │   sources ──adapter──▶ phát hiện URL mới │
                        │        │                                 │
  LINE user ──URL──────▶│  [LINE Webhook /line/webhook]            │
  Bookmarklet ─────────▶│  [Ingest API /api/ingest]                │
                        │        ▼                                 │
                        │   articles(status=new)                   │
                        │        │                                 │
  Cron (5 min) ────────▶│  [Processor]                             │
                        │   fetch → extract → LLM → lưu D1         │
                        │        │            (Anthropic API)      │
                        │        ├──▶ GitHub Contents API ──▶ Obsidian vault/inbox/*.md
                        │        ├──▶ LINE Push (Hub bot): tóm tắt tiếng Việt
                        │        └──▶ POST AnkiFlow /api/integrations/term-drafts
                        │                                          │
  Admin (browser) ─────▶│  [Admin UI /admin/*] Hono JSX SSR        │
                        └──────────────────────────────────────────┘

                        ┌──────────────────────────────────────────┐
                        │  ANKIFLOW (repo có sẵn — sửa đổi)        │
                        │  Next.js/Vercel + Firestore              │
                        │                                          │
   term drafts ────────▶│  entries(status=draft) → user duyệt ở    │
                        │  Preview → /api/generate enrich → save   │
                        │        │                                 │
                        │  [独自SRS: ts-fsrs]                       │
   Vercel Cron daily ──▶│  push card đến hạn qua LINE (Flex Msg)   │
   LINE postback ──────▶│  rating → FSRS update review_state       │
                        │                                          │
                        │  (Anki Desktop: export phụ, một chiều)   │
                        └──────────────────────────────────────────┘
```

Hai work-stream độc lập, tích hợp qua 1 API contract duy nhất (§6). Có thể code song song.

---

## 2. WORK PACKAGE A — Sửa đổi AnkiFlow (prerequisite)

### WP-A0: Fix 2 lỗi hiện trạng (P0, làm trước mọi thứ)

1. **`lib/srs/query.ts` thiếu scope `user_id`**: `getDueEntries` query collection `entries` không có `where('user_id','==',uid)`. Sửa: nhận `uid` làm tham số bắt buộc, thêm điều kiện. Rà toàn bộ caller. Kiểm tra tương thích Firestore Security Rules + composite index (thêm index `user_id + status + review_state.due_date` nếu cần).
2. **Hai nguồn chân lý `review_state`**: thêm field `srs_master: 'internal' | 'anki'` vào Entry (default `'anki'` cho data cũ — migration script; `'internal'` cho mọi entry tạo mới từ nay).
    - `/api/anki/sync-srs` (POST nhận cardsInfo): **bỏ qua** entry có `srs_master === 'internal'` — không ghi đè.
    - Rating từ LINE webhook: chỉ áp dụng cho entry `srs_master === 'internal'`; nếu gặp entry `'anki'`, chuyển `srs_master → 'internal'` tại lần rating đầu (kèm log) — quy tắc: _hành động ôn tập trong hệ nào thì hệ đó thành master_.

### WP-A1: 独自SRS — thay SM-2 bằng FSRS (`ts-fsrs`)

- Cài `ts-fsrs`. Tạo `lib/srs/fsrs.ts` giữ **nguyên interface** hiện có: `createDefaultReviewState(dueDate)`, `applyRating(currentState, rating, now)` để webhook-handler và caller không đổi.
- Mở rộng type `ReviewState` (thêm field, không xóa field cũ để data cũ đọc được):
    ```ts
    interface ReviewState {
        // giữ nguyên field cũ: ease_factor, interval_days, due_date, lapses, total_reviews, last_reviewed_at, last_rating, queue
        fsrs?: {
            stability: number;
            difficulty: number;
            state: 0 | 1 | 2 | 3; // New/Learning/Review/Relearning (ts-fsrs State)
            reps: number;
            scheduled_days: number;
            last_review: string; // ISO
        };
    }
    ```
- Mapping rating: `again|hard|good|easy` → `Rating.Again|Hard|Good|Easy` của ts-fsrs.
- **Converter** `migrateSm2ToFsrs(reviewState)`: entry cũ chưa có `fsrs` → khởi tạo từ heuristic: `stability = max(interval_days, 0.5)`, `difficulty = clamp(11 - ease_factor*2.4, 1, 10)`, `state = interval_days > 0 ? Review : New`, giữ nguyên `due_date`. Chạy lazy tại lần rating kế tiếp (không cần batch migration).
- `getDueEntries`: **bỏ ràng buộc `status == 'synced'`** → điều kiện mới: `status IN ('synced','reviewed','draft_approved')` AND `review_state != null` AND `srs_master == 'internal'` (với master='anki' giữ hành vi cũ). Lưu ý giới hạn `in` + composite index của Firestore — nếu vướng, tách thành 2 query merge.
- Unit test: chuỗi rating cố định → snapshot lịch FSRS; test converter; test precedence srs_master.

### WP-A2: Endpoint nhận term draft từ Hub

`POST /api/integrations/term-drafts`

- **Auth**: header `x-integration-token` so sánh env `INTEGRATION_TOKEN` (constant-time compare). KHÔNG dùng session cookie. Route thêm vào exclude-list của middleware. Token chỉ có quyền duy nhất: tạo draft cho `uid` cố định từ env `INTEGRATION_TARGET_UID`.
- **Request body**:
    ```ts
    {
      source: 'knowledge-hub',
      items: Array<{
        term: string                 // "context engineering"
        language: 'en' | 'ja'
        definition_hint_vi?: string  // gợi ý ngắn từ Hub LLM
        context_quote?: string       // câu chứa term trong bài (≤200 ký tự)
        source_url: string
        source_title: string
      }>                             // 1..20 items
    }
    ```
- **Xử lý**: với mỗi item → gọi logic check-duplicate sẵn có (theo term + user); nếu trùng → skip, trả về trong `skipped[]`. Nếu mới → tạo Entry `status: 'draft'`, `srs_master: 'internal'`, `content_type`: dùng form IT/Dev sẵn có, lưu `source_url/source_title/context_quote` vào field metadata (thêm optional fields vào Entry type). KHÔNG gọi Claude ở bước này (D9).
- **Response**: `{ created: string[], skipped: Array<{term, reason}> }` (created = entry IDs).
- **UI**: màn History thêm filter `status=draft` + badge "From Hub" (đọc `source==='knowledge-hub'`). User mở draft → nút "Generate" chạy `/api/generate` flow sẵn có → Preview → Save → vào vòng SRS.
- Idempotency: unique theo `(user_id, term_normalized)` — term_normalized = lowercase + trim.

### WP-A3: LINE SRS daily push tự động

- Tạo `GET /api/cron/srs-push` bảo vệ bằng `Authorization: Bearer ${CRON_SECRET}` (pattern Vercel Cron chuẩn). Logic: `getDueEntries(uid=INTEGRATION_TARGET_UID, limit 5)` → build Flex Message (component sẵn có `lib/line/flex-message.ts`) → push.
- `vercel.json`: cron `0 12 * * *` UTC (= 21:00 JST) `[DEFAULT]`.
- Postback rating flow giữ nguyên, chạy trên FSRS sau WP-A1.

**Acceptance WP-A (tổng):** tạo term draft qua curl với token → thấy draft trong History → Generate → Save (Anki đóng) → chạy cron push → nhận LINE → bấm rating → `review_state.fsrs` cập nhật đúng lịch FSRS → `/api/anki/sync-srs` không ghi đè entry này.

---

## 3. WORK PACKAGE B — Hub (repo mới `knowledge-hub`)

### 3.1 Stack & scaffold

- **Runtime**: Cloudflare Workers, framework **Hono** (TypeScript). Local dev + deploy bằng `wrangler`. Package manager: **Bun** (dev), build qua wrangler.
- **DB**: D1, migrations bằng `wrangler d1 migrations`.
- **Cron Triggers** (`wrangler.toml`):
    - `0 * * * *` → watcher (hourly) `[DEFAULT]`
    - `*/5 * * * *` → processor (nhặt job `status='new'|'failed_retryable'`)
- **Cấu trúc repo**:
    ```
    knowledge-hub/
    ├── src/
    │   ├── index.ts              # Hono app + scheduled() router theo cron pattern
    │   ├── watcher/
    │   │   ├── index.ts          # chạy tất cả sources enabled
    │   │   └── adapters/
    │   │       ├── types.ts      # interface SourceAdapter
    │   │       ├── rss.ts
    │   │       ├── html-list.ts
    │   │       └── browser.ts    # placeholder: throw NotImplemented
    │   ├── processor/
    │   │   ├── index.ts          # state machine xử lý article
    │   │   ├── extract.ts        # fetch + linkedom + @mozilla/readability
    │   │   └── obsidian.ts       # GitHub Contents API writer
    │   ├── llm/
    │   │   ├── types.ts          # interface LLMProvider + zod schema output
    │   │   └── anthropic.ts
    │   ├── line/
    │   │   ├── webhook.ts        # verify signature + handle URL message
    │   │   └── push.ts           # push summary message
    │   ├── ankiflow/client.ts    # POST term-drafts
    │   ├── admin/                # Hono JSX SSR: layout, login, screens
    │   ├── db/                   # query helpers (không ORM, SQL thuần có type)
    │   └── config.ts             # đọc env, validate bằng zod khi boot
    ├── migrations/0001_init.sql
    ├── test/                     # vitest + @cloudflare/vitest-pool-workers
    ├── wrangler.toml
    └── README.md                 # setup + runbook
    ```

### 3.2 Schema D1 (`migrations/0001_init.sql`)

```sql
CREATE TABLE sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('rss','html_list','browser')),
  url TEXT NOT NULL,
  config TEXT NOT NULL DEFAULT '{}',   -- JSON: html_list => {"item_selector": "...", "link_attr":"href", "base_url":"..."}
  enabled INTEGER NOT NULL DEFAULT 1,
  last_checked_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id INTEGER REFERENCES sources(id),   -- NULL nếu manual (LINE/bookmarklet)
  ingest_channel TEXT NOT NULL DEFAULT 'watcher'
    CHECK (ingest_channel IN ('watcher','line','bookmarklet','admin')),
  url TEXT NOT NULL UNIQUE,
  title TEXT,
  author TEXT,
  published_at TEXT,
  lang_detected TEXT,
  status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new','processing','processed','failed','failed_retryable','skipped')),
  retry_count INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  summary_vi TEXT,                -- JSON array of bullets
  tags TEXT,                      -- JSON array
  terms TEXT,                     -- JSON array (payload đã gửi AnkiFlow)
  obsidian_path TEXT,             -- inbox/2026-07-07-slug.md sau khi commit
  line_notified_at TEXT,
  ankiflow_pushed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_articles_status ON articles(status);

CREATE TABLE runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('watcher','processor')),
  started_at TEXT NOT NULL,
  finished_at TEXT,
  stats TEXT,                     -- JSON: {sources_checked, new_articles, processed, failed}
  error TEXT
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
-- seed: ('llm_model','claude-haiku-4-5'), ('notify_mode','immediate'), ('max_terms_per_article','5')
```

Seed 2 sources ban đầu:

```sql
INSERT INTO sources (name, type, url, config) VALUES
('Anthropic Research','html_list','https://www.anthropic.com/research',
 '{"item_selector":"a[href^=\"/research/\"]","base_url":"https://www.anthropic.com","exclude_paths":["/research"]}'),
('Anthropic News','html_list','https://www.anthropic.com/news',
 '{"item_selector":"a[href^=\"/news/\"]","base_url":"https://www.anthropic.com","exclude_paths":["/news"]}');
```

> Selector trên là điểm khởi đầu — Claude Code PHẢI fetch HTML thật của 2 trang khi implement, xác nhận cấu trúc DOM và chỉnh selector + viết test fixture từ HTML thật đã lưu.

### 3.3 Watcher

```ts
interface DiscoveredItem {
    url: string;
    title?: string;
    published_at?: string;
}
interface SourceAdapter {
    discover(source: SourceRow, env: Env): Promise<DiscoveredItem[]>;
}
```

- `rss.ts`: fetch feed, parse bằng `fast-xml-parser` (RSS2 + Atom). Item → url (link), title, published_at (pubDate/updated).
- `html-list.ts`: fetch HTML (User-Agent riêng `KnowledgeHubBot/1.0 (+contact)`), parse bằng `linkedom`, `querySelectorAll(config.item_selector)` → resolve absolute URL với `base_url`, loại trùng, loại `exclude_paths`. KHÔNG giới hạn diff theo "trang đầu" — dedupe cuối cùng dựa vào `articles.url UNIQUE`.
- `browser.ts`: `throw new Error('browser adapter: phase 2 — dự kiến chạy Playwright trên GitHub Actions cron đẩy kết quả về /api/ingest')`.
- Flow watcher: với mỗi source enabled → `discover()` → `INSERT OR IGNORE INTO articles (url, title, published_at, source_id, status='new')` → update `last_checked_at`; lỗi thì ghi `last_error`, không throw (source lỗi không chặn source khác). Ghi 1 row `runs`.
- **Lần chạy đầu tiên của một source mới**: mọi bài hiện có trên trang sẽ vào hệ thống (backfill). Chấp nhận với 2 nguồn Anthropic. Thêm setting `backfill_limit` `[DEFAULT 10]`: lần đầu chỉ lấy 10 item mới nhất, đánh dấu phần còn lại `skipped`.

### 3.4 Processor (state machine per article)

Mỗi lần cron: lấy tối đa 3 article `status IN ('new','failed_retryable')` (tránh vượt CPU limit của Workers free — 10ms CPU/request không áp cho scheduled nhưng subrequest limit 50/invocation thì có; 3 bài × ~10 subrequest là an toàn).

Pipeline per article (mỗi bước idempotent, cập nhật status sau mỗi bước):

1. `processing` — fetch URL (timeout 15s, follow redirect, lưu canonical URL nếu khác → check UNIQUE lại).
2. **Extract**: `linkedom` parse → `@mozilla/readability` lấy `title, byline, textContent, excerpt`. Nếu textContent < 300 ký tự → coi là extract fail → `failed` với error `EXTRACT_TOO_SHORT` (khả năng trang JS-heavy → hiển thị ở admin để cân nhắc adapter browser).
3. Truncate textContent về `[DEFAULT 40_000]` ký tự.
4. **LLM** (§3.5) → `summary_vi`, `tags`, `terms`, `lang_detected`.
5. **Obsidian** (§3.6) → commit file, lưu `obsidian_path`.
6. **LINE push** (§3.7) nếu `notify_mode='immediate'`.
7. **AnkiFlow push** (§6) nếu `terms.length > 0` → lưu `ankiflow_pushed_at`.
8. `processed`.

Retry: lỗi network/5xx/429 → `failed_retryable`, `retry_count++`, tối đa 3 → `failed`. Lỗi logic (extract fail, 4xx) → `failed` ngay. Backoff tự nhiên theo chu kỳ cron 5 phút.

### 3.5 LLM layer

```ts
interface ArticleAnalysis {
    summary_vi: string[]; // 3–7 bullet, mỗi bullet ≤ 2 câu, tiếng Việt
    tags: string[]; // 2–5, english-lowercase-kebab, vd "context-engineering"
    terms: Array<{
        term: string; // giữ nguyên ngôn ngữ gốc
        language: 'en' | 'ja';
        definition_hint_vi: string; // 1 câu tiếng Việt
        context_quote: string; // ≤200 ký tự trích từ bài
    }>; // 0..max_terms_per_article; CHỈ thuật ngữ kỹ thuật mới/đáng học, không lấy từ phổ thông
    lang_detected: 'en' | 'ja' | 'vi' | 'other';
}
interface LLMProvider {
    analyzeArticle(
        input: { title: string; text: string; url: string },
        opts: { model: string; maxTerms: number },
    ): Promise<ArticleAnalysis>;
}
```

- `anthropic.ts`: gọi `POST https://api.anthropic.com/v1/messages` bằng fetch thuần (không SDK — giảm bundle). **Bắt buộc dùng tool-use để ép JSON schema** (1 tool `submit_analysis` với input_schema = zod → JSON Schema, `tool_choice: {type:'tool'}`). Parse + validate lại bằng zod; fail → retry 1 lần với error feedback; fail nữa → throw retryable.
- Model từ `settings.llm_model`, fallback env `LLM_MODEL`. `max_tokens: 2048`.
- System prompt (viết trong code, tiếng Anh, chỉ định output tiếng Việt cho summary/definition): nêu rõ tiêu chí term = "khái niệm kỹ thuật cụ thể người đọc IT nên nhớ lâu dài; loại trừ tên sản phẩm thuần túy, từ phổ thông".
- KHÔNG dùng Batch API phase 1 (volume ~10–25 bài/tháng, độ trễ batch không đáng đổi). Ghi chú trong code: cân nhắc Batch khi >300 bài/tháng.

### 3.6 Obsidian writer (GitHub Contents API)

- Env: `GITHUB_TOKEN` (fine-grained PAT, scope Contents read/write đúng 1 repo vault), `GITHUB_REPO` (`owner/name`), `GITHUB_BRANCH` `[DEFAULT main]`, `OBSIDIAN_INBOX_PATH` `[DEFAULT inbox]`.
- Path file: `inbox/YYYY-MM-DD-<slug>.md` (slug từ title, ASCII, ≤60 ký tự; trùng path → thêm hậu tố `-2`).
- Flow: `PUT /repos/{repo}/contents/{path}` với message `hub: add <title>`. Trước khi PUT, `GET` path để lấy `sha` nếu file tồn tại (idempotent khi retry).
- Template:

```markdown
---
title: '<title>'
url: <url>
source: <source name | manual>
author: '<author | unknown>'
published: <published_at | unknown>
saved: <ISO date>
tags: [<tags>]
lang: <lang_detected>
status: inbox
---

## Tóm tắt

- <bullet 1>
- <bullet 2>
  ...

## Thuật ngữ

- **<term>** — <definition_hint_vi>

## Takeaways

<!-- Ghi chú của bạn -->
```

### 3.7 LINE (Hub channel riêng — D12)

- Env: `LINE_CHANNEL_SECRET`, `LINE_CHANNEL_ACCESS_TOKEN`, `LINE_USER_ID` (push đích — chính bạn).
- **Webhook `POST /line/webhook`**: verify chữ ký `x-line-signature` (HMAC-SHA256 với channel secret, constant-time). Message text chứa URL (regex `https?://…`, lấy URL đầu tiên) → `INSERT OR IGNORE articles (ingest_channel='line', status='new')` → reply "Đã lưu ✓" hoặc "URL đã tồn tại". Text không có URL → reply hướng dẫn ngắn. Event khác → 200 bỏ qua.
- **Push per article** (notify_mode=immediate): text message gọn:
    ```
    📄 <title>
    <bullet 1>
    <bullet 2>
    <bullet 3>
    🏷 <tags> | 📚 <n> thuật ngữ → AnkiFlow
    <url>
    ```
    (Text thuần phase 1; Flex Message = polish sau.) Giới hạn: nếu 1 chu kỳ processor có >5 bài → gộp 1 message digest để không spam quota 200/tháng.
- `notify_mode='daily_digest'` (setting): processor không push; thêm cron `0 22 * * *` UTC → gom bài `processed` chưa notify trong 24h → 1 message.

### 3.8 Ingest API + Bookmarklet

- `POST /api/ingest` body `{url}` — auth header `x-ingest-token` = env `INGEST_TOKEN`. Dùng bởi bookmarklet + GitHub Actions browser adapter tương lai.
- `GET /ingest?token=<INGEST_TOKEN>&url=<encoded>` — trả HTML mini "Đã lưu ✓" (cho bookmarklet không cần CORS). Chấp nhận rủi ro token trong URL ở mức cá nhân; ghi chú trong README.
- Bookmarklet (in ra trong admin Settings để copy):
    ```js
    javascript: (() => {
        location.href = 'https://<worker-domain>/ingest?token=<T>&url=' + encodeURIComponent(location.href);
    })();
    ```

### 3.9 Admin UI (Hono JSX SSR — tối giản, không SPA)

- **Auth**: form login 1 password (`ADMIN_PASSWORD` env) → cookie session ký HMAC (`SESSION_SECRET`), httpOnly, 30 ngày. Middleware bảo vệ `/admin/*`. (Ghi chú README: có thể thay bằng Cloudflare Access sau, miễn phí.)
- **Màn hình**:
    1. `/admin` Dashboard: cards số liệu (bài 7 ngày, term đã đẩy, run gần nhất, lỗi gần nhất từ `runs` + `articles.status='failed'`).
    2. `/admin/sources`: bảng CRUD (name, type, url, config JSON textarea, enabled toggle, last_checked, last_error) + nút "Check now" (chạy watcher cho source đó) + nút "Test" (chạy discover, hiển thị 5 item tìm được, KHÔNG insert — bắt buộc có để debug selector).
    3. `/admin/articles`: bảng phân trang (title→url, source, status badge, created) + filter status + nút Retry (set `status='new'`, reset retry_count) + nút xem chi tiết (summary, terms, error, link Obsidian file).
    4. `/admin/settings`: sửa bảng settings (llm_model dropdown: haiku/sonnet nhập tự do, notify_mode, max_terms, backfill_limit) + hiển thị bookmarklet.
- Style: 1 file CSS tĩnh, không framework. Không cần đẹp — cần rõ.

### 3.10 Env vars Hub (validate bằng zod khi boot)

```
ANTHROPIC_API_KEY, LLM_MODEL=claude-haiku-4-5,
GITHUB_TOKEN, GITHUB_REPO, GITHUB_BRANCH=main, OBSIDIAN_INBOX_PATH=inbox,
LINE_CHANNEL_SECRET, LINE_CHANNEL_ACCESS_TOKEN, LINE_USER_ID,
ANKIFLOW_API_URL, ANKIFLOW_INTEGRATION_TOKEN,
INGEST_TOKEN, ADMIN_PASSWORD, SESSION_SECRET
```

Tất cả secret đặt qua `wrangler secret put`, không commit.

---

## 4. Thứ tự thực thi & acceptance criteria

| #   | WP                                 | Phụ thuộc | Acceptance                                                                                                                                                        |
| --- | ---------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | A0 fix AnkiFlow                    | —         | Test chứng minh query scope theo uid; sync-srs bỏ qua `srs_master='internal'`                                                                                     |
| 2   | A1 FSRS                            | A0        | Unit test lịch FSRS; rating LINE cập nhật `fsrs.*`; due query lấy cả entry chưa export Anki                                                                       |
| 3   | A2 term-drafts API                 | A0        | curl với token → draft xuất hiện; duplicate bị skip; sai token → 401                                                                                              |
| 4   | A3 cron push                       | A1,A2     | Cron chạy → LINE nhận card đến hạn → rating hoạt động                                                                                                             |
| 5   | B1 scaffold + schema + admin auth  | —         | Deploy wrangler thành công; login admin OK; migration chạy                                                                                                        |
| 6   | B2 watcher + adapters              | B1        | "Test" trên 2 source Anthropic trả về danh sách bài thật; chạy watcher → articles status=new; chạy lại → không trùng                                              |
| 7   | B3 processor + LLM + Obsidian      | B2        | 1 bài Anthropic thật đi hết pipeline: file .md xuất hiện đúng template trong repo vault, summary tiếng Việt, article `processed`; retry hoạt động khi giả lập lỗi |
| 8   | B4 LINE hub + ingest + bookmarklet | B3        | Gửi URL vào LINE bot → reply "Đã lưu" → được xử lý; bookmarklet lưu được; push tóm tắt về LINE                                                                    |
| 9   | B5 tích hợp AnkiFlow               | 3,7       | Bài có term → draft xuất hiện trong AnkiFlow History                                                                                                              |
| 10  | B6 admin screens hoàn thiện        | 5–9       | Đủ 4 màn, thao tác CRUD source + retry article hoạt động                                                                                                          |

Test: AnkiFlow theo test infra sẵn có; Hub dùng vitest + `@cloudflare/vitest-pool-workers`, fixture HTML thật của 2 trang Anthropic lưu trong `test/fixtures/`. Mock: Anthropic API, GitHub API, LINE API, AnkiFlow API.

---

## 5. Vận hành & chi phí

| Hạng mục                                | Giá trị                                                                                 |
| --------------------------------------- | --------------------------------------------------------------------------------------- |
| CF Workers/D1/Cron                      | $0 (free tier; watcher hourly + processor 5' ≈ 9k invocation/tháng, dưới hạn 100k/ngày) |
| LLM (Haiku, ~10–25 bài/tháng khởi điểm) | < $0.5/tháng; trần 500 bài/tháng ≈ $1–3.5                                               |
| LINE ×2 channel                         | $0 (mỗi channel <200 push/tháng; digest gộp khi vượt)                                   |
| Vercel/Firestore (AnkiFlow)             | như hiện tại, không tăng đáng kể                                                        |
| GitHub                                  | $0                                                                                      |

Runbook trong README: cách thêm source mới (3 bước: admin → Sources → Test → Save), cách đổi model, cách xử lý `EXTRACT_TOO_SHORT` (dấu hiệu cần browser adapter), giới hạn đã biết (không archive full-page; link chết = mất bài gốc, chỉ còn summary trong Obsidian).

---

## 6. API Contract Hub ⇄ AnkiFlow (nguồn chân lý duy nhất)

```
POST {ANKIFLOW_API_URL}/api/integrations/term-drafts
Headers: x-integration-token: <INTEGRATION_TOKEN>, content-type: application/json
Body:    xem §WP-A2
200: { created: string[], skipped: [{term, reason}] }
401: token sai | 422: body sai schema | 500: retryable
```

Hub coi 401/422 là lỗi cấu hình (không retry, hiện ở admin), 5xx/timeout là retryable.

---

## 7. Rủi ro đã nhận diện

1. **Anthropic đổi DOM** → watcher trả 0 item: watcher phát hiện `discover()` trả rỗng 3 lần liên tiếp cho source từng có bài → ghi `last_error='SELECTOR_SUSPECT'`, hiện đỏ ở dashboard.
2. **Trang chặn bot/Cloudflare-to-Cloudflare**: nếu fetch từ Workers bị 403, thử User-Agent browser-like; nếu vẫn fail → đường lui là browser adapter GitHub Actions (phase 2, đã chừa chỗ).
3. **LINE 200 push/tháng**: guard đã thiết kế (gộp digest khi >5 bài/chu kỳ). Theo dõi qua dashboard.
4. **Free tier thay đổi điều khoản**: toàn bộ provider đều swap được (LLM qua interface; D1 là SQLite chuẩn; Workers → Hono chạy được trên Bun/Node nếu phải rời CF).
