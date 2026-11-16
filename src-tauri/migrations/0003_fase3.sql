-- Laatste check-resultaten per project (alleen samenvatting en foutregels, geen tokens).
CREATE TABLE check_runs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    ok         INTEGER NOT NULL,
    steps_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX idx_check_runs_project ON check_runs(project_id, id);
