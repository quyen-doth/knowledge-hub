# Hướng dẫn đóng góp

## Trạng thái repository

Repository hiện chưa được khởi tạo Git và chưa có application scaffold. Tài liệu này định nghĩa workflow sẽ áp dụng khi Git được tạo; không ngụ ý branch protection, CI hoặc Git hooks đã tồn tại.

## Nguyên tắc

- `main` là nhánh ổn định và là base của pull request.
- Mọi thay đổi dùng feature branch ngắn hạn; không commit hoặc push trực tiếp vào `main`.
- Thay đổi phải nhỏ, có mục tiêu rõ và không trộn refactor ngoài phạm vi.
- Code/test có thể chạy được là nguồn sự thật cao hơn tài liệu; thay đổi contract hoặc schema phải cập nhật tài liệu trong cùng PR.
- Dùng Bun cho dependency và scripts; không dùng npm hoặc pnpm.
- Không thêm AI attribution, `Co-Authored-By` tự động hoặc footer “Generated with …”.

## Khởi tạo Git lần đầu

Chỉ thực hiện khi người dùng yêu cầu khởi tạo repository:

```bash
git init -b main
git add .gitignore
git commit -m "chore: khởi tạo repository"
```

Thiết lập remote, push và branch protection là external side effect, cần xác nhận trước khi thực hiện.

## Branch workflow

Luôn đồng bộ `main` trước khi tạo branch nếu remote đã tồn tại:

```bash
git switch main
git pull --ff-only origin main
git switch -c feat/article-watcher
```

Tên branch dùng prefix và slug tiếng Anh kebab-case:

| Prefix | Dùng cho |
| --- | --- |
| `feat/` | Tính năng mới |
| `fix/` | Sửa lỗi |
| `docs/` | Chỉ thay đổi tài liệu |
| `refactor/` | Tái cấu trúc không đổi hành vi |
| `test/` | Test/fixture |
| `chore/` | Tooling, dependency, config |

Không tự động `git pull` khi working tree bẩn. Không dùng force push lên branch có người khác cùng làm nếu chưa thống nhất.

## Conventional Commits

Format:

```text
<type>(<scope>)?: <tóm tắt tiếng Việt>

<body tiếng Việt, giải thích lý do khi cần>
```

- `type` và `scope` viết tiếng Anh; subject/body viết tiếng Việt có dấu.
- Subject dùng câu mệnh lệnh, không chấm cuối, nên tối đa 72 ký tự.
- Một commit chỉ chứa một nhóm thay đổi logic.

Các type chính:

| Type | Ý nghĩa |
| --- | --- |
| `feat` | Thêm khả năng mới |
| `fix` | Sửa hành vi sai |
| `docs` | Chỉ sửa tài liệu |
| `refactor` | Đổi cấu trúc, không đổi contract |
| `test` | Thêm/sửa test |
| `chore` | Tooling, config, dependency |
| `perf` | Cải thiện hiệu năng |

Ví dụ:

```text
feat(watcher): thêm adapter RSS và Atom
fix(processor): ngăn hai cron claim cùng một article
docs: mô tả contract term draft với AnkiFlow
```

## Chuẩn bị commit

1. Đọc `git status`, diff working tree và staged diff.
2. Chỉ stage file liên quan; không dùng `git add -A` khi có thay đổi ngoài phạm vi.
3. Chạy kiểm chứng hẹp nhất, sau đó `bun run verify` khi script đã tồn tại.
4. Xác nhận không có secret, `.dev.vars`, output build, fixture chứa dữ liệu nhạy cảm hoặc thay đổi người dùng không liên quan.
5. Commit bằng Conventional Commits; không bypass hooks nếu hook báo lỗi.

Agent không được tự commit chỉ vì đã sửa xong. Chỉ commit khi người dùng yêu cầu rõ ràng hoặc gọi command `/commit`.

## Pull request

PR dùng base `main`. Title theo Conventional Commits và viết tiếng Việt, ví dụ:

```text
feat(processor): hoàn thiện state machine xử lý bài viết
```

Body dùng cấu trúc:

```markdown
## Tóm tắt

[Mục tiêu và lý do]

## Thay đổi

- [Thay đổi chính]

## Kiểm chứng

- `bun run ...` — pass/fail
- Kiểm tra thủ công nếu có

## Rủi ro và giới hạn

- [Retry, migration, external side effect hoặc phần chưa kiểm chứng]

## Checklist

- [ ] Không chứa secret hoặc dữ liệu nhạy cảm
- [ ] Test và tài liệu liên quan đã cập nhật
- [ ] Không có thay đổi ngoài phạm vi
```

Trước khi mở PR:

- Review toàn bộ `git diff main...HEAD` và `git log main..HEAD`.
- Push branch cần xác nhận nếu yêu cầu hiện tại chưa bao gồm external write.
- Chỉ dùng `gh pr create --base main` khi người dùng yêu cầu mở PR.

## Verification gate

Khi scaffold đã tồn tại, PR phải có bằng chứng phù hợp theo [`VERIFICATION.md`](VERIFICATION.md):

1. Typecheck/lint hoặc build check.
2. Unit/integration test liên quan.
3. Full `bun run verify` trước khi merge.
4. Migration local và Worker dry-run nếu chạm D1/bindings/runtime.
5. Không gọi Anthropic, GitHub, LINE hoặc AnkiFlow thật từ automated tests.

Nếu một lệnh không tồn tại hoặc không chạy được, ghi rõ “chưa kiểm chứng” cùng nguyên nhân; không thay bằng tuyên bố pass.

## Khi nào phải cập nhật tài liệu

| Thay đổi | Tài liệu cần kiểm tra |
| --- | --- |
| Quyết định kiến trúc hoặc phase boundary | `ARCHITECTURE.md` |
| Route, auth, payload, status/error contract | `API.md` |
| Table, column, enum, state transition, migration | `DATABASE.md` |
| Command, env, runbook, giới hạn vận hành | `README.md`, `REFERENCE.md` |
| Test layer hoặc acceptance scenario | `VERIFICATION.md` |
| Agent workflow/convention | `AGENTS.md`, `.claude/`, `.codex/` |

`prompt.md` là đầu vào lịch sử và không được cập nhật như tài liệu sống.

## Hành động cần xác nhận ngay trước khi chạy

- Production deploy hoặc rollback.
- D1 migration trên remote database.
- Tạo/thay đổi Wrangler secrets.
- Gửi LINE thật, ghi Obsidian vault thật hoặc tạo term draft thật.
- Push branch, mở PR hoặc thao tác repository remote nếu chưa được yêu cầu.
- Xóa dữ liệu, migration phá hủy hoặc mở rộng phạm vi sang repo AnkiFlow.
