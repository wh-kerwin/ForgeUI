use crate::services::url_security::{
    read_limited_response, validate_content_length, validate_https_or_debug_local,
};
use crate::{
    domain::{
        page_schema,
        page_spec::{validate, OperationBinding, PageSpec},
    },
    repositories::secrets,
};
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, time::Duration};

#[derive(Debug, Deserialize)]
pub struct ModelConfigInput {
    pub base_url: String,
    pub protocol: String,
    pub model: String,
    pub api_key: Option<String>,
    pub secret_ref: Option<String>,
    pub custom_headers: Option<HashMap<String, String>>,
    pub custom_header_secret_refs: Option<HashMap<String, String>>,
    pub timeout_seconds: Option<u64>,
}

#[derive(Debug, Deserialize)]
pub struct GenerateInput {
    pub prompt: String,
    pub base_url: String,
    pub protocol: String,
    pub model: String,
    pub secret_ref: Option<String>,
    pub api_key: Option<String>,
    pub openapi_context: Option<String>,
    pub custom_headers: Option<HashMap<String, String>>,
    pub custom_header_secret_refs: Option<HashMap<String, String>>,
    pub timeout_seconds: Option<u64>,
    pub temperature: Option<f64>,
    pub max_tokens: Option<u32>,
    pub structured_output: Option<String>,
    pub streaming: Option<bool>,
    pub allowed_operations: Option<Vec<AllowedOperation>>,
}

#[derive(Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct AllowedOperation {
    pub operation_id: String,
    pub method: String,
    pub path: String,
}

#[derive(Debug, Serialize)]
pub struct ValidationResult {
    pub ok: bool,
    pub message: String,
    pub protocol: String,
    pub model: String,
    pub response_time_ms: u128,
    pub status: u16,
}

fn endpoint(base_url: &str, protocol: &str) -> String {
    let path = if protocol == "anthropic" {
        "messages"
    } else {
        "chat/completions"
    };
    format!("{}/{}", base_url.trim_end_matches('/'), path)
}

fn validate_transport(base_url: &str, protocol: &str, model: &str) -> Result<(), String> {
    let parsed = url::Url::parse(base_url).map_err(|_| "模型 Base URL 无效".to_string())?;
    validate_https_or_debug_local(&parsed, "模型服务")?;
    if !matches!(protocol, "openai" | "anthropic") {
        return Err("不支持的模型 API 格式".into());
    }
    if model.trim().is_empty() {
        return Err("模型名称不能为空".into());
    }
    Ok(())
}

fn authenticated_request(
    client: &reqwest::Client,
    base_url: &str,
    protocol: &str,
    key: Option<String>,
    custom_headers: Option<HashMap<String, String>>,
    body: serde_json::Value,
) -> Result<reqwest::RequestBuilder, String> {
    let mut request = client.post(endpoint(base_url, protocol)).json(&body);
    if let Some(key) = key.filter(|value| !value.is_empty()) {
        request = if protocol == "anthropic" {
            request.header("x-api-key", key)
        } else {
            request.bearer_auth(key)
        };
    }
    if protocol == "anthropic" {
        request = request.header("anthropic-version", "2023-06-01");
    }
    if let Some(headers) = custom_headers {
        for (name, value) in headers {
            validate_custom_header(&name, &value)?;
            request = request.header(name, value);
        }
    }
    Ok(request)
}

fn resolve_custom_headers(
    headers: Option<HashMap<String, String>>,
    refs: Option<HashMap<String, String>>,
) -> Result<Option<HashMap<String, String>>, String> {
    let mut resolved = headers.unwrap_or_default();
    if let Some(refs) = refs {
        for (name, secret_ref) in refs {
            let value = secrets::load(&secret_ref)
                .map_err(|_| format!("无法读取自定义 Header 凭证：{name}"))?;
            resolved.insert(name, value);
        }
    }
    Ok((!resolved.is_empty()).then_some(resolved))
}

fn validate_custom_header(name: &str, value: &str) -> Result<(), String> {
    if name.trim().is_empty()
        || name.len() > 128
        || value.len() > 4096
        || name.contains(['\r', '\n'])
        || value.contains(['\r', '\n'])
    {
        return Err("自定义 Header 格式或长度无效".into());
    }
    if matches!(
        name.to_ascii_lowercase().as_str(),
        "authorization" | "cookie" | "host" | "content-length"
    ) {
        return Err("Authorization、Cookie、Host 和 Content-Length 必须由受控凭证配置管理".into());
    }
    Ok(())
}

pub async fn validate_config(input: ModelConfigInput) -> Result<ValidationResult, String> {
    validate_transport(&input.base_url, &input.protocol, &input.model)?;
    let body = if input.protocol == "anthropic" {
        serde_json::json!({"model": input.model, "max_tokens": 16, "messages": [{"role": "user", "content": "Reply with OK"}]})
    } else {
        serde_json::json!({"model": input.model, "max_tokens": 16, "messages": [{"role": "user", "content": "Reply with OK"}]})
    };
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(
            input.timeout_seconds.unwrap_or(15).clamp(5, 120),
        ))
        .build()
        .map_err(|e| e.to_string())?;
    let key = resolve_api_key(input.api_key, input.secret_ref)?;
    let started = std::time::Instant::now();
    let response = authenticated_request(
        &client,
        &input.base_url,
        &input.protocol,
        key,
        resolve_custom_headers(input.custom_headers, input.custom_header_secret_refs)?,
        body,
    )?
    .send()
    .await
    .map_err(|e| format!("连接失败：{e}"))?;
    validate_content_length(response.content_length(), 2 * 1024 * 1024, "模型连接测试")?;
    let status = response.status().as_u16();
    if !response.status().is_success() {
        return Err(format!("模型服务返回 HTTP {status}"));
    }
    Ok(ValidationResult {
        ok: true,
        message: format!("{} 连接成功", input.model),
        protocol: input.protocol,
        model: input.model,
        response_time_ms: started.elapsed().as_millis(),
        status,
    })
}

pub async fn generate_page(input: GenerateInput) -> Result<PageSpec, String> {
    validate_transport(&input.base_url, &input.protocol, &input.model)?;
    let key = resolve_api_key(input.api_key, input.secret_ref)?;
    let schema = page_schema::schema();
    let system = format!("You generate ONLY valid JSON matching this PageSpec schema: {schema}. filters and columns MUST be arrays of strings, never objects. rows MUST be arrays of arrays of strings, never objects. stats values MUST be strings. When an existing PageSpec is provided, preserve its operation bindings exactly; never invent an operation_id, method, or path. If no authorized operation exists for a requested action, represent it as local UI state only. Never include markdown or code. Do not invent credentials or execute actions. Limit rows to 8. The UI is read-only preview.");
    let context = input
        .openapi_context
        .unwrap_or_else(|| "No OpenAPI context provided".into());
    let output_mode = input.structured_output.as_deref().unwrap_or("jsonObject");
    let max_tokens = input.max_tokens.unwrap_or(2048).clamp(256, 32768);
    let temperature = input.temperature.unwrap_or(0.2).clamp(0.0, 2.0);
    let streaming = input.streaming.unwrap_or(false);
    let body = if input.protocol == "anthropic" {
        serde_json::json!({"model": input.model, "max_tokens": max_tokens, "stream": streaming, "system": system, "messages": [{"role":"user","content":format!("Request: {}\nOpenAPI context: {}", input.prompt, context)}]})
    } else {
        let mut body = serde_json::json!({"model": input.model, "temperature": temperature, "max_tokens": max_tokens, "stream": streaming, "messages":[{"role":"system","content":system},{"role":"user","content":format!("Request: {}\nOpenAPI context: {}", input.prompt, context)}]});
        // Some OpenAI-compatible gateways reject response_format together
        // with streaming. The strict prompt plus schema validation still
        // protects the result, so omit this optional field for streamed calls.
        if !streaming && output_mode == "jsonSchema" {
            body["response_format"] = serde_json::json!({"type":"json_schema", "json_schema": {"name":"PageSpec", "strict":true, "schema":schema}});
        } else if !streaming && output_mode != "prompt" {
            body["response_format"] = serde_json::json!({"type":"json_object"});
        }
        body
    };
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(
            input.timeout_seconds.unwrap_or(60).clamp(5, 120),
        ))
        .build()
        .map_err(|e| e.to_string())?;
    let response = authenticated_request(
        &client,
        &input.base_url,
        &input.protocol,
        key,
        resolve_custom_headers(input.custom_headers, input.custom_header_secret_refs)?,
        body,
    )?
    .send()
    .await
    .map_err(|e| format!("模型请求失败：{e}"))?;
    validate_content_length(response.content_length(), 8 * 1024 * 1024, "模型")?;
    let status = response.status();
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .to_string();
    let raw_body = read_limited_response(response, 8 * 1024 * 1024, "模型").await?;
    if !status.is_success() {
        let detail = sanitize_provider_error(&raw_body);
        return Err(if detail.is_empty() {
            format!("模型服务返回 HTTP {}", status.as_u16())
        } else {
            format!("模型服务返回 HTTP {}：{}", status.as_u16(), detail)
        });
    }
    let content = if streaming || content_type.contains("text/event-stream") {
        parse_sse_content(&raw_body, &input.protocol)?
    } else {
        let raw: serde_json::Value =
            serde_json::from_str(&raw_body).map_err(|e| format!("模型响应不是 JSON：{e}"))?;
        extract_response_text(&raw, &input.protocol)
    };
    let value = page_schema::normalize_page_spec(page_schema::decode_json(&content)?);
    let spec: PageSpec =
        serde_json::from_value(value).map_err(|e| format!("模型输出不符合 PageSpec：{e}"))?;
    validate(&spec)?;
    validate_operation_bindings(&spec.operations, input.allowed_operations.as_deref())?;
    Ok(spec)
}

fn extract_response_text(raw: &serde_json::Value, protocol: &str) -> String {
    let candidates = if protocol == "anthropic" {
        vec![raw.pointer("/content"), raw.pointer("/message/content")]
    } else {
        vec![
            raw.pointer("/choices/0/message/content"),
            raw.pointer("/choices/0/text"),
            raw.pointer("/output_text"),
        ]
    };
    candidates
        .into_iter()
        .flatten()
        .map(value_text)
        .find(|text| !text.trim().is_empty())
        .unwrap_or_default()
}

fn value_text(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::String(text) => text.clone(),
        serde_json::Value::Array(items) => items
            .iter()
            .map(value_text)
            .filter(|text| !text.is_empty())
            .collect::<Vec<_>>()
            .join(""),
        serde_json::Value::Object(object) => object
            .get("text")
            .or_else(|| object.get("content"))
            .or_else(|| object.get("value"))
            .map(value_text)
            .unwrap_or_default(),
        _ => String::new(),
    }
}

fn resolve_api_key(
    api_key: Option<String>,
    secret_ref: Option<String>,
) -> Result<Option<String>, String> {
    if let Some(value) = api_key.filter(|value| !value.is_empty()) {
        return Ok(Some(value));
    }
    match secret_ref {
        Some(reference) => secrets::load(&reference)
            .map(Some)
            .map_err(|_| "无法读取模型 API Key，请重新保存该模型配置".to_string()),
        None => Ok(None),
    }
}

/// Return a bounded, credential-safe error detail from an upstream provider.
/// Providers commonly return JSON containing a useful reason for 401/400, but
/// the full payload can contain echoed request data or sensitive headers.
fn sanitize_provider_error(body: &str) -> String {
    let compact = body.replace(['\r', '\n'], " ");
    let lower = compact.to_ascii_lowercase();
    let mut value = if let Ok(json) = serde_json::from_str::<serde_json::Value>(&compact) {
        json.pointer("/error/message")
            .and_then(|item| item.as_str())
            .or_else(|| json.pointer("/message").and_then(|item| item.as_str()))
            .unwrap_or(&compact)
            .to_string()
    } else {
        compact
    };
    for marker in ["api_key", "apikey", "authorization", "bearer"] {
        if lower.contains(marker) {
            value = "上游未接受认证或请求参数".to_string();
            break;
        }
    }
    value.chars().take(300).collect()
}

fn validate_operation_bindings(
    bindings: &[OperationBinding],
    allowed: Option<&[AllowedOperation]>,
) -> Result<(), String> {
    if bindings.is_empty() {
        return Ok(());
    }
    let allowed = allowed.ok_or("页面声明了 operation 绑定，但未提供已导入 OpenAPI 允许列表")?;
    if bindings.iter().any(|binding| {
        !allowed.iter().any(|operation| {
            operation.operation_id == binding.operation_id
                && operation.method == binding.method
                && operation.path == binding.path
        })
    }) {
        return Err("PageSpec 包含不属于已导入 OpenAPI 的 operation 绑定".into());
    }
    Ok(())
}

fn parse_sse_content(body: &str, protocol: &str) -> Result<String, String> {
    let mut content = String::new();
    let mut saw_data = false;
    for line in body.lines() {
        let Some(data) = line.strip_prefix("data:") else {
            continue;
        };
        let data = data.trim();
        if data == "[DONE]" {
            continue;
        }
        let value: serde_json::Value = serde_json::from_str(data)
            .map_err(|_| "流式模型响应包含非法事件，页面生成已取消".to_string())?;
        let text = if protocol == "anthropic" {
            value.pointer("/delta/text").and_then(|item| item.as_str())
        } else {
            value
                .pointer("/choices/0/delta/content")
                .and_then(|item| item.as_str())
        };
        if let Some(text) = text {
            content.push_str(text);
            saw_data = true;
        }
    }
    if !saw_data || content.trim().is_empty() {
        return Err("流式模型响应不完整，未生成可执行页面".into());
    }
    Ok(content)
}

#[cfg(test)]
mod tests {
    use super::{
        parse_sse_content, validate_custom_header, validate_operation_bindings, AllowedOperation,
    };
    use crate::domain::page_spec::OperationBinding;

    #[test]
    fn rejects_sensitive_or_injected_custom_headers() {
        assert!(validate_custom_header("Authorization", "Bearer secret").is_err());
        assert!(validate_custom_header("X-Test\r\nInjected", "value").is_err());
        assert!(validate_custom_header("X-Provider", "safe").is_ok());
    }

    #[test]
    fn only_complete_sse_content_can_be_parsed() {
        let complete = "data: {\"choices\":[{\"delta\":{\"content\":\"{\"}}]}\ndata: {\"choices\":[{\"delta\":{\"content\":\"}\"}}]}\ndata: [DONE]";
        assert!(parse_sse_content(complete, "openai").is_ok());
        assert!(parse_sse_content("data: {\"choices\":[{\"delta\":{}}]}", "openai").is_err());
    }

    #[test]
    fn rejects_operation_bindings_outside_openapi_allow_list() {
        let binding = OperationBinding {
            operation_id: "getDevice".into(),
            method: "GET".into(),
            path: "/devices/{id}".into(),
            role: "detail".into(),
        };
        let allowed = vec![AllowedOperation {
            operation_id: "listDevices".into(),
            method: "GET".into(),
            path: "/devices".into(),
        }];
        assert!(validate_operation_bindings(&[binding], Some(&allowed)).is_err());
    }
}
