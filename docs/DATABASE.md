# D1 Database Contract — Smart Knowledge Hub

> Trạng thái: schema thiết kế phase 1. Chưa có migration thực thi. Khi `migrations/0001_init.sql` và tests tồn tại, migration/test trở thành nguồn sự thật cao hơn tài liệu này.

## Nguyên tắc

- Dùng Cloudflare D1/SQLite và numbered SQL migrations, không ORM.
- SQL luôn parameterized qua query helpers; không nối input vào câu SQL.
- JSON TEXT được encode/decode tập trung và validate bằng zod trước khi dùng.
- Không giữ transaction qua network call.
- Không sửa migration đã áp dụng; thay đổi schema luôn tạo migration số tiếp theo.
- Timestamp lưu ISO-8601 UTC hoặc SQLite UTC `datetime('now')`; timezone chỉ dùng khi hiển thị.

## Migration `0001_init.sql`

```sql
CREATE TABLE sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('rss', 'html_list', 'browser')),
  url TEXT NOT NULL,
  config TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  last_checked_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id INTEGER REFERENCES sources(id),
  ingest_channel TEXT NOT NULL DEFAULT 'watcher'
    CHECK (ingest_channel IN ('watcher', 'line', 'bookmarklet', 'admin')),
  url TEXT NOT NULL UNIQUE,
  title TEXT,
  author TEXT,
  published_at TEXT,
  lang_detected TEXT,
  status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN (
      'new',
      'processing',
      'processed',
      'failed',
      'failed_retryable',
      'skipped'
    )),
  retry_count INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
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
  kind TEXT NOT NULL CHECK (kind IN ('watcher', 'processor')),
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
```

`ARCHITECTURE.md` phần schema chỉ liệt kê ba seed đầu, nhưng phần watcher chốt `backfill_limit=10`; `prompt.md` cũng chứa seed này. Contract database hợp nhất hai phần bằng cách seed đủ bốn key.

## `sources`

| Column | Type | Quy tắc |
| --- | --- | --- |
| `id` | INTEGER | Primary key |
| `name` | TEXT | Tên hiển thị, bắt buộc |
| `type` | TEXT | `rss | html_list | browser` |
| `url` | TEXT | Base/feed URL HTTP(S) đã validate |
| `config` | JSON TEXT | Config theo adapter, mặc định `{}` |
| `enabled` | INTEGER | Boolean `0 | 1` |
| `last_checked_at` | TEXT nullable | Lần watcher hoàn tất gần nhất |
| `last_error` | TEXT nullable | Error code/tóm tắt đã redact |
| `created_at` | TEXT | UTC |

### Config theo adapter

```ts
type SourceType = 'rss' | 'html_list' | 'browser'

interface RssSourceConfig {}

interface HtmlListSourceConfig {
  item_selector: string
  link_attr?: string
  base_url?: string
  exclude_paths?: string[]
}

interface BrowserSourceConfig {}
```

JSON lưu trong `config` không lặp lại `type`. Helper chọn zod schema tương ứng dựa trên `sources.type`, sau đó application layer mới ghép chúng thành discriminated object; không tin JSON tùy ý.

Browser adapter phase 1 chỉ là placeholder báo `NotImplemented`; source loại này không được bật để chạy production.

Source đã có article tham chiếu không hard-delete qua admin. Dùng `enabled=0` để giữ lịch sử và foreign-key relationship.

## `articles`

### JSON columns

| Column | Application type |
| --- | --- |
| `summary_vi` | `string[] | null` |
| `tags` | `string[] | null` |
| `terms` | `ArticleAnalysis['terms'] | null` |

Không parse JSON rải rác trong routes/JSX. Query helper trả typed domain object hoặc structured decode error. Chỉ ghi cả analysis sau khi toàn bộ tool output pass schema; không lưu JSON một phần như checkpoint hoàn thành.

### URL và deduplication

- `articles.url` là unique ingestion key.
- Validate và normalize trước insert; chỉ nhận HTTP(S), cấm credential.
- Sau redirect, canonical/final URL phải được kiểm tra unique lại trước khi đổi URL.
- `INSERT OR IGNORE` chỉ được coi là duplicate sau khi URL đã validate; không nuốt lỗi schema/SQL khác.
- LINE delivery hoặc bookmarklet retry không tạo article thứ hai.

### State machine

```text
new ───────────────┐
                   ▼
failed_retryable → processing → processed
       │               │
       │               ├→ failed_retryable
       │               └→ failed
       └─ retry_count >= 3 → failed

skipped là terminal state.
```

Transition hợp lệ:

| From | To | Điều kiện |
| --- | --- | --- |
| `new` | `processing` | Conditional atomic claim thắng |
| `failed_retryable` | `processing` | Retry count còn dưới 3 và claim thắng |
| `processing` | `processed` | Tất cả bước/checkpoint cần thiết hoàn tất |
| `processing` | `failed_retryable` | Timeout/network/429/5xx; tăng retry count |
| `processing` | `failed` | Logic/input/auth/4xx hoặc retry cap đạt 3 |
| `processing` stale | `failed_retryable`/`failed` | Thu hồi lease và tăng retry count |
| `failed` | `new` | Admin Retry rõ ràng; reset retry count |
| discovered | `skipped` | Vượt backfill limit hoặc rule loại có chủ đích |

Không transition trực tiếp `new → processed` hoặc `failed_retryable → processed`.

### Atomic claim

Processor chọn tối đa ba candidate rồi claim từng row bằng conditional update:

```sql
UPDATE articles
SET status = 'processing',
    error = NULL,
    updated_at = datetime('now')
WHERE id = ?
  AND status IN ('new', 'failed_retryable')
  AND retry_count < 3;
```

Chỉ xử lý khi `changes() = 1`. Nếu bằng 0, invocation khác đã claim hoặc row không còn hợp lệ. Không thực hiện fetch trước khi claim thành công.

### Stale-processing recovery

Phase 1 dùng `updated_at` làm lease timestamp, không thêm column mới. Trước khi claim batch, thu hồi row `processing` cũ hơn 15 phút:

- Tăng `retry_count` một lần.
- Dưới retry cap: chuyển `failed_retryable`, error code `PROCESSING_STALE`.
- Đạt cap: chuyển `failed`.
- Ghi `updated_at` mới.

Mọi checkpoint processor phải cập nhật `updated_at`; external network call không nằm trong D1 transaction. Default 15 phút phải được test bằng injected clock và chỉ thay đổi qua quyết định được tài liệu hóa.

### Retry và checkpoints

- Retryable: timeout, network, HTTP 429, HTTP 5xx.
- Non-retryable: validation/input, extraction logic, auth/config, HTTP 4xx khác.
- Tối đa ba lần lỗi retryable; lần làm `retry_count` đạt 3 kết thúc ở `failed`.
- Admin Retry set `status='new'`, `retry_count=0`, `error=NULL` nhưng giữ analysis và downstream checkpoint hợp lệ để resume.

Checkpoint:

| Column | Ý nghĩa resume |
| --- | --- |
| `summary_vi/tags/terms` hợp lệ | Không gọi LLM lại |
| `obsidian_path` | Không tạo note mới; reconcile/update note cũ |
| `line_notified_at` | Không chủ động push LINE lại |
| `ankiflow_pushed_at` | Không gửi term draft lại |

Timestamp không đảm bảo exactly-once: service ngoài có thể thành công trước khi local checkpoint được ghi. GitHub dùng SHA/path để reconcile; AnkiFlow dedupe theo term; LINE vẫn là at-least-once và có rủi ro duplicate đã biết.

## `runs`

Mỗi watcher/processor invocation tạo một run:

```ts
interface WatcherRunStats {
  sources_checked: number
  new_articles: number
  skipped: number
  failed: number
}

interface ProcessorRunStats {
  claimed: number
  processed: number
  failed_retryable: number
  failed: number
}
```

`stats` là JSON TEXT theo `kind` và được validate khi đọc. `error` chỉ chứa code/tóm tắt đã redact; không lưu token, article body hoặc third-party response đầy đủ.

Run phải ghi `finished_at` cả khi một item thất bại; lỗi per-article nằm ở article, lỗi invocation-level nằm ở run.

## `settings`

Chỉ cho phép các key phase 1:

| Key | Default | Validation |
| --- | --- | --- |
| `llm_model` | `claude-haiku-4-5` | Non-empty model id |
| `notify_mode` | `immediate` | `immediate | daily_digest` |
| `max_terms_per_article` | `5` | Integer có giới hạn an toàn; không vượt contract batch AnkiFlow |
| `backfill_limit` | `10` | Integer không âm |

Không lưu secret, repo token, password, LINE credential hoặc session key trong table này. Settings admin dùng allowlist; không cung cấp generic arbitrary-key editor.

## Seed sources

Migration seed hai nguồn ban đầu:

```sql
INSERT INTO sources (name, type, url, config) VALUES
  (
    'Anthropic Research',
    'html_list',
    'https://www.anthropic.com/research',
    '{"item_selector":"a[href^=\"/research/\"]","base_url":"https://www.anthropic.com","exclude_paths":["/research"]}'
  ),
  (
    'Anthropic News',
    'html_list',
    'https://www.anthropic.com/news',
    '{"item_selector":"a[href^=\"/news/\"]","base_url":"https://www.anthropic.com","exclude_paths":["/news"]}'
  );
```

Các selector chỉ là điểm khởi đầu. Khi triển khai, phải kiểm tra live HTML, lưu fixture có ngày và khóa behavior bằng tests trước khi coi migration/config là hợp lệ.

Lần chạy đầu insert tối đa `backfill_limit` item mới nhất ở trạng thái `new`; các item còn lại được lưu `skipped` để không bị discover lại vô hạn.

## Migration workflow

1. Đọc schema hiện tại, query helpers, types và tests.
2. Tạo migration số tiếp theo; không sửa migration đã áp dụng.
3. Mô tả forward behavior, data backfill và compatibility.
4. Chạy migrations từ database rỗng.
5. Chạy upgrade test từ schema/fixture trước đó và xác nhận giữ dữ liệu.
6. Chạy D1 local integration tests.
7. Cập nhật tài liệu/types/query helpers trong cùng thay đổi.
8. Remote migration cần xác nhận ngay trước khi thực hiện.

Không rollback bằng cách xóa/chỉnh migration history. Nếu cần khắc phục, tạo forward-fix migration mới.

## Checklist khi thay đổi database

- [ ] Column/type/default/CHECK constraint được cập nhật trong tài liệu và type.
- [ ] JSON column có codec/schema tập trung.
- [ ] Query mới parameterized và có index phù hợp nếu cần.
- [ ] State transition vẫn giữ atomic claim và retry cap.
- [ ] Migration chạy được từ empty database và upgrade fixture.
- [ ] Không giữ transaction qua network call.
- [ ] Không lưu secret hoặc dữ liệu không cần thiết.
- [ ] Remote migration chưa được chạy nếu chưa có xác nhận.
