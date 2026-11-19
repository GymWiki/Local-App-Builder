-- Online zetten met Vercel. Hier staan NOOIT tokens of waarden van omgevingsvariabelen (die staan in de OS-kluis): alleen namen en uitkomsten.
CREATE TABLE vercel_links (
    project_id   INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    vproject_id  TEXT NOT NULL,
    name         TEXT NOT NULL,
    framework    TEXT,
    linked_at    INTEGER NOT NULL
);

CREATE TABLE vercel_deployments (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id    INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    at            INTEGER NOT NULL,
    target        TEXT NOT NULL,
    deployment_id TEXT,
    url           TEXT,
    state         TEXT NOT NULL,
    checkpoint    TEXT,
    code          TEXT NOT NULL DEFAULT ''
);
CREATE INDEX vercel_deployments_project ON vercel_deployments(project_id, id DESC);

CREATE TABLE vercel_env (
    project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    kind        TEXT NOT NULL,
    source      TEXT NOT NULL DEFAULT 'handmatig',
    envs        TEXT NOT NULL DEFAULT 'production,preview',
    set_at      INTEGER NOT NULL,
    pushed_at   INTEGER,
    PRIMARY KEY (project_id, name)
);
