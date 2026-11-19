-- Een kant-en-klare tabel voor de bestellingen van de webshop. Studio past dit pas toe als jij het goedvindt (Wat je app onthoudt).
-- De beveiliging per rij staat aan en er is bewust nog geen beleid: zonder beleid kan niemand erbij.
-- Laat de AI het beleid schrijven dat past bij wat jij wilt (bijvoorbeeld: bezoekers mogen alleen een bestelling plaatsen).
create table public.bestellingen (
  id         uuid primary key default gen_random_uuid(),
  naam       text not null,
  email      text not null,
  totaal_cent integer not null check (totaal_cent >= 0),
  gemaakt_op timestamptz not null default now()
);
alter table public.bestellingen enable row level security;
