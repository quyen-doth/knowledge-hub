ALTER TABLE sources
ADD COLUMN consecutive_empty_count INTEGER NOT NULL DEFAULT 0
CHECK (consecutive_empty_count >= 0);

UPDATE sources
SET config = json_set(
  config,
  '$.item_selector',
  'a[href^="/research/"]:not([href^="/research/team/"])'
)
WHERE name = 'Anthropic Research'
  AND url = 'https://www.anthropic.com/research'
  AND json_extract(config, '$.item_selector') = 'a[href^="/research/"]';
