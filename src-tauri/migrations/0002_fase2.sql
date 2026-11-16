-- Accounts: alleen label, provider en het pad van de profielmap. NOOIT tokens: die beheert de CLI zelf in die map.
ALTER TABLE ai_accounts ADD COLUMN profile_dir TEXT NOT NULL DEFAULT '';

ALTER TABLE projects ADD COLUMN default_account_id INTEGER REFERENCES ai_accounts(id) ON DELETE SET NULL;

-- Logboek van MCP-toolaanroepen. Bevat alleen metadata, geen inhoud en geen tokens.
CREATE TABLE mcp_calls (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id  INTEGER REFERENCES projects(id) ON DELETE CASCADE,
    tool        TEXT NOT NULL,
    ok          INTEGER NOT NULL,
    duration_ms INTEGER NOT NULL,
    summary     TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX idx_mcp_calls_project ON mcp_calls(project_id, id);
