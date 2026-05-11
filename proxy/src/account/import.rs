use anyhow::Result;
use serde::Deserialize;

#[derive(Debug, Clone)]
pub struct ImportedAccount {
    pub api_key: String,
    pub email: String,
    pub upstream_url: String,
}

#[derive(Debug, Deserialize)]
struct JsonAccount {
    api_key: Option<String>,
    apiKey: Option<String>,
    key: Option<String>,
    token: Option<String>,
    email: Option<String>,
    upstream_url: Option<String>,
    upstream: Option<String>,
}

/// Auto-detect format and import accounts from text
pub fn auto_import(text: &str) -> Result<Vec<ImportedAccount>> {
    let trimmed = text.trim();

    // Try JSON array first
    if trimmed.starts_with('[') {
        if let Ok(accounts) = import_json_array(trimmed) {
            if !accounts.is_empty() {
                return Ok(accounts);
            }
        }
    }

    // Try JSON object (single account)
    if trimmed.starts_with('{') {
        if let Ok(accounts) = import_json_object(trimmed) {
            if !accounts.is_empty() {
                return Ok(accounts);
            }
        }
    }

    // Try CSV (has commas and header-like first line)
    if trimmed.contains(',') && trimmed.lines().count() > 1 {
        if let Ok(accounts) = import_csv(trimmed) {
            if !accounts.is_empty() {
                return Ok(accounts);
            }
        }
    }

    // Try KEY=VALUE env format
    if trimmed.contains('=') && !trimmed.contains(',') {
        if let Ok(accounts) = import_env(trimmed) {
            if !accounts.is_empty() {
                return Ok(accounts);
            }
        }
    }

    // Fallback: one api_key per line (plain text)
    import_plain_lines(trimmed)
}

fn import_json_array(text: &str) -> Result<Vec<ImportedAccount>> {
    let items: Vec<JsonAccount> = serde_json::from_str(text)?;
    Ok(items.into_iter().filter_map(json_to_imported).collect())
}

fn import_json_object(text: &str) -> Result<Vec<ImportedAccount>> {
    let item: JsonAccount = serde_json::from_str(text)?;
    Ok(json_to_imported(item).into_iter().collect())
}

fn json_to_imported(j: JsonAccount) -> Option<ImportedAccount> {
    let api_key = j.api_key.or(j.apiKey).or(j.key).or(j.token)?;
    if api_key.is_empty() {
        return None;
    }
    Some(ImportedAccount {
        api_key,
        email: j.email.unwrap_or_default(),
        upstream_url: j.upstream_url.or(j.upstream).unwrap_or_default(),
    })
}

fn import_csv(text: &str) -> Result<Vec<ImportedAccount>> {
    let mut reader = csv::ReaderBuilder::new()
        .flexible(true)
        .has_headers(true)
        .from_reader(text.as_bytes());

    let headers = reader.headers()?.clone();
    let key_idx = headers.iter().position(|h| {
        let h = h.to_lowercase();
        h == "api_key" || h == "apikey" || h == "key" || h == "token"
    });
    let email_idx = headers.iter().position(|h| h.to_lowercase() == "email");

    let key_idx = match key_idx {
        Some(i) => i,
        None => return Ok(vec![]),
    };

    let mut accounts = Vec::new();
    for record in reader.records() {
        let record = record?;
        if let Some(key) = record.get(key_idx) {
            if !key.is_empty() {
                accounts.push(ImportedAccount {
                    api_key: key.to_string(),
                    email: email_idx.and_then(|i| record.get(i)).unwrap_or("").to_string(),
                    upstream_url: String::new(),
                });
            }
        }
    }
    Ok(accounts)
}

fn import_env(text: &str) -> Result<Vec<ImportedAccount>> {
    let mut accounts = Vec::new();
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some((key, value)) = line.split_once('=') {
            let key = key.trim().to_uppercase();
            let value = value.trim().trim_matches('"').trim_matches('\'');
            if (key.contains("API_KEY") || key.contains("TOKEN")) && !value.is_empty() {
                accounts.push(ImportedAccount {
                    api_key: value.to_string(),
                    email: String::new(),
                    upstream_url: String::new(),
                });
            }
        }
    }
    Ok(accounts)
}

fn import_plain_lines(text: &str) -> Result<Vec<ImportedAccount>> {
    let mut accounts = Vec::new();
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        // Support "email:api_key" or "email api_key" or just "api_key"
        let (email, api_key) = if let Some((a, b)) = line.split_once(':') {
            if b.len() > 20 { (a.to_string(), b.to_string()) }
            else { (String::new(), line.to_string()) }
        } else if let Some((a, b)) = line.split_once('\t') {
            (a.to_string(), b.to_string())
        } else {
            (String::new(), line.to_string())
        };
        if !api_key.is_empty() {
            accounts.push(ImportedAccount {
                api_key,
                email,
                upstream_url: String::new(),
            });
        }
    }
    Ok(accounts)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_plain_lines() {
        let text = "key1\nkey2\n# comment\nkey3";
        let accounts = auto_import(text).unwrap();
        assert_eq!(accounts.len(), 3);
    }

    #[test]
    fn test_json_array() {
        let text = r#"[{"api_key":"k1","email":"a@b.com"},{"key":"k2"}]"#;
        let accounts = auto_import(text).unwrap();
        assert_eq!(accounts.len(), 2);
        assert_eq!(accounts[0].email, "a@b.com");
    }

    #[test]
    fn test_env_format() {
        let text = "CODEIUM_API_KEY=mykey123\nOTHER=ignored\nTOKEN=tok456";
        let accounts = auto_import(text).unwrap();
        assert_eq!(accounts.len(), 2);
    }
}
