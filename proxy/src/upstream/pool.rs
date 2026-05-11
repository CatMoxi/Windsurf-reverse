use crate::account::manager::AccountManager;
use crate::config::Config;
use crate::db::Account;
use crate::upstream::windsurf::WindsurfClient;
use anyhow::{anyhow, Result};
use std::sync::Arc;

/// Account pool: picks accounts + resolves upstream URL
pub struct AccountPool {
    pub manager: Arc<AccountManager>,
    pub client: WindsurfClient,
    pub default_upstream: String,
}

impl AccountPool {
    pub fn new(config: &Config, manager: Arc<AccountManager>) -> Self {
        let client = WindsurfClient::new(
            config.upstream.timeout,
            &config.upstream.metadata.ide_name,
            &config.upstream.metadata.ide_version,
            &config.upstream.metadata.extension_version,
        );
        Self {
            manager,
            client,
            default_upstream: config.upstream.url.clone(),
        }
    }

    /// Pick next account and return (account, upstream_url)
    pub fn next(&self) -> Result<(Account, String)> {
        let account = self.manager.next_account()?
            .ok_or_else(|| anyhow!("No active accounts available"))?;

        let upstream = if account.upstream_url.is_empty() {
            self.default_upstream.clone()
        } else {
            account.upstream_url.clone()
        };

        Ok((account, upstream))
    }

    pub fn mark_success(&self, id: i64) {
        let _ = self.manager.mark_used(id, true);
    }

    pub fn mark_failure(&self, id: i64) {
        let _ = self.manager.mark_used(id, false);
    }

    /// Health check all accounts
    pub async fn health_check_all(&self) -> Vec<(i64, bool, String)> {
        let accounts = match self.manager.get_all() {
            Ok(a) => a,
            Err(_) => return vec![],
        };

        let mut results = vec![];
        for account in &accounts {
            let upstream = if account.upstream_url.is_empty() {
                &self.default_upstream
            } else {
                &account.upstream_url
            };

            match self.client.get_user_status(upstream, &account.api_key).await {
                Ok(status) => {
                    let plan = status.pointer("/plan_type")
                        .and_then(|v| v.as_str())
                        .unwrap_or("unknown")
                        .to_string();
                    results.push((account.id, true, plan));
                }
                Err(e) => {
                    results.push((account.id, false, e.to_string()));
                }
            }
        }
        results
    }
}
