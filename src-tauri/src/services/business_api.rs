use crate::repositories::{projects, secrets};
use crate::services::url_security::{
    read_limited_response, validate_content_length, validate_https_or_debug_local,
};
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, time::Duration};

#[derive(Debug, Deserialize)]
pub struct ApiRequest {
    pub url: String,
    pub method: String,
    pub headers: Option<HashMap<String, String>>,
    pub body: Option<serde_json::Value>,
    pub project_id: String,
    pub api_document_id: String,
    pub operation_key: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ApiResponse {
    pub status: u16,
    pub body: serde_json::Value,
}

#[derive(Deserialize)]
struct StoredBusinessConnection {
    #[serde(default)]
    r#type: String,
    #[serde(rename = "secretRef")]
    secret_ref: Option<String>,
    #[serde(rename = "apiKeyName")]
    api_key_name: Option<String>,
    #[serde(rename = "caPem")]
    ca_pem: Option<String>,
    #[serde(rename = "apiBaseUrl")]
    api_base_url: Option<String>,
    #[serde(rename = "authorizedOperations", default)]
    authorized_operations: Vec<String>,
}

struct AuthorizedDocument {
    base_url: String,
    auth: StoredBusinessConnection,
}

fn authorize_document(
    project_id: &str,
    api_document_id: &str,
    method: &str,
    target: &url::Url,
    operation_key: Option<&str>,
) -> Result<AuthorizedDocument, String> {
    let operation_key = operation_key.ok_or("业务请求缺少 operation 授权标识")?;
    let document = projects::resolve_api_document(project_id, api_document_id)?;
    let connection: StoredBusinessConnection = serde_json::from_value(document.payload.auth)
        .map_err(|_| "API 文档的业务连接配置无效".to_string())?;
    let base_url = connection
        .api_base_url
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .map(ToOwned::to_owned)
        .or_else(|| {
            document
                .payload
                .spec
                .get("api_base_url")
                .and_then(|value| value.as_str())
                .map(ToOwned::to_owned)
        })
        .ok_or("API 文档缺少已授权服务地址")?;
    if !connection
        .authorized_operations
        .iter()
        .any(|item| item == operation_key)
    {
        return Err("该 operation 尚未获得用户授权".into());
    }
    let expected = operation_key
        .split(" · ")
        .next()
        .ok_or("operation 授权标识无效")?;
    let (expected_method, expected_path) =
        expected.split_once(' ').ok_or("operation 授权标识无效")?;
    validate_target(target, Some(&base_url))?;
    let base = url::Url::parse(&base_url).map_err(|_| "已授权业务服务地址无效".to_string())?;
    let base_path = base.path().trim_end_matches('/');
    let target_path = if base_path.is_empty() || base_path == "/" {
        target.path()
    } else {
        target
            .path()
            .strip_prefix(base_path)
            .unwrap_or(target.path())
    };
    let path_matches = matches_operation_path(expected_path, target_path);
    if expected_method != method || !path_matches {
        return Err("请求与已授权 operation 不匹配".into());
    }
    Ok(AuthorizedDocument {
        base_url,
        auth: connection,
    })
}

fn matches_operation_path(pattern: &str, path: &str) -> bool {
    let expected_segments: Vec<_> = pattern.split('/').collect();
    let actual_segments: Vec<_> = path.split('/').collect();
    expected_segments.len() == actual_segments.len()
        && expected_segments
            .iter()
            .zip(actual_segments)
            .all(|(expected, actual)| {
                (expected.starts_with('{') && expected.ends_with('}')) || *expected == actual
            })
}

fn is_safe_forwarded_header(name: &str) -> bool {
    matches!(
        name.to_ascii_lowercase().as_str(),
        "content-type" | "accept"
    )
}

fn validate_credential_header(name: &str) -> Result<(), String> {
    if name.trim().is_empty()
        || name.len() > 128
        || name.contains(['\r', '\n'])
        || matches!(
            name.to_ascii_lowercase().as_str(),
            "authorization" | "cookie" | "host" | "content-length"
        )
    {
        return Err("业务 API 凭证 Header 名称不允许使用该值".into());
    }
    Ok(())
}

pub fn validate_target(target: &url::Url, allowed_base_url: Option<&str>) -> Result<(), String> {
    let base_url = allowed_base_url.ok_or("业务请求缺少已授权 OpenAPI 服务地址")?;
    let base = url::Url::parse(base_url).map_err(|_| "已授权业务服务地址无效".to_string())?;
    let same_origin = target.scheme() == base.scheme()
        && target.host_str() == base.host_str()
        && target.port_or_known_default() == base.port_or_known_default();
    let base_path = base.path().trim_end_matches('/');
    if !same_origin
        || (!base_path.is_empty() && base_path != "/" && !target.path().starts_with(base_path))
    {
        return Err("请求目标不属于已授权 OpenAPI 服务".into());
    }
    Ok(())
}

fn validate_ca_pem(ca_pem: &str) -> Result<reqwest::Certificate, String> {
    if ca_pem.len() > 1024 * 1024 || ca_pem.contains("PRIVATE KEY") {
        return Err("企业 CA 配置只允许证书，不允许私钥或超大内容".into());
    }
    reqwest::Certificate::from_pem(ca_pem.as_bytes()).map_err(|_| "企业 CA PEM 无效".into())
}

pub async fn execute(request: ApiRequest) -> Result<ApiResponse, String> {
    let parsed = url::Url::parse(&request.url).map_err(|_| "业务 API 地址无效".to_string())?;
    let method = request.method.to_uppercase();
    let authorized = authorize_document(
        &request.project_id,
        &request.api_document_id,
        &method,
        &parsed,
        request.operation_key.as_deref(),
    )?;
    validate_target(&parsed, Some(&authorized.base_url))?;
    validate_https_or_debug_local(&parsed, "业务 API")?;
    if !matches!(method.as_str(), "GET" | "POST" | "PUT" | "PATCH" | "DELETE") {
        return Err("不支持的 HTTP 方法".into());
    }
    let mut client_builder = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::none());
    if let Some(ca_pem) = authorized.auth.ca_pem.filter(|pem| !pem.trim().is_empty()) {
        client_builder = client_builder.add_root_certificate(validate_ca_pem(&ca_pem)?);
    }
    let client = client_builder.build().map_err(|e| e.to_string())?;
    let mut builder = match method.as_str() {
        "GET" => client.get(parsed),
        "POST" => client.post(parsed),
        "PUT" => client.put(parsed),
        "PATCH" => client.patch(parsed),
        "DELETE" => client.delete(parsed),
        _ => unreachable!(),
    };
    if let Some(headers) = request.headers {
        for (key, value) in headers {
            if is_safe_forwarded_header(&key) {
                builder = builder.header(key, value);
            }
        }
    }
    if let Some(secret_ref) = authorized
        .auth
        .secret_ref
        .filter(|_| authorized.auth.r#type != "none")
    {
        let secret = secrets::load(&secret_ref).map_err(|_| "无法读取业务 API 凭证".to_string())?;
        builder = match authorized.auth.r#type.as_str() {
            "bearer" => builder.bearer_auth(secret),
            "apiKey" => {
                let header_name = authorized
                    .auth
                    .api_key_name
                    .unwrap_or_else(|| "x-api-key".into());
                validate_credential_header(&header_name)?;
                builder.header(header_name, secret)
            }
            _ => builder,
        };
    }
    if let Some(body) = request.body {
        builder = builder.json(&body);
    }
    let response = builder
        .send()
        .await
        .map_err(|e| format!("业务 API 请求失败：{e}"))?;
    validate_content_length(response.content_length(), 10 * 1024 * 1024, "业务 API")?;
    let status = response.status().as_u16();
    let text = read_limited_response(response, 10 * 1024 * 1024, "业务 API").await?;
    let body = serde_json::from_str(&text).unwrap_or_else(|_| serde_json::json!({"text": text}));
    if (300..400).contains(&status) {
        return Err("业务 API 返回重定向，已为安全起见拒绝跟随".into());
    }
    if status >= 400 {
        return Err(format!("业务 API 返回 HTTP {status}"));
    }
    Ok(ApiResponse { status, body })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn target_must_match_authorized_origin_and_path() {
        let valid = url::Url::parse("https://api.example.com/v1/devices").unwrap();
        assert!(validate_target(&valid, Some("https://api.example.com/v1")).is_ok());
        let foreign = url::Url::parse("https://evil.example.com/v1/devices").unwrap();
        assert!(validate_target(&foreign, Some("https://api.example.com/v1")).is_err());
        let escaped = url::Url::parse("https://api.example.com/admin").unwrap();
        assert!(validate_target(&escaped, Some("https://api.example.com/v1")).is_err());
    }

    #[test]
    fn operation_path_allows_only_declared_path_parameters() {
        assert!(matches_operation_path("/devices/{deviceId}", "/devices/42"));
        assert!(!matches_operation_path(
            "/devices/{deviceId}",
            "/devices/42/logs"
        ));
        assert!(!matches_operation_path("/devices/{deviceId}", "/users/42"));
    }

    #[test]
    fn never_forwards_client_supplied_credential_headers() {
        assert!(is_safe_forwarded_header("content-type"));
        assert!(is_safe_forwarded_header("Accept"));
        assert!(!is_safe_forwarded_header("Authorization"));
        assert!(!is_safe_forwarded_header("X-API-Key"));
        assert!(validate_credential_header("X-API-Key").is_ok());
        assert!(validate_credential_header("Authorization").is_err());
    }

    #[test]
    fn rejects_private_keys_in_enterprise_ca_input() {
        assert!(
            validate_ca_pem("-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----")
                .is_err()
        );
        assert!(validate_ca_pem(&"A".repeat(1024 * 1024 + 1)).is_err());
    }
}
