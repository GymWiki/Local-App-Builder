-- In de appwinkel: gegevens van de app voor Google Play en de App Store en de versies van de teksten.
-- Hier staan NOOIT sleutels, wachtwoorden of inloggegevens van een demo-account (die staan in de OS-kluis).
CREATE TABLE store_apps (
    project_id INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    data       TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE store_tekst_versies (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    store      TEXT NOT NULL,
    taal       TEXT NOT NULL,
    veld       TEXT NOT NULL,
    tekst      TEXT NOT NULL,
    -- concept, goedgekeurd of vervangen
    status     TEXT NOT NULL,
    -- ai of gebruiker
    bron       TEXT NOT NULL,
    at         INTEGER NOT NULL
);
CREATE INDEX store_tekst_versies_veld ON store_tekst_versies(project_id, store, taal, veld, id DESC);
