use anyhow::Result;
use chrono::{DateTime, Utc};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Account {
    pub id: i64,
    pub api_key: String,
    pub email: String,
    pub plan: String,
    pub credits_remaining: f64,
    pub status: String, // "active", "inactive", "error", "rate_limited"
    pub upstream_url: String,
    pub last_used: Option<DateTime<Utc>>,
    pub last_health_check: Option<DateTime<Utc>>,
    pub request_count: i64,
    pub error_count: i64,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RequestLog {
    pub id: i64,
    pub account_id: i64,
    pub method: String,
    pub model: String,
    pub protocol: String, // "anthropic", "openai", "gemini"
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub duration_ms: i64,
    pub status: String,
    pub error: Option<String>,
    pub created_at: DateTime<Utc>,
}

pub struct Database {
    conn: Mutex<Connection>,
}

impl Database {
    pub fn new(path: &str) -> Result<Self> {
        if let Some(parent) = Path::new(path).parent() {
            std::fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(path)?;
        let db = Self { conn: Mutex::new(conn) };
        db.init_tables()?;
        Ok(db)
    }

    fn init_tables(&self) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS accounts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                api_key TEXT NOT NULL UNIQUE,
                email TEXT DEFAULT '',
                plan TEXT DEFAULT 'unknown',
                credits_remaining REAL DEFAULT 0,
                status TEXT DEFAULT 'active',
                upstream_url TEXT DEFAULT '',
                last_used TEXT,
                last_health_check TEXT,
                request_count INTEGER DEFAULT 0,
                error_count INTEGER DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS request_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                account_id INTEGER,
                method TEXT DEFAULT '',
                model TEXT DEFAULT '',
                protocol TEXT DEFAULT '',
                input_tokens INTEGER DEFAULT 0,
                output_tokens INTEGER DEFAULT 0,
                duration_ms INTEGER DEFAULT 0,
                status TEXT DEFAULT '',
                error TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY (account_id) REFERENCES accounts(id)
            );

            CREATE INDEX IF NOT EXISTS idx_logs_created ON request_logs(created_at);
            CREATE INDEX IF NOT EXISTS idx_logs_account ON request_logs(account_id);
            CREATE INDEX IF NOT EXISTS idx_accounts_status ON accounts(status);"
        )?;
        Ok(())
    }

    // Account CRUD
    pub fn add_account(&self, api_key: &str, email: &str, upstream_url: &str) -> Result<i64> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR IGNORE INTO accounts (api_key, email, upstream_url) VALUES (?1, ?2, ?3)",
            params![api_key, email, upstream_url],
        )?;
        Ok(conn.last_insert_rowid())
    }

    pub fn get_accounts(&self) -> Result<Vec<Account>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, api_key, email, plan, credits_remaining, status, upstream_url,
                    last_used, last_health_check, request_count, error_count, created_at
             FROM accounts ORDER BY id"
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(Account {
                id: row.get(0)?,
                api_key: row.get(1)?,
                email: row.get(2)?,
                plan: row.get(3)?,
                credits_remaining: row.get(4)?,
                status: row.get(5)?,
                upstream_url: row.get(6)?,
                last_used: row.get::<_, Option<String>>(7)?.and_then(|s| s.parse().ok()),
                last_health_check: row.get::<_, Option<String>>(8)?.and_then(|s| s.parse().ok()),
                request_count: row.get(9)?,
                error_count: row.get(10)?,
                created_at: row.get::<_, String>(11)?.parse().unwrap_or_default(),
            })
        })?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    pub fn get_active_accounts(&self) -> Result<Vec<Account>> {
        let accounts = self.get_accounts()?;
        Ok(accounts.into_iter().filter(|a| a.status == "active").collect())
    }

    pub fn delete_account(&self, id: i64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM accounts WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn update_account_status(&self, id: i64, status: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE accounts SET status = ?1 WHERE id = ?2",
            params![status, id],
        )?;
        Ok(())
    }

    pub fn update_account_after_use(&self, id: i64, success: bool) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        if success {
            conn.execute(
                "UPDATE accounts SET last_used = datetime('now'), request_count = request_count + 1 WHERE id = ?1",
                params![id],
            )?;
        } else {
            conn.execute(
                "UPDATE accounts SET last_used = datetime('now'), error_count = error_count + 1 WHERE id = ?1",
                params![id],
            )?;
        }
        Ok(())
    }

    pub fn update_account_credits(&self, id: i64, credits: f64, plan: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE accounts SET credits_remaining = ?1, plan = ?2, last_health_check = datetime('now') WHERE id = ?3",
            params![credits, plan, id],
        )?;
        Ok(())
    }

    // Request logging
    pub fn log_request(&self, account_id: i64, method: &str, model: &str, protocol: &str,
                       input_tokens: i64, output_tokens: i64, duration_ms: i64,
                       status: &str, error: Option<&str>) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO request_logs (account_id, method, model, protocol, input_tokens, output_tokens, duration_ms, status, error)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![account_id, method, model, protocol, input_tokens, output_tokens, duration_ms, status, error],
        )?;
        Ok(())
    }

    pub fn get_stats(&self) -> Result<serde_json::Value> {
        let conn = self.conn.lock().unwrap();
        let total: i64 = conn.query_row("SELECT COUNT(*) FROM request_logs", [], |r| r.get(0))?;
        let errors: i64 = conn.query_row("SELECT COUNT(*) FROM request_logs WHERE status = 'error'", [], |r| r.get(0))?;
        let accounts: i64 = conn.query_row("SELECT COUNT(*) FROM accounts", [], |r| r.get(0))?;
        let active: i64 = conn.query_row("SELECT COUNT(*) FROM accounts WHERE status = 'active'", [], |r| r.get(0))?;
        Ok(serde_json::json!({
            "total_requests": total,
            "total_errors": errors,
            "total_accounts": accounts,
            "active_accounts": active,
        }))
    }
}
