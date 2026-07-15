Bạn là senior TypeScript engineer. Tạo repo mới `knowledge-hub` từ đầu — một headless pipeline + admin UI chạy trên Cloudflare Workers.

## Mục đích hệ thống

Tự động theo dõi các trang web (bắt đầu: Anthropic Research + News), phát hiện bài mới, tóm tắt bằng tiếng Việt qua Claude API (Haiku), ghi file Markdown vào Obsidian vault (qua GitHub), trích xuất thuật ngữ kỹ thuật và đẩy vào AnkiFlow, thông báo qua LINE. Admin UI tối giản để quản lý nguồn và theo dõi trạng thái.

## Stack & cấu trúc

- Runtime: Cloudflare Workers, framework Hono (TypeScript)
- DB: D1 (SQLite)
- Dev/build: wrangler, Bun
- Test: vitest + @cloudflare/vitest-pool-workers
- Cron Triggers:
    - `0 * * * *` → watcher (hourly)
    - `*/5 * * * *` → processor
- KHÔNG dùng CF Queues (cần paid plan) — job queue bằng articles.status + cron

### Cấu trúc repo

knowledge-hub/
├── src/
│ ├── index.ts # Hono app + scheduled() handler
│ ├── watcher/
│ │ ├── index.ts
│ │ └── adapters/
│ │ ├── types.ts # interface SourceAdapter { discover(source, env): Promise<DiscoveredItem[]> }
│ │ ├── rss.ts # parse RSS/Atom bằng fast-xml-parser
│ │ ├── html-list.ts # fetch + linkedom + CSS selector
│ │ └── browser.ts # placeholder: throw NotImplemented
│ ├── processor/
│ │ ├── index.ts # state machine per article
│ │ ├── extract.ts # fetch + linkedom + @mozilla/readability
│ │ └── obsidian.ts # GitHub Contents API writer
│ ├── llm/
│ │ ├── types.ts # interface LLMProvider, zod schema ArticleAnalysis
│ │ └── anthropic.ts # fetch thuần, tool-use ép JSON schema
│ ├── line/
│ │ ├── webhook.ts # verify signature + handle URL message
│ │ └── push.ts # push summary
│ ├── ankiflow/
│ │ └── client.ts # POST term-drafts
│ ├── admin/ # Hono JSX SSR
│ │ ├── layout.tsx
│ │ ├── login.tsx
│ │ ├── dashboard.tsx
│ │ ├── sources.tsx
│ │ ├── articles.tsx
│ │ └── settings.tsx
│ ├── db/
│ │ └── queries.ts # typed SQL helpers (không ORM)
│ └── config.ts # zod validate env
├── migrations/
│ └── 0001_init.sql
├── test/
│ ├── fixtures/ # HTML thật lưu từ 2 trang Anthropic
│ ├── watcher.test.ts
│ ├── processor.test.ts
│ ├── llm.test.ts
│ ├── obsidian.test.ts
│ └── line.test.ts
├── wrangler.toml
├── package.json
├── tsconfig.json
└── README.md

## Schema D1 (migrations/0001_init.sql)

```sql
CREATE TABLE sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('rss','html_list','browser')),
  url TEXT NOT NULL,
  config TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1,
  last_checked_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id INTEGER REFERENCES sources(id),
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
  summary_vi TEXT,
  tags TEXT,
  terms TEXT,
  obsidian_path TEXT,
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
  stats TEXT,
  error TEXT
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT INTO settings (key, value) VALUES
  ('llm_model', 'claude-haiku-4-5'),
  ('notify_mode', 'immediate'),
  ('max_terms_per_article', '5'),
  ('backfill_limit', '10');

INSERT INTO sources (name, type, url, config) VALUES
  ('Anthropic Research', 'html_list', 'https://www.anthropic.com/research',
   '{"item_selector":"a[href^=\"/research/\"]","base_url":"https://www.anthropic.com","exclude_paths":["/research"]}'),
  ('Anthropic News', 'html_list', 'https://www.anthropic.com/news',
   '{"item_selector":"a[href^=\"/news/\"]","base_url":"https://www.anthropic.com","exclude_paths":["/news"]}');
```

QUAN TRỌNG: CSS selectors ở trên là điểm khởi đầu. BẮT BUỘC fetch HTML thật của https://www.anthropic.com/research và https://www.anthropic.com/news, kiểm tra cấu trúc DOM thực tế, chỉnh selector cho khớp, và lưu HTML vào test/fixtures/ để viết test.

## Watcher

- Interface: `SourceAdapter { discover(source, env): Promise<DiscoveredItem[]> }` với `DiscoveredItem { url, title?, published_at? }`
- rss.ts: fetch + parse bằng fast-xml-parser (RSS2 + Atom)
- html-list.ts: fetch HTML (User-Agent: `KnowledgeHubBot/1.0`), parse bằng linkedom, querySelectorAll(config.item_selector) → resolve absolute URL với base_url, loại trùng, loại exclude_paths
- browser.ts: throw new Error('browser adapter: phase 2')
- Flow: với mỗi source enabled → discover() → INSERT OR IGNORE articles (status='new') → update last_checked_at. Lỗi → ghi last_error, không throw. Ghi 1 row runs.
- Backfill: lần đầu chạy source mới lấy tối đa setting `backfill_limit` item mới nhất, đánh dấu phần còn lại `skipped`.
- 3 lần liên tiếp discover() trả rỗng cho source từng có bài → ghi last_error='SELECTOR_SUSPECT'

## Processor (state machine per article)

- Cron mỗi 5 phút: lấy tối đa 3 article status IN ('new', 'failed_retryable')
- Pipeline per article (mỗi bước idempotent, cập nhật status giữa các bước):
    1. status → 'processing'
    2. Fetch URL (timeout 15s, follow redirect)
    3. Extract: linkedom + @mozilla/readability → title, byline, textContent, excerpt. textContent < 300 chars → failed EXTRACT_TOO_SHORT
    4. Truncate textContent về 40000 chars
    5. LLM (xem bên dưới) → summary_vi, tags, terms, lang_detected
    6. Obsidian (xem bên dưới) → commit file, lưu obsidian_path
    7. LINE push nếu notify_mode='immediate'
    8. AnkiFlow push nếu terms.length > 0
    9. status → 'processed'
- Retry: network/5xx/429 → failed_retryable, retry_count++, max 3 → failed. 4xx/logic error → failed ngay.

## LLM layer

```ts
interface ArticleAnalysis {
    summary_vi: string[]; // 3–7 bullets tiếng Việt, mỗi bullet ≤ 2 câu
    tags: string[]; // 2–5, english-lowercase-kebab
    terms: Array<{
        term: string; // giữ nguyên ngôn ngữ gốc
        language: 'en' | 'ja';
        definition_hint_vi: string;
        context_quote: string; // ≤200 chars
    }>; // 0..max_terms_per_article
    lang_detected: 'en' | 'ja' | 'vi' | 'other';
}
```

- anthropic.ts: gọi POST https://api.anthropic.com/v1/messages bằng fetch thuần (KHÔNG SDK — giảm bundle).
- BẮT BUỘC dùng tool-use để ép JSON schema: 1 tool `submit_analysis` với input_schema từ zod → JSON Schema, tool_choice: {type:'tool', name:'submit_analysis'}. Parse + validate lại bằng zod; fail → retry 1 lần; fail nữa → throw.
- Model từ settings table (default claude-haiku-4-5), fallback env LLM_MODEL. max_tokens: 2048.
- System prompt (tiếng Anh, chỉ định output tiếng Việt cho summary/definition): nêu rõ tiêu chí term = "khái niệm kỹ thuật cụ thể người đọc IT nên nhớ lâu dài; loại trừ tên sản phẩm thuần túy, từ phổ thông".
- Swappable: interface LLMProvider { analyzeArticle(input, opts): Promise<ArticleAnalysis> } — anthropic.ts là implementation đầu tiên, sau này thêm gemini.ts mà không đổi caller.

## Obsidian writer (GitHub Contents API)

- Env: GITHUB_TOKEN (fine-grained PAT, scope Contents read/write), GITHUB_REPO (owner/name), GITHUB_BRANCH (default main), OBSIDIAN_INBOX_PATH (default inbox)
- Path: inbox/YYYY-MM-DD-<slug>.md (slug từ title, ASCII, ≤60 chars; trùng → thêm -2)
- PUT /repos/{repo}/contents/{path}, message "hub: add <title>". GET trước để lấy sha (idempotent retry).
- Template file Markdown:

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

<!-- Ghi chú cá nhân -->
```

## LINE (Hub channel riêng)

- Env: LINE_CHANNEL_SECRET, LINE_CHANNEL_ACCESS_TOKEN, LINE_USER_ID
- Webhook POST /line/webhook: verify x-line-signature (HMAC-SHA256, constant-time). Text chứa URL → INSERT OR IGNORE articles (ingest_channel='line', status='new') → reply "Đã lưu ✓" hoặc "URL đã tồn tại". Không có URL → reply hướng dẫn. Event khác → 200 bỏ qua.
- Push per article (immediate): text message:
