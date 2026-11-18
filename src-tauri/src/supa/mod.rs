#![allow(dead_code)] // tijdelijk: de acties en MCP-tools sluiten hier stap voor stap op aan (wordt aan het eind verwijderd)
//! Supabase-koppeling: risicoklassen, bedieningsniveaus en (later) de acties zelf. Alles via Studio; de AI ziet nooit een sleutel.
pub mod api;
pub mod classify;
pub mod engine;
pub mod policy;
pub mod store;
pub mod undo;
