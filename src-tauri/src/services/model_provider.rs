use crate::services::url_security::{
    read_limited_response, validate_content_length, validate_https_or_debug_local,
};
use crate::{
    domain::{
        page_schema,
        page_spec::{
            validate, BatchAction, InteractionMode, InteractionSpec, OperationBinding, PageSpec,
        },
    },
    repositories::secrets,
};
use futures_util::StreamExt;
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
    pub system_prompt: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct AllowedOperation {
    #[serde(default)]
    pub api_document_id: Option<String>,
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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerationResult {
    pub page: PageSpec,
    pub generation_source: String,
    pub issues: Vec<crate::domain::page_spec::PageIssue>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerationFailure {
    pub issues: Vec<crate::domain::page_spec::PageIssue>,
    pub retryable: bool,
}

fn generation_issue(stage: &str, code: &str, message: &str) -> crate::domain::page_spec::PageIssue {
    crate::domain::page_spec::PageIssue {
        code: code.into(),
        path: "".into(),
        severity: "error".into(),
        stage: stage.into(),
        message: message.into(),
        suggested_fix: Some("请检查配置或重新生成页面".into()),
    }
}

impl From<String> for GenerationFailure {
    fn from(_: String) -> Self {
        Self {
            issues: vec![generation_issue(
                "permission",
                "generation.request_failed",
                "模型请求未完成，请检查连接与授权配置后重试",
            )],
            retryable: false,
        }
    }
}

fn finish_generation(
    content: &str,
    allowed: Option<&[AllowedOperation]>,
    prompt: &str,
) -> Result<GenerationResult, GenerationFailure> {
    let decoded =
        page_schema::decode_page_spec_detailed(content).map_err(|issues| GenerationFailure {
            issues,
            retryable: true,
        })?;
    let mut spec = decoded.page;
    validate_operation_bindings(&spec.operations, &spec.batch_actions, allowed).map_err(|_| {
        GenerationFailure {
            issues: vec![generation_issue(
                "permission",
                "generation.unauthorized_binding",
                "模型引用了未授权的 API 操作，页面未采用",
            )],
            retryable: true,
        }
    })?;
    apply_explicit_page_intent(&mut spec, prompt);
    if let Some(theme) = explicit_theme(prompt) {
        spec.theme = Some(theme.into());
    }
    validate(&spec).map_err(|_| GenerationFailure {
        issues: vec![generation_issue(
            "schema",
            "generation.invalid_intent",
            "页面结构不符合 v1 契约，页面未采用",
        )],
        retryable: true,
    })?;
    Ok(GenerationResult {
        page: spec,
        generation_source: if decoded.repaired {
            "repaired"
        } else {
            "model"
        }
        .into(),
        issues: decoded.issues,
    })
}

pub async fn generate_page_detailed(
    input: GenerateInput,
) -> Result<GenerationResult, GenerationFailure> {
    generate_page_with_delta(input, None::<fn(&str) -> Result<(), String>>).await
}

pub async fn generate_page(input: GenerateInput) -> Result<PageSpec, String> {
    generate_page_detailed(input)
        .await
        .map(|result| result.page)
        .map_err(|error| legacy_generation_error(&error))
}

fn legacy_generation_error(error: &GenerationFailure) -> String {
    format!(
        "模型输出不符合 PageSpec：{}",
        error
            .issues
            .iter()
            .map(|issue| issue.message.as_str())
            .collect::<Vec<_>>()
            .join("；")
    )
}

pub async fn generate_page_stream<F>(input: GenerateInput, on_delta: F) -> Result<PageSpec, String>
where
    F: FnMut(&str) -> Result<(), String>,
{
    generate_page_stream_detailed(input, on_delta)
        .await
        .map(|result| result.page)
        .map_err(|error| legacy_generation_error(&error))
}

pub async fn generate_page_stream_detailed<F>(
    mut input: GenerateInput,
    on_delta: F,
) -> Result<GenerationResult, GenerationFailure>
where
    F: FnMut(&str) -> Result<(), String>,
{
    input.streaming = Some(true);
    generate_page_with_delta(input, Some(on_delta)).await
}

fn validate_prompt_budget(input: &GenerateInput) -> Result<(), GenerationFailure> {
    const SYSTEM_PROMPT_LIMIT: usize = 4000;
    const OPENAPI_CONTEXT_LIMIT: usize = 12000;
    const USER_REQUEST_LIMIT: usize = 8000;
    const USER_MESSAGE_LIMIT: usize = 18000;
    let system_prompt = input.system_prompt.as_deref().unwrap_or_default();
    let openapi_context = input.openapi_context.as_deref().unwrap_or("");
    let user_message_size = input.prompt.chars().count()
        + openapi_context.chars().count()
        + "Request: \nOpenAPI context: ".chars().count();
    if system_prompt.chars().count() > SYSTEM_PROMPT_LIMIT
        || openapi_context.chars().count() > OPENAPI_CONTEXT_LIMIT
        || input.prompt.chars().count() > USER_REQUEST_LIMIT
        || user_message_size > USER_MESSAGE_LIMIT
    {
        return Err(GenerationFailure {
            issues: vec![generation_issue(
                "schema",
                "generation.prompt_budget",
                "生成上下文超过安全预算；请缩小业务描述或选择较少的 API 文档后重试",
            )],
            retryable: false,
        });
    }
    Ok(())
}

async fn generate_page_with_delta<F>(
    input: GenerateInput,
    mut on_delta: Option<F>,
) -> Result<GenerationResult, GenerationFailure>
where
    F: FnMut(&str) -> Result<(), String>,
{
    validate_prompt_budget(&input)?;
    validate_transport(&input.base_url, &input.protocol, &input.model)?;
    let key = resolve_api_key(input.api_key, input.secret_ref)?;
    let schema = page_schema::schema();
    let custom_prompt = input.system_prompt.unwrap_or_default();
    let system = format!("You generate ONLY valid JSON matching this PageSpec schema: {schema}. filters and columns MUST be arrays of strings, never objects. rows MUST be arrays of arrays of strings, never objects. stats values MUST be strings. Every view column reference (defaultSort.column, chart axes/group, and kanban group/card fields) MUST exactly match one string in columns; omit a view when its required columns are unavailable. Do not fabricate rows, statistics, or metric values; data is loaded from bound operations. Use at most 10 columns and 3 top-level views; keep every view reference within columns. Use layout=full by default so filters and stats appear above the main view; use layout=sidebar only when the user explicitly requests a sidebar or side-by-side filter layout. Explicit user requests for modal/dialog detail or editing MUST be reflected in interaction.detail or interaction.update. When an existing PageSpec is provided, preserve its operation bindings exactly; never invent an apiDocumentId, operation_id, method, or path. Every new operation and batch action binding MUST copy apiDocumentId from the matching authorized OpenAPI operation. If no authorized operation exists for a requested action, explain the missing capability and do not create that binding. Never include markdown or code. Do not invent credentials or execute actions. The UI is a read-only preview. {}", custom_prompt);
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
    if !status.is_success() {
        let raw_body = read_limited_response(response, 8 * 1024 * 1024, "模型").await?;
        let detail = sanitize_provider_error(&raw_body);
        return Err(GenerationFailure::from(if detail.is_empty() {
            format!("模型服务返回 HTTP {}", status.as_u16())
        } else {
            format!("模型服务返回 HTTP {}：{}", status.as_u16(), detail)
        }));
    }
    let (content, response_diagnostic) = if content_type.contains("text/event-stream") {
        if let Some(emitter) = on_delta.as_mut() {
            (
                read_streaming_sse(response, &input.protocol, emitter).await?,
                None,
            )
        } else {
            let raw_body = read_limited_response(response, 8 * 1024 * 1024, "模型").await?;
            (parse_sse_content(&raw_body, &input.protocol)?, None)
        }
    } else {
        let raw_body = read_limited_response(response, 8 * 1024 * 1024, "模型").await?;
        let raw: serde_json::Value =
            serde_json::from_str(&raw_body).map_err(|_| GenerationFailure {
                issues: vec![generation_issue(
                    "syntax",
                    "generation.response_json",
                    "模型响应格式无法解析，请重试生成",
                )],
                retryable: true,
            })?;
        let content = extract_response_text(&raw, &input.protocol);
        let diagnostic = response_diagnostic(&raw, &input.protocol, &content);
        (content, Some(diagnostic))
    };
    let _ = response_diagnostic; // Shape diagnostics never cross the generation boundary.
    finish_generation(&content, input.allowed_operations.as_deref(), &input.prompt)
}

async fn read_streaming_sse<F>(
    response: reqwest::Response,
    protocol: &str,
    on_delta: &mut F,
) -> Result<String, String>
where
    F: FnMut(&str) -> Result<(), String>,
{
    const MAX_RESPONSE_BYTES: usize = 8 * 1024 * 1024;
    let mut decoder = SseDecoder::default();
    let mut total = 0usize;
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| format!("读取流式模型响应失败：{error}"))?;
        total = total.saturating_add(chunk.len());
        if total > MAX_RESPONSE_BYTES {
            return Err("模型响应超过 8 MB 限制".into());
        }
        decoder.push(&chunk, protocol, on_delta)?;
    }
    decoder.finish(protocol, on_delta)
}

#[derive(Default)]
struct SseDecoder {
    pending: Vec<u8>,
    content: String,
    emit_buffer: String,
}

impl SseDecoder {
    fn push<F>(&mut self, chunk: &[u8], protocol: &str, on_delta: &mut F) -> Result<(), String>
    where
        F: FnMut(&str) -> Result<(), String>,
    {
        self.pending.extend_from_slice(chunk);
        while let Some(newline) = self.pending.iter().position(|byte| *byte == b'\n') {
            let mut line = self.pending.drain(..=newline).collect::<Vec<_>>();
            line.pop();
            if line.last() == Some(&b'\r') {
                line.pop();
            }
            self.consume_line(&line, protocol, on_delta)?;
        }
        Ok(())
    }

    fn finish<F>(mut self, protocol: &str, on_delta: &mut F) -> Result<String, String>
    where
        F: FnMut(&str) -> Result<(), String>,
    {
        if !self.pending.is_empty() {
            let line = std::mem::take(&mut self.pending);
            self.consume_line(&line, protocol, on_delta)?;
        }
        self.flush(on_delta)?;
        if self.content.trim().is_empty() {
            return Err("流式模型响应不完整，未生成可执行页面".into());
        }
        Ok(self.content)
    }

    fn consume_line<F>(
        &mut self,
        line: &[u8],
        protocol: &str,
        on_delta: &mut F,
    ) -> Result<(), String>
    where
        F: FnMut(&str) -> Result<(), String>,
    {
        let line =
            std::str::from_utf8(line).map_err(|_| "流式模型响应不是有效 UTF-8".to_string())?;
        let Some(data) = line.strip_prefix("data:") else {
            return Ok(());
        };
        let data = data.trim();
        if data.is_empty() || data == "[DONE]" {
            return Ok(());
        }
        let value: serde_json::Value = serde_json::from_str(data)
            .map_err(|_| "流式模型响应包含非法事件，页面生成已取消".to_string())?;
        if value.get("error").is_some() {
            let detail = sanitize_provider_error(data);
            return Err(if detail.is_empty() {
                "流式模型服务返回错误".into()
            } else {
                format!("流式模型服务返回错误：{detail}")
            });
        }
        let delta = stream_delta_text(&value, protocol);
        if !delta.is_empty() {
            self.content.push_str(&delta);
            self.emit_buffer.push_str(&delta);
            if self.emit_buffer.len() >= 64 || delta.contains('\n') {
                self.flush(on_delta)?;
            }
        }
        Ok(())
    }

    fn flush<F>(&mut self, on_delta: &mut F) -> Result<(), String>
    where
        F: FnMut(&str) -> Result<(), String>,
    {
        if !self.emit_buffer.is_empty() {
            on_delta(&self.emit_buffer)?;
            self.emit_buffer.clear();
        }
        Ok(())
    }
}

fn stream_delta_text(value: &serde_json::Value, protocol: &str) -> String {
    let candidate = if protocol == "anthropic" {
        value.pointer("/delta/text")
    } else {
        value
            .pointer("/choices/0/delta/content")
            .or_else(|| value.pointer("/choices/0/text"))
    };
    candidate.map(value_text).unwrap_or_default()
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

fn response_diagnostic(raw: &serde_json::Value, protocol: &str, content: &str) -> String {
    let (finish_reason, reasoning, refusal, output_tokens, tool_calls) = if protocol == "anthropic"
    {
        (
            raw.pointer("/stop_reason")
                .and_then(serde_json::Value::as_str),
            None,
            None,
            raw.pointer("/usage/output_tokens")
                .and_then(serde_json::Value::as_u64),
            0,
        )
    } else {
        (
            raw.pointer("/choices/0/finish_reason")
                .and_then(serde_json::Value::as_str),
            raw.pointer("/choices/0/message/reasoning_content"),
            raw.pointer("/choices/0/message/refusal"),
            raw.pointer("/usage/completion_tokens")
                .and_then(serde_json::Value::as_u64),
            raw.pointer("/choices/0/message/tool_calls")
                .and_then(serde_json::Value::as_array)
                .map_or(0, Vec::len),
        )
    };
    let finish_reason = finish_reason
        .unwrap_or("unknown")
        .chars()
        .filter(|character| character.is_ascii_alphanumeric() || matches!(character, '_' | '-'))
        .take(32)
        .collect::<String>();
    let reasoning_chars = reasoning
        .map(value_text)
        .map_or(0, |text| text.chars().count());
    let refusal_present = refusal.is_some_and(|value| !value_text(value).trim().is_empty());
    format!(
        "响应元数据: finish_reason={finish_reason}, content_chars={}, reasoning_chars={reasoning_chars}, refusal={refusal_present}, tool_calls={tool_calls}, output_tokens={}",
        content.chars().count(),
        output_tokens.map_or_else(|| "unknown".into(), |tokens| tokens.to_string())
    )
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
    batch_actions: &[BatchAction],
    allowed: Option<&[AllowedOperation]>,
) -> Result<(), String> {
    if bindings.is_empty() && batch_actions.is_empty() {
        return Ok(());
    }
    let allowed = allowed.ok_or("页面声明了 operation 绑定，但未提供已导入 OpenAPI 允许列表")?;
    let is_allowed =
        |api_document_id: Option<&str>, operation_id: &str, method: &str, path: &str| {
            allowed.iter().any(|operation| {
                operation.api_document_id.as_deref() == api_document_id
                    && operation.operation_id == operation_id
                    && operation.method == method
                    && operation.path == path
            })
        };
    if bindings.iter().any(|binding| {
        !is_allowed(
            binding.api_document_id.as_deref(),
            &binding.operation_id,
            &binding.method,
            &binding.path,
        )
    }) || batch_actions.iter().any(|action| {
        !is_allowed(
            action.api_document_id.as_deref(),
            &action.operation_id,
            &action.method,
            &action.path,
        )
    }) {
        return Err("PageSpec 包含不属于已导入 OpenAPI 的 operation 绑定".into());
    }
    Ok(())
}

fn explicit_layout(prompt: &str) -> &'static str {
    let normalized = prompt.to_lowercase();
    let layouts = [
        (
            "sidebar",
            [
                "侧边栏",
                "左侧栏",
                "侧栏",
                "左右布局",
                "左右排布",
                "左右分栏",
                "sidebar",
                "side bar",
                "side-by-side layout",
                "two-column filter layout",
            ]
            .as_slice(),
        ),
        (
            "full",
            [
                "上下布局",
                "上下排布",
                "筛选项放在表格上方",
                "筛选项放表格上方",
                "filters above the table",
                "vertical layout",
                "full layout",
                "full-width layout",
            ]
            .as_slice(),
        ),
    ];
    let mut selected = None;
    for (layout, patterns) in layouts {
        for pattern in patterns {
            if let Some(index) = normalized.rfind(pattern) {
                if !mention_is_negated(&normalized, index)
                    && selected.is_none_or(|(current, _)| index >= current)
                {
                    selected = Some((index, layout));
                }
            }
        }
    }
    selected.map_or("full", |(_, layout)| layout)
}

fn explicit_modal_actions(prompt: &str) -> (bool, bool) {
    let normalized = prompt.to_lowercase();
    let modal_patterns = ["弹窗", "对话框", "模态框", "modal", "dialog"];
    let detail_patterns = ["查看", "详情", "明细", "detail", "view"];
    let update_patterns = ["编辑", "修改", "更新", "edit", "update"];
    let mut detail = false;
    let mut update = false;

    for clause in normalized.split(['。', '！', '？', '!', '?', ';', '；', '\n']) {
        let has_positive_modal = modal_patterns.iter().any(|pattern| {
            clause
                .match_indices(pattern)
                .any(|(index, _)| !mention_is_negated(clause, index))
        });
        if !has_positive_modal {
            continue;
        }
        detail |= detail_patterns
            .iter()
            .any(|pattern| clause.contains(pattern));
        update |= update_patterns
            .iter()
            .any(|pattern| clause.contains(pattern));
    }

    (detail, update)
}

fn apply_explicit_page_intent(spec: &mut PageSpec, prompt: &str) {
    spec.layout = Some(explicit_layout(prompt).into());
    let (detail_modal, update_modal) = explicit_modal_actions(prompt);
    if !detail_modal && !update_modal {
        return;
    }
    let interaction = spec
        .interaction
        .get_or_insert_with(InteractionSpec::default);
    if detail_modal {
        interaction.detail = Some(InteractionMode::Modal);
    }
    if update_modal {
        interaction.update = Some(InteractionMode::Modal);
    }
}

fn explicit_theme(prompt: &str) -> Option<&'static str> {
    let normalized = prompt.to_lowercase();
    let themes = [
        (
            "enterprise-blue",
            [
                "enterprise-blue",
                "enterprise blue",
                "企业蓝",
                "企业级蓝白",
                "ant design pro",
            ]
            .as_slice(),
        ),
        (
            "clean-light",
            ["clean-light", "clean light", "干净浅色", "清爽浅色"].as_slice(),
        ),
        (
            "minimal-dark",
            ["minimal-dark", "minimal dark", "极简深色"].as_slice(),
        ),
        (
            "forge-default",
            ["forge-default", "默认暗色", "forge 默认"].as_slice(),
        ),
    ];
    let mut selected = None;
    for (theme, patterns) in themes {
        for pattern in patterns {
            if let Some(index) = normalized.rfind(pattern) {
                if !mention_is_negated(&normalized, index)
                    && selected.is_none_or(|(current, _)| index >= current)
                {
                    selected = Some((index, theme));
                }
            }
        }
    }
    selected.map(|(_, theme)| theme)
}

fn mention_is_negated(prompt: &str, index: usize) -> bool {
    let prefix = prompt[..index]
        .chars()
        .rev()
        .take(20)
        .collect::<String>()
        .chars()
        .rev()
        .collect::<String>();
    let prefix = prefix.trim_end();
    [
        "不要使用",
        "不要用",
        "不使用",
        "不用",
        "不要",
        "避免",
        "不是",
        "do not use",
        "don't use",
        "not use",
        "not a",
        "without a",
        "instead of",
        "rather than",
    ]
    .iter()
    .any(|negation| prefix.ends_with(negation))
}

fn parse_sse_content(body: &str, protocol: &str) -> Result<String, String> {
    let mut decoder = SseDecoder::default();
    decoder.push(body.as_bytes(), protocol, &mut |_| Ok(()))?;
    decoder.finish(protocol, &mut |_| Ok(()))
}

#[cfg(test)]
mod tests {
    use super::{
        apply_explicit_page_intent, explicit_layout, explicit_modal_actions, explicit_theme,
        finish_generation, parse_sse_content, response_diagnostic, validate_custom_header,
        validate_operation_bindings, AllowedOperation, GenerationFailure, SseDecoder,
    };
    use crate::domain::page_spec::{
        BatchAction, InteractionMode, OperationBinding, PageSpec, PayloadBuilder,
    };

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

    #[tokio::test]
    async fn invalid_json_http_success_is_safe_and_retryable() {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            socket
                .set_read_timeout(Some(std::time::Duration::from_secs(10)))
                .unwrap();
            let mut request = Vec::new();
            let mut buffer = [0u8; 4096];
            loop {
                let count = socket.read(&mut buffer).unwrap();
                if count == 0 {
                    break;
                }
                request.extend_from_slice(&buffer[..count]);
                if let Some(header_end) = request.windows(4).position(|bytes| bytes == b"\r\n\r\n")
                {
                    let headers = String::from_utf8_lossy(&request[..header_end]);
                    let length = headers
                        .lines()
                        .find_map(|line| {
                            line.to_ascii_lowercase()
                                .strip_prefix("content-length:")
                                .and_then(|value| value.trim().parse::<usize>().ok())
                        })
                        .unwrap();
                    if request.len() >= header_end + 4 + length {
                        break;
                    }
                }
            }
            let body = "not-json";
            write!(socket, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body).unwrap();
        });
        let input = serde_json::from_value(serde_json::json!({"prompt":"订单列表", "base_url":format!("http://{address}"),"protocol":"openai","model":"fixture", "streaming":false,"structured_output":"jsonSchema"})).unwrap();
        let failure = super::generate_page_detailed(input).await.err().unwrap();
        assert!(failure.retryable);
        assert_eq!(failure.issues[0].stage, "syntax");
        assert_eq!(failure.issues[0].path, "");
        assert!(!serde_json::to_string(&failure)
            .unwrap()
            .contains("not-json"));
        server.join().unwrap();
    }

    #[tokio::test]
    async fn generation_http_fixture_tracks_decode_and_keeps_legacy_page_shape() {
        use std::io::{Read, Write};
        let content = r#"{"title":"Orders","description":"","filters":[],"stats":[],"columns":["id"],"rows":[]}"#;
        for detailed in [true, false] {
            let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            let address = listener.local_addr().unwrap();
            let body = serde_json::json!({"choices":[{"message":{"content": format!("```json\n{content}\n```")}}]}).to_string();
            let server = std::thread::spawn(move || {
                let (mut socket, _) = listener.accept().unwrap();
                socket
                    .set_read_timeout(Some(std::time::Duration::from_secs(10)))
                    .unwrap();
                let mut request = Vec::new();
                let mut buffer = [0u8; 4096];
                loop {
                    let count = socket.read(&mut buffer).unwrap();
                    if count == 0 {
                        break;
                    }
                    request.extend_from_slice(&buffer[..count]);
                    if let Some(header_end) =
                        request.windows(4).position(|bytes| bytes == b"\r\n\r\n")
                    {
                        let headers = String::from_utf8_lossy(&request[..header_end]);
                        let length = headers
                            .lines()
                            .find_map(|line| {
                                line.to_ascii_lowercase()
                                    .strip_prefix("content-length:")
                                    .and_then(|value| value.trim().parse::<usize>().ok())
                            })
                            .unwrap();
                        if request.len() >= header_end + 4 + length {
                            break;
                        }
                    }
                }
                let request = String::from_utf8(request).unwrap();
                assert!(request.starts_with("POST /chat/completions HTTP/1.1"));
                assert!(request.contains("json_schema"));
                assert!(request.contains("\"stream\":false"));
                write!(socket, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body).unwrap();
            });
            let input = serde_json::from_value(serde_json::json!({"prompt":"订单列表", "base_url":format!("http://{address}"),"protocol":"openai","model":"fixture", "streaming":false,"structured_output":"jsonSchema"})).unwrap();
            if detailed {
                let result = super::generate_page_detailed(input).await.unwrap();
                assert_eq!(result.generation_source, "repaired");
                assert_eq!(result.page.title, "Orders");
            } else {
                let page = super::generate_page(input).await.unwrap();
                let value = serde_json::to_value(page).unwrap();
                assert_eq!(value["title"], "Orders");
                assert!(value.get("generationSource").is_none());
            }
            server.join().unwrap();
        }
    }

    #[test]
    fn generation_rejects_lossy_normalization() {
        let content = r#"{"title":"Orders","description":"","filters":[],"stats":[],"columns":[{"key":"id","label":"ID"}],"rows":[]}"#;
        assert!(finish_generation(content, None, "").is_err());
    }

    #[test]
    fn shared_fixture_authorization_preserves_document_identity() {
        let root =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../contracts/fixtures/v1");
        let manifest: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(root.join("manifest.json")).unwrap())
                .unwrap();
        let mut checked = 0;
        for case in manifest["cases"].as_array().unwrap() {
            let Some(expected) = case.get("authorized").and_then(serde_json::Value::as_bool) else {
                continue;
            };
            let content =
                std::fs::read_to_string(root.join(case["file"].as_str().unwrap())).unwrap();
            let spec = crate::domain::page_schema::decode_page_spec_detailed(&content)
                .unwrap()
                .page;
            let allowed = case["context"]["allowedOperations"]
                .as_array()
                .unwrap()
                .iter()
                .map(|item| AllowedOperation {
                    api_document_id: item["apiDocumentId"].as_str().map(str::to_string),
                    operation_id: item["operation_id"].as_str().unwrap().into(),
                    method: item["method"].as_str().unwrap().into(),
                    path: item["path"].as_str().unwrap().into(),
                })
                .collect::<Vec<_>>();
            assert_eq!(
                validate_operation_bindings(&spec.operations, &spec.batch_actions, Some(&allowed))
                    .is_ok(),
                expected,
                "{}",
                case["id"]
            );
            checked += 1;
        }
        assert_eq!(checked, 2);
    }

    #[tokio::test]
    async fn combined_user_message_budget_is_rejected_before_network() {
        let input = serde_json::from_value(serde_json::json!({
            "prompt": "p".repeat(8000),
            "openapi_context": "o".repeat(10000),
            "base_url": "http://127.0.0.1:1",
            "protocol": "openai",
            "model": "fixture"
        }))
        .unwrap();
        let failure = super::generate_page_detailed(input).await.unwrap_err();
        assert_eq!(failure.issues[0].code, "generation.prompt_budget");
        assert!(!failure.retryable);
    }
    #[tokio::test]
    async fn oversized_user_prompt_is_rejected_before_credentials_or_network() {
        let input = serde_json::from_value(serde_json::json!({
            "prompt": "x".repeat(8001),
            "base_url": "http://127.0.0.1:1",
            "protocol": "openai",
            "model": "fixture"
        }))
        .unwrap();
        let failure = super::generate_page_detailed(input).await.unwrap_err();
        assert_eq!(failure.issues[0].code, "generation.prompt_budget");
        assert!(!failure.retryable);
    }

    #[tokio::test]
    async fn oversized_openapi_context_is_rejected_before_credentials_or_network() {
        let input = serde_json::from_value(serde_json::json!({
            "prompt": "订单列表",
            "base_url": "http://127.0.0.1:1",
            "protocol": "openai",
            "model": "fixture",
            "openapi_context": "{}".repeat(6001)
        }))
        .unwrap();
        let failure = super::generate_page_detailed(input).await.unwrap_err();
        assert_eq!(failure.issues[0].code, "generation.prompt_budget");
        assert!(!failure.retryable);
    }

    #[tokio::test]
    async fn oversized_prompt_is_rejected_before_credentials_or_network() {
        let input = serde_json::from_value(serde_json::json!({
            "prompt": "订单列表",
            "base_url": "http://127.0.0.1:1",
            "protocol": "openai",
            "model": "fixture",
            "system_prompt": "敏感输入".repeat(1001)
        }))
        .unwrap();
        let failure = super::generate_page_detailed(input).await.unwrap_err();
        assert!(!failure.retryable);
        assert_eq!(failure.issues[0].code, "generation.prompt_budget");
        assert!(!serde_json::to_string(&failure)
            .unwrap()
            .contains("敏感输入"));
    }

    #[test]
    fn generation_failure_never_serializes_provider_text() {
        let failure = GenerationFailure::from("raw body SECRET prompt rows".to_string());
        let encoded = serde_json::to_string(&failure).unwrap();
        assert!(!encoded.contains("SECRET"));
        assert!(!failure.retryable);
        assert_eq!(failure.issues[0].stage, "permission");
        assert_eq!(failure.issues[0].path, "");
    }

    #[test]
    fn generation_candidate_rejects_invented_bindings_instead_of_dropping_them() {
        let content = r#"{"title":"Orders","description":"","filters":[],"stats":[],"columns":["id"],"rows":[],"operations":[{"operation_id":"secret","method":"GET","path":"/secret","role":"list"}]}"#;
        let failure = finish_generation(content, None, "").err().unwrap();
        assert!(failure.retryable);
        assert_eq!(failure.issues[0].stage, "permission");
        assert!(!serde_json::to_string(&failure).unwrap().contains("/secret"));
    }

    #[test]
    fn generation_source_tracks_only_actual_safe_decode_repairs() {
        let content = r#"{"title":"Orders","description":"","filters":[],"stats":[],"columns":["id"],"rows":[]}"#;
        assert_eq!(
            finish_generation(content, None, "")
                .unwrap()
                .generation_source,
            "model"
        );
        let fenced = format!("```json\n{content}\n```");
        let repaired = finish_generation(&fenced, None, "").unwrap();
        assert_eq!(repaired.generation_source, "repaired");
        assert!(!repaired.issues.is_empty());
    }

    #[test]
    fn model_response_diagnostic_exposes_only_bounded_shape_metadata() {
        let raw = serde_json::json!({
            "choices": [{
                "finish_reason": "length",
                "message": {
                    "content": "",
                    "reasoning_content": "secret reasoning text",
                    "refusal": null,
                    "tool_calls": []
                }
            }],
            "usage": {"completion_tokens": 4096}
        });
        let diagnostic = response_diagnostic(&raw, "openai", "");
        assert!(diagnostic.contains("finish_reason=length"));
        assert!(diagnostic.contains("content_chars=0"));
        assert!(diagnostic.contains("reasoning_chars=21"));
        assert!(diagnostic.contains("output_tokens=4096"));
        assert!(!diagnostic.contains("secret reasoning text"));
    }

    #[test]
    fn streaming_decoder_handles_arbitrary_utf8_chunk_boundaries() {
        let stream = "data: {\"choices\":[{\"delta\":{\"content\":\"设备{\"}}]}\r\ndata: {\"choices\":[{\"delta\":{\"content\":\"页面}\"}}]}\r\ndata: [DONE]\r\n";
        let mut decoder = SseDecoder::default();
        let mut emitted = String::new();
        for byte in stream.as_bytes() {
            decoder
                .push(&[*byte], "openai", &mut |delta| {
                    emitted.push_str(delta);
                    Ok(())
                })
                .unwrap();
        }
        let content = decoder
            .finish("openai", &mut |delta| {
                emitted.push_str(delta);
                Ok(())
            })
            .unwrap();
        assert_eq!(content, "设备{页面}");
        assert_eq!(emitted, content);
    }

    #[test]
    fn streaming_decoder_supports_anthropic_and_rejects_bad_events() {
        let mut decoder = SseDecoder::default();
        decoder
            .push(
                b"event: content_block_delta\ndata: {\"delta\":{\"text\":\"{ok}\"}}\n\n",
                "anthropic",
                &mut |_| Ok(()),
            )
            .unwrap();
        assert_eq!(
            decoder.finish("anthropic", &mut |_| Ok(())).unwrap(),
            "{ok}"
        );

        let mut malformed = SseDecoder::default();
        assert!(malformed
            .push(b"data: not-json\n", "openai", &mut |_| Ok(()))
            .is_err());

        let mut provider_error = SseDecoder::default();
        assert!(provider_error
            .push(
                b"data: {\"error\":{\"message\":\"bad request\"}}\n",
                "openai",
                &mut |_| Ok(()),
            )
            .is_err());
    }

    #[test]
    fn streaming_decoder_propagates_emit_failures() {
        let mut decoder = SseDecoder::default();
        decoder
            .push(
                b"data: {\"choices\":[{\"delta\":{\"content\":\"{}\"}}]}\n",
                "openai",
                &mut |_| Ok(()),
            )
            .unwrap();
        assert!(decoder
            .finish("openai", &mut |_| Err("window closed".into()))
            .is_err());
    }

    #[test]
    fn rejects_operation_bindings_outside_openapi_allow_list() {
        let binding = OperationBinding {
            api_document_id: None,
            operation_id: "getDevice".into(),
            method: "GET".into(),
            path: "/devices/{id}".into(),
            role: "detail".into(),
            body_schema: None,
            confirm_message: None,
            pagination: None,
            sort_param: None,
        };
        let allowed = vec![AllowedOperation {
            api_document_id: None,
            operation_id: "listDevices".into(),
            method: "GET".into(),
            path: "/devices".into(),
        }];
        assert!(validate_operation_bindings(&[binding], &[], Some(&allowed)).is_err());
    }

    #[test]
    fn operation_bindings_must_match_the_authorized_document_identity() {
        let mut binding = OperationBinding {
            api_document_id: Some("document-b".into()),
            operation_id: "listDevices".into(),
            method: "GET".into(),
            path: "/devices".into(),
            role: "list".into(),
            body_schema: None,
            confirm_message: None,
            pagination: None,
            sort_param: None,
        };
        let allowed = vec![AllowedOperation {
            api_document_id: Some("document-a".into()),
            operation_id: "listDevices".into(),
            method: "GET".into(),
            path: "/devices".into(),
        }];

        assert!(
            validate_operation_bindings(std::slice::from_ref(&binding), &[], Some(&allowed))
                .is_err()
        );
        binding.api_document_id = Some("document-a".into());
        assert!(
            validate_operation_bindings(std::slice::from_ref(&binding), &[], Some(&allowed))
                .is_ok()
        );
        binding.api_document_id = None;
        assert!(
            validate_operation_bindings(std::slice::from_ref(&binding), &[], Some(&allowed))
                .is_err()
        );
    }

    #[test]
    fn rejects_batch_actions_outside_openapi_allow_list() {
        let action = BatchAction {
            api_document_id: None,
            operation_id: "archiveDevices".into(),
            method: "POST".into(),
            path: "/devices/archive".into(),
            confirm_message: None,
            payload_builder: PayloadBuilder {
                r#type: "ids".into(),
                custom_payload: None,
            },
        };
        let allowed = vec![AllowedOperation {
            api_document_id: None,
            operation_id: "listDevices".into(),
            method: "GET".into(),
            path: "/devices".into(),
        }];
        assert!(validate_operation_bindings(&[], &[action], Some(&allowed)).is_err());
    }

    #[test]
    fn explicit_user_theme_intent_is_deterministic_and_last_choice_wins() {
        assert_eq!(
            explicit_theme("请生成企业蓝风格后台"),
            Some("enterprise-blue")
        );
        assert_eq!(
            explicit_theme("Use an Ant Design Pro-like enterprise UI"),
            Some("enterprise-blue")
        );
        assert_eq!(explicit_theme("改成干净浅色"), Some("clean-light"));
        assert_eq!(explicit_theme("Use minimal-dark"), Some("minimal-dark"));
        assert_eq!(
            explicit_theme("不要 forge-default，最终使用 enterprise-blue"),
            Some("enterprise-blue")
        );
        assert_eq!(
            explicit_theme("采用企业蓝风格，不要使用默认暗色主题"),
            Some("enterprise-blue")
        );
        assert_eq!(
            explicit_theme("Use enterprise-blue instead of forge-default"),
            Some("enterprise-blue")
        );
        assert_eq!(
            explicit_theme("Do not use enterprise-blue; choose clean-light"),
            Some("clean-light")
        );
        assert_eq!(explicit_theme("生成普通设备管理页"), None);
    }

    #[test]
    fn page_layout_defaults_to_full_unless_sidebar_is_explicit() {
        assert_eq!(explicit_layout("生成设备管理页面"), "full");
        assert_eq!(explicit_layout("筛选项放在表格上方"), "full");
        assert_eq!(explicit_layout("Use a sidebar for filters"), "sidebar");
        assert_eq!(explicit_layout("筛选项使用左侧栏布局"), "sidebar");
        assert_eq!(explicit_layout("不要左右布局，筛选项放上方"), "full");
    }

    #[test]
    fn explicit_modal_intent_targets_view_and_edit_in_chinese_and_english() {
        assert_eq!(explicit_modal_actions("查看编辑要用弹窗"), (true, true));
        assert_eq!(explicit_modal_actions("详情使用对话框"), (true, false));
        assert_eq!(
            explicit_modal_actions("Edit records in a modal"),
            (false, true)
        );
        assert_eq!(
            explicit_modal_actions("View and edit in a modal dialog"),
            (true, true)
        );
        assert_eq!(
            explicit_modal_actions("编辑使用内联区域，不要用弹窗"),
            (false, false)
        );
    }

    #[test]
    fn explicit_page_intent_overrides_model_layout_and_interactions() {
        let mut page: PageSpec = serde_json::from_value(serde_json::json!({
            "version": 1,
            "title": "Devices",
            "description": "",
            "layout": "sidebar",
            "filters": ["Status"],
            "stats": [],
            "columns": ["ID"],
            "rows": [["1"]],
            "interaction": {"update": "inline", "detail": "inline"}
        }))
        .unwrap();

        apply_explicit_page_intent(&mut page, "筛选项放表格上方，查看编辑要用弹窗");

        assert_eq!(page.layout.as_deref(), Some("full"));
        let interaction = page.interaction.expect("interaction should be present");
        assert!(matches!(interaction.update, Some(InteractionMode::Modal)));
        assert!(matches!(interaction.detail, Some(InteractionMode::Modal)));
    }
}
