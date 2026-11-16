CREATE TABLE projects (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    naam       TEXT NOT NULL,
    pad        TEXT NOT NULL UNIQUE,
    template   TEXT NOT NULL DEFAULT 'leeg',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- Leeg schema voor fase 2. Bewaar hier NOOIT tokens of API-keys: die horen in de OS-keychain.
CREATE TABLE ai_accounts (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    provider   TEXT NOT NULL,
    label      TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
