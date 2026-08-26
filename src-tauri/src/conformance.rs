use crate::{
    domain::page_spec::PageSpec,
    repositories::{secrets, storage},
    services::model_provider::{self, AllowedOperation, GenerateInput},
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum ProbeCommand {
    Describe,
    Generate { request: ProbeRequest },
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeRequest {
    pub prompt: String,
    pub system_prompt: String,
    pub openapi_context: Option<String>,
    #[serde(default)]
    pub allowed_operations: Vec<AllowedOperation>,
}

#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum ProbeResponse {
    Descriptor {
        name: String,
        protocol: String,
        model: String,
        temperature: f64,
        configured_max_tokens: u32,
        effective_max_tokens: u32,
        structured_output: String,
        credentials_ready: bool,
        credential_refs: usize,
    },
    Result {
        ok: bool,
        page: Option<PageSpec>,
        error: Option<String>,
    },
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredModelConfig {
    id: String,
    name: String,
    protocol: String,
    base_url: String,
    model: String,
    secret_ref: Option<String>,
    #[serde(default)]
    custom_headers: HashMap<String, String>,
    #[serde(default)]
    custom_header_secret_refs: HashMap<String, String>,
    timeout_seconds: Option<u64>,
    temperature: Option<f64>,
    max_tokens: Option<u32>,
    structured_output: Option<String>,
    enabled: Option<bool>,
}

fn default_model_config() -> Result<StoredModelConfig, String> {
    let default_id = storage::load_default_model()?
        .filter(|value| !value.trim().is_empty())
        .ok_or("客户端尚未设置默认模型")?;
    select_default_model(storage::load_model_metadata()?, &default_id)
}

fn preflight_credentials(config: &StoredModelConfig) -> Result<usize, String> {
    let mut resolved = 0;
    if let Some(secret_ref) = config.secret_ref.as_deref() {
        let value = secrets::load(secret_ref).map_err(|_| "无法读取默认模型 API 凭证")?;
        if value.is_empty() {
            return Err("默认模型 API 凭证为空".into());
        }
        resolved += 1;
    }
    for secret_ref in config.custom_header_secret_refs.values() {
        let value = secrets::load(secret_ref).map_err(|_| "无法读取默认模型自定义 Header 凭证")?;
        if value.is_empty() {
            return Err("默认模型自定义 Header 凭证为空".into());
        }
        resolved += 1;
    }
    Ok(resolved)
}

fn conformance_max_tokens(configured: Option<u32>) -> u32 {
    configured.unwrap_or(4096).clamp(256, 4096)
}

fn select_default_model(
    payloads: Vec<String>,
    default_id: &str,
) -> Result<StoredModelConfig, String> {
    for payload in payloads {
        let value: serde_json::Value = match serde_json::from_str(&payload) {
            Ok(value) => value,
            Err(_) => continue,
        };
        if value.get("id").and_then(serde_json::Value::as_str) != Some(default_id) {
            continue;
        }
        let config: StoredModelConfig =
            serde_json::from_value(value).map_err(|error| format!("默认模型配置无效：{error}"))?;
        if config.id != default_id {
            return Err("客户端默认模型 ID 不一致".into());
        }
        if config.enabled == Some(false) {
            return Err("客户端默认模型已停用".into());
        }
        if config.base_url.trim().is_empty() || config.model.trim().is_empty() {
            return Err("客户端默认模型缺少 Base URL 或模型名称".into());
        }
        return Ok(config);
    }
    Err("客户端默认模型配置不存在".into())
}

pub async fn execute_probe(command: ProbeCommand) -> ProbeResponse {
    let config = match default_model_config() {
        Ok(config) => config,
        Err(error) => {
            return ProbeResponse::Result {
                ok: false,
                page: None,
                error: Some(error),
            }
        }
    };
    match command {
        ProbeCommand::Describe => match preflight_credentials(&config) {
            Ok(credential_refs) => ProbeResponse::Descriptor {
                name: config.name,
                protocol: config.protocol,
                model: config.model,
                temperature: config.temperature.unwrap_or(0.2).clamp(0.0, 2.0),
                configured_max_tokens: config.max_tokens.unwrap_or(4096),
                effective_max_tokens: conformance_max_tokens(config.max_tokens),
                structured_output: config
                    .structured_output
                    .unwrap_or_else(|| "jsonObject".into()),
                credentials_ready: true,
                credential_refs,
            },
            Err(error) => ProbeResponse::Result {
                ok: false,
                page: None,
                error: Some(error),
            },
        },
        ProbeCommand::Generate { request } => {
            let custom_headers = config
                .custom_headers
                .into_iter()
                .filter(|(_, value)| !value.is_empty())
                .collect::<HashMap<_, _>>();
            let input = GenerateInput {
                prompt: request.prompt,
                base_url: config.base_url,
                protocol: config.protocol,
                model: config.model,
                secret_ref: config.secret_ref,
                api_key: None,
                openapi_context: request.openapi_context,
                custom_headers: (!custom_headers.is_empty()).then_some(custom_headers),
                custom_header_secret_refs: (!config.custom_header_secret_refs.is_empty())
                    .then_some(config.custom_header_secret_refs),
                timeout_seconds: config.timeout_seconds,
                temperature: config.temperature,
                max_tokens: Some(conformance_max_tokens(config.max_tokens)),
                structured_output: config.structured_output,
                streaming: Some(false),
                allowed_operations: Some(request.allowed_operations),
                system_prompt: Some(request.system_prompt),
            };
            match model_provider::generate_page(input).await {
                Ok(page) => ProbeResponse::Result {
                    ok: true,
                    page: Some(page),
                    error: None,
                },
                Err(error) => ProbeResponse::Result {
                    ok: false,
                    page: None,
                    error: Some(error),
                },
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{conformance_max_tokens, select_default_model};

    #[test]
    fn selects_only_the_configured_default_model() {
        let payloads = vec![
            r#"{"id":"other","name":"Other","protocol":"openai","baseUrl":"https://example.com/v1","model":"other"}"#.into(),
            r#"{"id":"agens","name":"Agens","protocol":"openai","baseUrl":"https://example.com/v1","model":"agens-model","secretRef":"model-agens"}"#.into(),
        ];
        let selected = select_default_model(payloads, "agens").expect("default model");
        assert_eq!(selected.id, "agens");
        assert_eq!(selected.name, "Agens");
    }

    #[test]
    fn rejects_disabled_or_missing_default_models() {
        let disabled = vec![r#"{"id":"agens","name":"Agens","protocol":"openai","baseUrl":"https://example.com/v1","model":"agens-model","enabled":false}"#.into()];
        assert!(select_default_model(disabled, "agens").is_err());
        assert!(select_default_model(Vec::new(), "agens").is_err());
    }

    #[test]
    fn conformance_output_budget_is_bounded_but_matches_normal_client_generation() {
        assert_eq!(conformance_max_tokens(None), 4096);
        assert_eq!(conformance_max_tokens(Some(2048)), 2048);
        assert_eq!(conformance_max_tokens(Some(8192)), 4096);
        assert_eq!(conformance_max_tokens(Some(1)), 256);
    }
}
