CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS call_marks (
  id TEXT PRIMARY KEY,
  called_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS photos (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime TEXT NOT NULL,
  uploader TEXT NOT NULL,
  authorized INTEGER NOT NULL CHECK (authorized = 1),
  uploaded_at TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS photos_by_lead ON photos(lead_id);
