-- Homescherm en werkruimte: wanneer een project het laatst gebruikt is, en de indeling van de werkruimte per project.
ALTER TABLE projects ADD COLUMN last_used_at TEXT;

-- De indeling is een JSON-tekst met een eigen versienummer; de frontend migreert of reset oude versies.
CREATE TABLE project_layouts (
    project_id INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    versie     INTEGER NOT NULL,
    json       TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
