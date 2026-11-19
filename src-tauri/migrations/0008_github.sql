-- GitHub-back-up per project. Hier staan NOOIT tokens: alleen de naam van de repository en wat er is gebeurd.
CREATE TABLE github_links (
    project_id        INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    owner             TEXT NOT NULL,
    repo              TEXT NOT NULL,
    private           INTEGER NOT NULL DEFAULT 1,
    branch            TEXT NOT NULL DEFAULT 'main',
    linked_at         INTEGER NOT NULL,
    last_backup_at    INTEGER,
    last_backup_commit TEXT,
    last_backup_count INTEGER,
    auto_backup       INTEGER NOT NULL DEFAULT 0,
    ai_ask            INTEGER NOT NULL DEFAULT 1,
    diverged          TEXT,
    problem           TEXT
);
