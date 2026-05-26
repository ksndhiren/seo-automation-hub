CREATE TABLE IF NOT EXISTS dashboard_jobs (
  job_id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  site_name TEXT NOT NULL,
  topic TEXT NOT NULL,
  primary_keyword TEXT NOT NULL,
  secondary_keywords_json TEXT NOT NULL,
  target_url TEXT NOT NULL,
  target_audience TEXT NOT NULL,
  status TEXT NOT NULL,
  word_count TEXT,
  brief_summary TEXT NOT NULL,
  outline_json TEXT NOT NULL,
  draft_json TEXT NOT NULL DEFAULT 'null',
  final_checklist_json TEXT NOT NULL,
  manual_plagiarism_status TEXT NOT NULL,
  flagged_sections_note TEXT NOT NULL DEFAULT '',
  selected_images_json TEXT NOT NULL DEFAULT '[]',
  meta_title TEXT NOT NULL,
  meta_description TEXT NOT NULL,
  activity_json TEXT NOT NULL,
  publish_branch TEXT NOT NULL,
  publish_path TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dashboard_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL,
  action TEXT NOT NULL,
  reviewer TEXT NOT NULL,
  comment TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (job_id) REFERENCES dashboard_jobs(job_id)
);

CREATE TABLE IF NOT EXISTS dashboard_performance (
  id TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'ga4'
);
