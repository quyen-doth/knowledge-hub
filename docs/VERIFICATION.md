# Chiến lược kiểm chứng

> Trạng thái: verification contract cho phase 1. Repository chưa có application scaffold hoặc test runner; các lệnh bên dưới chỉ trở thành bằng chứng khi chúng tồn tại và đã được chạy thật.

## Mục tiêu

Kiểm chứng Knowledge Hub tập trung vào các rủi ro có thể làm mất bài, xử lý trùng, gửi side effect lặp, kẹt job, rò secret hoặc phá contract với dịch vụ ngoài. Không xây framework kiểm chứng UI tùy biến như AnkiFlow; dùng test runner chuẩn và Worker runtime gần production.

Nguyên tắc:

- Test hành vi do dự án sở hữu, không test lại internals của Hono, D1, zod hoặc SDK ngoài.
- Automated tests phải deterministic, không gửi request thật tới Anthropic, GitHub, LINE hoặc AnkiFlow.
- Fixture web phải được lưu cục bộ, có ngày thu thập và nguồn; live fetch chỉ dùng để xác nhận selector khi triển khai/cập nhật adapter.
- Mỗi kết quả báo cáo phải kèm lệnh thật, trạng thái pass/fail và phần chưa kiểm chứng.

## Contract lệnh dự kiến

Scaffold phải cung cấp các script ổn định sau:

```bash
bun run typecheck       # TypeScript strict mode
bun run test            # Unit và Worker integration tests
bun run test:watch      # Vòng lặp local
bun run verify          # Typecheck + toàn bộ automated tests + deploy dry-run
bun run deploy:check    # Wrangler deploy --dry-run, không ghi production
```

Không ghi lệnh này là “pass” trước khi `package.json` và test suite tồn tại.

## Các lớp kiểm chứng

### 1. Static và configuration

- TypeScript strict mode, không `any` tại boundary.
- Zod schema cho bindings, inbound request và LLM tool output.
- `wrangler.toml` parse được, cron/bindings/migration path đúng.
- Worker bundle dry-run không kéo Node-only API ngoài ý muốn.
- Không có secret thật, absolute personal path hoặc `.dev.vars` trong tracked files.

### 2. Unit tests

Chạy trong môi trường nhanh, không D1 thật:

- URL validation/normalization, canonical URL và duplicate key.
- Slug generation, collision suffix và YAML frontmatter escaping.
- Retry classification, retry cap và structured errors.
- `ArticleAnalysis` schema, term limits và Anthropic tool parsing.
- LINE signature compare trên raw body.
- RSS 2.0 và Atom parser, malformed/empty feed.
- HTML list selector với fixtures.
- Mapping payload Knowledge Hub → AnkiFlow.

### 3. Worker integration tests

Dùng Vitest với `@cloudflare/vitest-pool-workers` và isolated D1:

- Chạy toàn bộ migration từ database rỗng và seed đúng dữ liệu.
- Hono routes đọc đúng bindings và middleware/auth.
- Atomic claim: hai processor invocation cạnh tranh chỉ có một invocation sở hữu article.
- Thu hồi `processing` quá hạn và chuyển sang retry/final failure đúng giới hạn.
- Scheduled router gọi đúng watcher/processor/digest theo cron expression.
- Admin form actions dùng cùng service/query helpers với scheduled handlers.

### 4. Contract tests với integration mocks

Mock HTTP ở ranh giới fetch và xác nhận request/response:

- Anthropic: tool choice bắt buộc, schema sai lần đầu rồi đúng, schema sai hai lần, timeout/429/5xx.
- GitHub: create, path conflict, GET SHA rồi update, retry sau partial local failure.
- LINE: invalid signature, URL đầu tiên, text không URL, event không liên quan, reply/push/digest, quota guard.
- AnkiFlow: 200 created/skipped, 400 và 422 không retry, 401 config failure, timeout/5xx retry.

Không snapshot token, signature, cookie, complete article body hoặc response ngoài có thể chứa dữ liệu nhạy cảm.

### 5. Admin E2E

Chạy trên local Wrangler Worker với D1 local và mocked external clients:

- Login đúng/sai, cookie flags và session hết hạn/tamper.
- Unauthenticated redirect; state-changing action bị chặn khi origin/CSRF không hợp lệ.
- Dashboard hiển thị số liệu/lỗi gần nhất.
- Sources CRUD, enabled toggle, Test chỉ trả tối đa 5 item và không insert.
- Articles pagination/filter/detail; Retry reset `status` và `retry_count` đúng quy tắc.
- Settings validation và bookmarklet chỉ chứa placeholder/test token.
- Dữ liệu HTML/YAML độc hại được escape khi render.

Playwright MCP trong `.codex/config.toml` chỉ hỗ trợ agent khám phá và kiểm tra thủ công. CI E2E phải dùng dependency/script có version pin trong project, không phụ thuộc MCP.

## Ma trận processor bắt buộc

| Điểm lỗi | Trạng thái/checkpoint mong đợi | Retry tiếp theo |
| --- | --- | --- |
| Fetch timeout/5xx | `failed_retryable`, tăng `retry_count` | Fetch lại |
| Extract quá ngắn | `failed`, `EXTRACT_TOO_SHORT` | Không |
| LLM chưa lưu | Không có `summary_vi/tags/terms` hợp lệ | Gọi LLM lại |
| LLM đã lưu, Obsidian chưa ghi | Analysis giữ nguyên | Bắt đầu từ Obsidian |
| Obsidian đã ghi, local chưa checkpoint | GitHub SHA/path flow không tạo note vô hạn | Reconcile rồi tiếp tục |
| Obsidian checkpoint, LINE chưa gửi | Không ghi lại Obsidian | Gửi LINE |
| LINE đã gửi, timestamp chưa lưu | Có khả năng gửi lặp được ghi nhận | At-least-once, không tuyên bố exactly-once |
| LINE checkpoint, AnkiFlow chưa gửi | Không gửi LINE lại | Gửi term draft |
| AnkiFlow timeout sau khi nhận | Duplicate được AnkiFlow skip | Retry bounded |
| Tất cả checkpoint hoàn tất | `processed` | Không |

Mỗi boundary phải có test khởi tạo row ở đúng trạng thái trung gian rồi chạy processor lại.

## Watcher và fixtures

Fixtures bắt buộc cho:

- Anthropic Research HTML.
- Anthropic News HTML.
- Một RSS 2.0 feed.
- Một Atom feed.
- Empty/malformed response.
- Relative URL, duplicate URL và canonical redirect.

Khi selector live trả rỗng ba lần liên tiếp cho source từng có article, watcher ghi `SELECTOR_SUSPECT`; cần test cả reset lỗi sau lần discover thành công.

Lần chạy đầu của source áp dụng `backfill_limit=10`: chỉ insert các item mới nhất trong giới hạn và đánh dấu phần còn lại `skipped` theo contract database.

## Security scenarios

- Prompt injection nằm trong title, metadata hoặc article body không thay đổi system behavior.
- URL có credential, scheme khác HTTP(S), redirect loop, body quá lớn hoặc timeout bị chặn.
- SQL input và selector config không thoát parameter/validation boundary.
- LINE dùng raw body chính xác trước parse; compare an toàn khi chữ ký/token khác độ dài.
- Admin cookie có `httpOnly`, `secure` ở production và `sameSite`; tampered cookie bị từ chối.
- Frontmatter chứa dấu nháy, newline, `---`, tag lạ hoặc Unicode không phá cấu trúc note.
- Log không chứa secret, session, signature hoặc nguyên article body.

## Kiểm chứng thủ công có kiểm soát

Chỉ chạy sau automated tests và cần xác nhận ngay trước side effect thật:

1. Deploy Worker preview và chạy migration trên D1 test/preview.
2. Test hai selector Anthropic bằng live HTML, sau đó cập nhật fixture.
3. Xử lý một article thật qua Anthropic và vault test.
4. Gửi một LINE message tới test channel/user.
5. Gửi một term draft tới AnkiFlow test target và xác nhận draft xuất hiện.

Không dùng production vault/channel/user cho smoke test nếu người dùng chưa chỉ định rõ.

## Báo cáo kiểm chứng

Kết quả bàn giao dùng format:

```text
Verification
- `bun run typecheck` — PASS
- `bun run test -- watcher` — PASS (12 tests)
- `bun run verify` — FAIL: deploy dry-run thiếu D1 binding
- Manual LINE/AnkiFlow — NOT RUN: không có phê duyệt external side effect
```

Không đổi “NOT RUN” thành pass. Khi test fail, báo root cause đã biết, phạm vi ảnh hưởng và bước tiếp theo; không chỉ dán raw output.

## Acceptance trước merge

- [ ] Migration chạy từ database rỗng và giữ dữ liệu khi upgrade.
- [ ] Test concurrency, stale recovery và partial-failure boundaries đều có.
- [ ] External clients được mock trong automated suite.
- [ ] Route/auth/schema thay đổi đã cập nhật `API.md` hoặc `DATABASE.md`.
- [ ] Full `bun run verify` pass, hoặc PR ghi rõ blocker và được chấp nhận.
- [ ] Không có secret, real external side effect hoặc tuyên bố exactly-once sai.
