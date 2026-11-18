//! Koppelingen met diensten van de gebruiker (GitHub, Vercel, Supabase): eigen account, optioneel, met tokens alleen in de OS-keychain.
pub mod commands;
pub mod config;
pub mod device;
pub mod error;
pub mod http;
pub mod loopback;
pub mod manager;
pub mod oauth;
pub mod pkce;
pub mod provider;
pub mod providers;
pub mod store;
pub mod tokens;
pub mod vault;
