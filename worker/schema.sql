-- Private Markdown resumes for the GEX Talents D1 Free database.
-- Apply once from Cloudflare D1 SQL Console / wrangler d1 execute.
-- Do not publish a SELECT endpoint for candidate curricula.
CREATE TABLE IF NOT EXISTS candidate_resumes (
  id TEXT NOT NULL PRIMARY KEY,
  vacancy_id INTEGER NOT NULL,
  application_id INTEGER NOT NULL,
  markdown TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (vacancy_id, application_id)
);

CREATE INDEX IF NOT EXISTS candidate_resumes_application
ON candidate_resumes (application_id, vacancy_id);
