use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    pub server: ServerConfig,
    pub upstream: UpstreamConfig,
    pub accounts: AccountsConfig,
    pub prompt: PromptConfig,
    pub database: DatabaseConfig,
    pub logging: LoggingConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerConfig {
    pub host: String,
    pub port: u16,
    #[serde(default)]
    pub api_key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpstreamConfig {
    pub url: String,
    #[serde(default = "default_timeout")]
    pub timeout: u64,
    #[serde(default)]
    pub metadata: UpstreamMetadata,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpstreamMetadata {
    #[serde(default = "default_ide_name")]
    pub ide_name: String,
    #[serde(default = "default_ide_version")]
    pub ide_version: String,
    #[serde(default = "default_ext_version")]
    pub extension_version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccountsConfig {
    #[serde(default = "default_rotation")]
    pub rotation: String,
    #[serde(default)]
    pub health_check_interval: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PromptConfig {
    #[serde(default = "default_strip_mode")]
    pub strip_mode: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DatabaseConfig {
    #[serde(default = "default_db_path")]
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoggingConfig {
    #[serde(default = "default_log_level")]
    pub level: String,
}

fn default_timeout() -> u64 { 120 }
fn default_ide_name() -> String { "windsurf".into() }
fn default_ide_version() -> String { "2.5.0".into() }
fn default_ext_version() -> String { "2.5.0".into() }
fn default_rotation() -> String { "round_robin".into() }
fn default_strip_mode() -> String { "full".into() }
fn default_db_path() -> String { "data/proxy.db".into() }
fn default_log_level() -> String { "info".into() }

impl Default for UpstreamMetadata {
    fn default() -> Self {
        Self {
            ide_name: default_ide_name(),
            ide_version: default_ide_version(),
            extension_version: default_ext_version(),
        }
    }
}

impl Default for Config {
    fn default() -> Self {
        Self {
            server: ServerConfig {
                host: "127.0.0.1".into(),
                port: 8787,
                api_key: String::new(),
            },
            upstream: UpstreamConfig {
                url: "https://server.codeium.com".into(),
                timeout: 120,
                metadata: UpstreamMetadata::default(),
            },
            accounts: AccountsConfig {
                rotation: "round_robin".into(),
                health_check_interval: 300,
            },
            prompt: PromptConfig {
                strip_mode: "full".into(),
            },
            database: DatabaseConfig {
                path: "data/proxy.db".into(),
            },
            logging: LoggingConfig {
                level: "info".into(),
            },
        }
    }
}

impl Config {
    pub fn load(path: &str) -> Result<Self> {
        if Path::new(path).exists() {
            let content = std::fs::read_to_string(path)?;
            let config: Config = toml::from_str(&content)?;
            Ok(config)
        } else {
            tracing::warn!("Config file not found at {}, using defaults", path);
            Ok(Config::default())
        }
    }
}
