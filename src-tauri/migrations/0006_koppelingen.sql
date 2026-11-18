-- Koppelingen met diensten (GitHub, Vercel, Supabase). Hier staat NOOIT een token of geheim: alleen de status en de accountnaam.
-- De toegang zelf staat uitsluitend in de OS-keychain.
CREATE TABLE connections (
    provider     TEXT PRIMARY KEY,
    status       TEXT NOT NULL,
    account      TEXT,
    error        TEXT,
    method       TEXT,
    connected_at INTEGER,
    expires_at   INTEGER
);
