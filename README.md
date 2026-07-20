# Smart Knowledge Hub

個人向けのナレッジ収集・整理パイプラインです。Web記事を定期的に検出し、将来的には本文抽出、Anthropicによるベトナム語要約、Obsidianへの保存、LINE通知、AnkiFlowへの技術用語ドラフト登録までを自動化します。

> 現在はアプリ基盤、管理者認証、D1スキーマ、Watcherまで実装済みです。Processorと外部サービス連携は設計済み・未実装です。

## アーキテクチャ概要

```text
RSS / Atom / HTML sources
          │
          ▼
   Watcher（実装済み）
          │ discover / deduplicate
          ▼
 Cloudflare D1: articles(status=new)
          │
          ▼
   Processor（未実装）
 fetch → extract → LLM analysis
          │
          ├── GitHub Contents API → Obsidian
          ├── LINE → summary notification
          └── AnkiFlow → term drafts
```

Cloudflare Queuesは使わず、D1の状態管理とCron Triggersで小規模な個人利用に適した構成にしています。

## 実装状況

| 領域 | 状態 | 内容 |
| --- | --- | --- |
| Application foundation | 実装済み | Cloudflare Workers、Hono、Bun、Wrangler |
| Database | 実装済み | D1 migrations、typed query helpers、settings seed |
| Admin authentication | 実装済み | HMAC署名Cookie、ログイン、最小Dashboard |
| Watcher | 実装済み | RSS 2.0、Atom、HTML list、重複排除、backfill |
| Source health | 実装済み | エラー分離、run logging、`SELECTOR_SUSPECT` |
| Browser adapter | Placeholder | 将来のPlaywright/GitHub Actions連携用 |
| Processor / integrations | 未実装 | Anthropic、Obsidian、LINE、AnkiFlow |
| Full admin UI | 未実装 | Sources、Articles、Settings管理画面 |

## 技術スタック

- Cloudflare Workers / Hono / TypeScript strict mode
- Cloudflare D1 / SQLite / numbered SQL migrations
- Bun / Wrangler
- Vitest / `@cloudflare/vitest-pool-workers`
- `fast-xml-parser` / `linkedom`
- Hono JSX SSR（SPAフレームワーク不使用）

## 設計上のポイント

- AdapterはURLとメタデータの検出だけを担当し、記事処理とは分離しています。
- `articles.url` のUNIQUE制約とURL正規化で再実行時の重複を防ぎます。
- 初回取得は `backfill_limit` を適用し、対象外の記事も `skipped` として記録します。
- 1つのsourceが失敗しても他のsourceを継続し、結果を `runs` に保存します。
- 既に記事があるsourceで3回連続0件になると `SELECTOR_SUSPECT` を記録します。
- 外部入力は信頼せず、URL scheme、credential、config、response size、timeoutを境界で検証します。
- 将来のProcessorはatomic claim、stale recovery、checkpointによる再開を前提に設計しています。

詳しい判断と境界は [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) を参照してください。

## ローカル開発

```bash
bun install
bunx wrangler d1 migrations apply knowledge-hub --local
bun run dev
```

設定値は [`.dev.vars.example`](.dev.vars.example) を参考にし、実際のsecretは `.dev.vars` またはWrangler secret storageで管理します。

```bash
bun run typecheck
bun run test
bun run verify
bun run deploy:check
```

Production deploy、remote D1 migration、secret変更は明示的な承認後にのみ実行します。

## ドキュメント

| ファイル | 内容 |
| --- | --- |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | アーキテクチャと実装ロードマップ |
| [`docs/API.md`](docs/API.md) | HTTP・外部連携contract |
| [`docs/DATABASE.md`](docs/DATABASE.md) | D1 schemaとstate rules |
| [`docs/VERIFICATION.md`](docs/VERIFICATION.md) | テスト戦略とacceptance criteria |
| [`docs/CONTRIBUTING.md`](docs/CONTRIBUTING.md) | Git・開発workflow |

## スコープ外

- Multi-user対応
- Cloudflare Queues
- Web reader / highlight UI
- Browser adapter本体、Chrome extension
- RAG、embeddings、recommendation
- Obsidianノート自体のspaced repetition
