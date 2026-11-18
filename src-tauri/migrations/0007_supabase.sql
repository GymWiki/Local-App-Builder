-- Supabase-koppeling per project. Hier staan NOOIT sleutels of wachtwoorden: alleen de referentie, het niveau en het actielog.
CREATE TABLE supabase_links (
    project_id     INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    ref            TEXT NOT NULL,
    name           TEXT NOT NULL DEFAULT '',
    region         TEXT NOT NULL DEFAULT '',
    level          TEXT NOT NULL DEFAULT 'voorzichtig',
    full_until     INTEGER,
    full_secs      INTEGER NOT NULL DEFAULT 3600,
    linked_at      INTEGER NOT NULL
);

-- Wat de AI (of de gebruiker) in de database heeft gedaan, in gewone woorden, met de gegevens om het ongedaan te maken.
CREATE TABLE db_actions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    at         INTEGER NOT NULL,
    tool       TEXT NOT NULL,
    class      INTEGER NOT NULL,
    level      TEXT NOT NULL,
    status     TEXT NOT NULL,
    summary    TEXT NOT NULL DEFAULT '[]',
    sql        TEXT,
    detail     TEXT NOT NULL DEFAULT '{}',
    undo_kind  TEXT,
    undo_data  TEXT,
    undone     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX db_actions_project ON db_actions(project_id, id DESC);
