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
