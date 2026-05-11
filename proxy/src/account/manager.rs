use crate::db::{Account, Database};
use anyhow::Result;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

pub struct AccountManager {
    db: Arc<Database>,
    counter: AtomicUsize,
    strategy: String,
}

impl AccountManager {
    pub fn new(db: Arc<Database>, strategy: &str) -> Self {
        Self {
            db,
            counter: AtomicUsize::new(0),
            strategy: strategy.to_string(),
        }
    }

    /// Pick next account based on rotation strategy
    pub fn next_account(&self) -> Result<Option<Account>> {
        let accounts = self.db.get_active_accounts()?;
        if accounts.is_empty() {
            return Ok(None);
        }

        let account = match self.strategy.as_str() {
            "round_robin" => {
                let idx = self.counter.fetch_add(1, Ordering::Relaxed) % accounts.len();
                accounts[idx].clone()
            }
            "least_used" => {
                accounts.iter()
                    .min_by_key(|a| a.request_count)
                    .cloned()
                    .unwrap()
            }
            "random" => {
                use rand::Rng;
                let idx = rand::thread_rng().gen_range(0..accounts.len());
                accounts[idx].clone()
            }
            _ => accounts[0].clone(),
        };

        Ok(Some(account))
    }

    pub fn mark_used(&self, id: i64, success: bool) -> Result<()> {
        self.db.update_account_after_use(id, success)
    }

    pub fn get_all(&self) -> Result<Vec<Account>> {
        self.db.get_accounts()
    }

    pub fn add(&self, api_key: &str, email: &str, upstream_url: &str) -> Result<i64> {
        self.db.add_account(api_key, email, upstream_url)
    }

    pub fn remove(&self, id: i64) -> Result<()> {
        self.db.delete_account(id)
    }

    pub fn set_status(&self, id: i64, status: &str) -> Result<()> {
        self.db.update_account_status(id, status)
    }
}
