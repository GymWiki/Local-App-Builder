# Regels voor Fragments UI
- Importeer alleen uit `@usefragments/ui`. Maak geen eigen knoppen, velden of dialogen: gebruik `Button`, `Input`, `Field`, `Select`, `Dialog`.
- Indeling met `Stack`, `Grid` en `Box`; tekst met `Text`. Geen losse `div`-stijlen voor ruimte.
- Samengestelde onderdelen met punten: `Card.Header`, `Card.Body`, `Field.Label`.
- Kleur en ruimte komen uit tokens (`var(--fui-…)`), nooit uit losse waarden.
- Alleen een volledig formulier met `Form` en `Field`; elk veld heeft een label.
