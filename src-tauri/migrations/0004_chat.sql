-- Chatgeschiedenis per project en het sessie-id van de AI-CLI (voor hervatten). Geen tokens of inhoud van geheimen.
CREATE TABLE chat_sessions (
    project_id INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    provider   TEXT NOT NULL,
    account_id INTEGER,
    session_id TEXT,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE chat_messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    kind       TEXT NOT NULL,
    payload    TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX idx_chat_messages_project ON chat_messages(project_id, id);
