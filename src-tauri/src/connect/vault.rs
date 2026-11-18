//! De kluis: geheimen staan uitsluitend in de OS-keychain (Windows Credential Manager, macOS Keychain, Secret Service).
//! Nooit in SQLite, projectbestanden of logs. Elke dienst krijgt een eigen `ProviderVault` en kan dus niet bij andermans geheimen.
use super::error::ConnectError;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

pub trait SecretStore: Send + Sync {
    fn get(&self, key: &str) -> Result<Option<String>, ConnectError>;
    fn set(&self, key: &str, value: &str) -> Result<(), ConnectError>;
    fn delete(&self, key: &str) -> Result<(), ConnectError>;
}

const SERVICE: &str = "Studio";

/// De echte kluis (crate `keyring`).
pub struct KeyringStore;

impl KeyringStore {
    fn entry(key: &str) -> Result<keyring::Entry, ConnectError> {
        keyring::Entry::new(SERVICE, key).map_err(|_| ConnectError::Vault)
    }
}

impl SecretStore for KeyringStore {
    fn get(&self, key: &str) -> Result<Option<String>, ConnectError> {
        match Self::entry(key)?.get_password() {
            Ok(v) => Ok(Some(v)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err(ConnectError::Vault),
        }
    }
    fn set(&self, key: &str, value: &str) -> Result<(), ConnectError> {
        Self::entry(key)?.set_password(value).map_err(|_| ConnectError::Vault)
    }
    fn delete(&self, key: &str) -> Result<(), ConnectError> {
        match Self::entry(key)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err(ConnectError::Vault),
        }
    }
}

/// Een kluis in het geheugen, voor tests en voor het geval de OS-kluis ontbreekt (dan blijft niets bewaard na afsluiten).
#[derive(Default)]
pub struct MemoryStore(Mutex<HashMap<String, String>>);

impl SecretStore for MemoryStore {
    fn get(&self, key: &str) -> Result<Option<String>, ConnectError> {
        Ok(self.0.lock().map_err(|_| ConnectError::Vault)?.get(key).cloned())
    }
    fn set(&self, key: &str, value: &str) -> Result<(), ConnectError> {
        self.0.lock().map_err(|_| ConnectError::Vault)?.insert(key.into(), value.into());
        Ok(())
    }
    fn delete(&self, key: &str) -> Result<(), ConnectError> {
        self.0.lock().map_err(|_| ConnectError::Vault)?.remove(key);
        Ok(())
    }
}

/// De kluis van één dienst: sleutels krijgen automatisch het voorvoegsel `connect/<dienst>/`.
#[derive(Clone)]
pub struct ProviderVault {
    store: Arc<dyn SecretStore>,
    provider: String,
}

impl ProviderVault {
    pub fn new(store: Arc<dyn SecretStore>, provider: &str) -> Self {
        Self { store, provider: provider.to_string() }
    }
    fn key(&self, name: &str) -> String {
        format!("connect/{}/{}", self.provider, name)
    }
    pub fn get(&self, name: &str) -> Result<Option<String>, ConnectError> {
        self.store.get(&self.key(name))
    }
    pub fn set(&self, name: &str, value: &str) -> Result<(), ConnectError> {
        self.store.set(&self.key(name), value)
    }
    pub fn delete(&self, name: &str) -> Result<(), ConnectError> {
        self.store.delete(&self.key(name))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn diensten_zien_elkaars_geheimen_niet() {
        let store: Arc<dyn SecretStore> = Arc::new(MemoryStore::default());
        let gh = ProviderVault::new(store.clone(), "github");
        let vc = ProviderVault::new(store.clone(), "vercel");
        gh.set("tokens", "geheim-gh").unwrap();
        assert_eq!(gh.get("tokens").unwrap().as_deref(), Some("geheim-gh"));
        assert_eq!(vc.get("tokens").unwrap(), None);
        // Ook niet door een slimme sleutelnaam.
        assert_eq!(vc.get("../github/tokens").unwrap(), None);
        gh.delete("tokens").unwrap();
        assert_eq!(gh.get("tokens").unwrap(), None);
        gh.delete("tokens").unwrap(); // verwijderen van iets dat er niet is, is geen fout
    }
}
