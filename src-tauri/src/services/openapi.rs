use crate::services::url_security::{
    read_limited_response, validate_content_length, validate_https_or_debug_local,
};
use serde::Serialize;
use std::time::Duration;

#[derive(Debug, Serialize)]
pub struct OpenApiSummary {
    pub title: String,
    pub version: String,
    pub spec_version: String,
    pub operation_count: usize,
    pub operations: Vec<String>,
    pub api_base_url: String,
    pub discovered_url: String,
}

pub fn parse(content: &str, source: &str) -> Result<OpenApiSummary, String> {
    let value: serde_json::Value = serde_json::from_str(content)
        .or_else(|_| serde_yaml::from_str::<serde_json::Value>(content).map_err(|e| e.to_string()))
        .map_err(|e| format!("无法解析 OpenAPI 文档：{e}"))?;
    let spec_version = value
        .get("openapi")
        .and_then(|v| v.as_str())
        .or_else(|| value.get("swagger").and_then(|v| v.as_str()))
        .unwrap_or("")
        .to_string();
    if spec_version.is_empty() {
        return Err("文档缺少 openapi 或 swagger 版本字段".into());
    }
    let title = value
        .pointer("/info/title")
        .and_then(|v| v.as_str())
        .unwrap_or("未命名服务")
        .to_string();
    let version = value
        .pointer("/info/version")
        .and_then(|v| v.as_str())
        .unwrap_or("未知版本")
        .to_string();
    let api_base_url = value
        .pointer("/servers/0/url")
        .and_then(|v| v.as_str())
        .and_then(|server| {
            url::Url::parse(source)
                .ok()
                .and_then(|base| base.join(server).ok())
                .map(|url| url.to_string())
        })
        .or_else(|| {
            let scheme = value
                .get("schemes")
                .and_then(|v| v.as_array())
                .and_then(|items| items.first())
                .and_then(|v| v.as_str())
                .unwrap_or("https");
            value.get("host").and_then(|v| v.as_str()).map(|host| {
                format!(
                    "{scheme}://{host}{}",
                    value.get("basePath").and_then(|v| v.as_str()).unwrap_or("")
                )
            })
        })
        .unwrap_or_else(|| source.to_string());
    let mut operations = Vec::new();
    if let Some(paths) = value.get("paths").and_then(|item| item.as_object()) {
        for (path, item) in paths {
            if let Some(path_operations) = item.as_object() {
                for (method, operation) in path_operations {
                    if matches!(
                        method.as_str(),
                        "get" | "post" | "put" | "patch" | "delete" | "head" | "options" | "trace"
                    ) {
                        let operation_id = operation
                            .get("operationId")
                            .and_then(|item| item.as_str())
                            .unwrap_or("未命名");
                        operations.push(format!(
                            "{} {} · {}",
                            method.to_uppercase(),
                            path,
                            operation_id
                        ));
                    }
                }
            }
        }
    }
    let operation_count = operations.len();
    Ok(OpenApiSummary {
        title,
        version,
        spec_version,
        operation_count,
        operations,
        api_base_url,
        discovered_url: source.to_string(),
    })
}

pub async fn import_url(url: String) -> Result<OpenApiSummary, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| e.to_string())?;
    let mut current = url;
    for _ in 0..2 {
        let parsed =
            url::Url::parse(&current).map_err(|_| "Swagger URL 不是有效地址".to_string())?;
        validate_https_or_debug_local(&parsed, "Swagger/OpenAPI 地址")?;
        let response = client
            .get(parsed.clone())
            .send()
            .await
            .map_err(|e| format!("获取 Swagger 失败：{e}"))?;
        validate_content_length(
            response.content_length(),
            5 * 1024 * 1024,
            "Swagger/OpenAPI",
        )?;
        let final_url = response.url().to_string();
        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_string();
        let body = read_limited_response(response, 5 * 1024 * 1024, "Swagger/OpenAPI").await?;
        if content_type.contains("html") || body.trim_start().starts_with('<') {
            let expression =
                regex::Regex::new(r#"(?:url|configUrl)\s*[:=]\s*[\"']([^\"']+)"#).unwrap();
            current = expression
                .captures(&body)
                .and_then(|captures| captures.get(1))
                .map(|value| parsed.join(value.as_str()).map(|url| url.to_string()))
                .transpose()
                .map_err(|e| e.to_string())?
                .ok_or("这是 Swagger UI 页面，但没有发现规范 URL；请直接粘贴 JSON/YAML 规范地址")?;
            continue;
        }
        return parse(&body, &final_url);
    }
    Err("Swagger UI 自动发现超过最大跳转次数".into())
}

pub async fn discover_candidates(url: String) -> Result<Vec<String>, String> {
    let parsed = url::Url::parse(&url).map_err(|_| "Swagger URL 不是有效地址".to_string())?;
    validate_https_or_debug_local(&parsed, "Swagger/OpenAPI 地址")?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| e.to_string())?;
    let response = client
        .get(parsed.clone())
        .send()
        .await
        .map_err(|e| format!("获取 Swagger 失败：{e}"))?;
    validate_content_length(
        response.content_length(),
        5 * 1024 * 1024,
        "Swagger/OpenAPI",
    )?;
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .to_string();
    let body = read_limited_response(response, 5 * 1024 * 1024, "Swagger/OpenAPI").await?;
    if !content_type.contains("html") && !body.trim_start().starts_with('<') {
        return Ok(vec![url]);
    }
    extract_static_candidates(&body, &parsed)
}

fn extract_static_candidates(body: &str, base: &url::Url) -> Result<Vec<String>, String> {
    let patterns = [
        r#"(?:url|configUrl)\s*[:=]\s*[\"']([^\"']+)"#,
        r#"[\"']url[\"']\s*:\s*[\"']([^\"']+)"#,
    ];
    let mut candidates = Vec::new();
    for pattern in patterns {
        let expression = regex::Regex::new(pattern).map_err(|error| error.to_string())?;
        for capture in expression.captures_iter(&body) {
            let Some(value) = capture.get(1) else {
                continue;
            };
            let candidate = base
                .join(value.as_str())
                .map_err(|error| error.to_string())?
                .to_string();
            if !candidates.contains(&candidate) {
                candidates.push(candidate);
            }
        }
    }
    if candidates.is_empty() {
        return Err(
            "这是 Swagger UI 页面，但没有发现规范 URL；请直接粘贴 JSON/YAML 规范地址".into(),
        );
    }
    Ok(candidates)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn counts_operations() {
        let document = r#"{"openapi":"3.0.0","info":{"title":"Demo","version":"1"},"paths":{"/items":{"get":{},"post":{}}}}"#;
        assert_eq!(
            parse(document, "https://example.com/openapi.json")
                .unwrap()
                .operation_count,
            2
        );
    }

    #[test]
    fn parses_swagger_two_yaml_and_resolves_base_path() {
        let document = "swagger: '2.0'\ninfo:\n  title: Legacy\n  version: '2'\nhost: api.example.com\nbasePath: /v1\nschemes: [https]\npaths:\n  /items:\n    get:\n      operationId: listItems\n";
        let summary = parse(document, "https://docs.example.com/swagger.yaml").unwrap();
        assert_eq!(summary.spec_version, "2.0");
        assert_eq!(summary.api_base_url, "https://api.example.com/v1");
        assert_eq!(summary.operation_count, 1);
    }

    #[test]
    fn parses_openapi_three_one_yaml() {
        let document = "openapi: 3.1.0\ninfo:\n  title: Modern\n  version: '1'\nservers:\n  - url: https://api.example.com/v2\npaths:\n  /items/{id}:\n    get:\n      operationId: getItem\n";
        let summary = parse(document, "https://docs.example.com/openapi.yaml").unwrap();
        assert_eq!(summary.spec_version, "3.1.0");
        assert_eq!(summary.api_base_url, "https://api.example.com/v2");
        assert_eq!(summary.operations[0], "GET /items/{id} · getItem");
    }

    #[test]
    fn discovers_multiple_swagger_ui_spec_urls_without_running_scripts() {
        let base = url::Url::parse("https://docs.example.com/swagger/index.html").unwrap();
        let html = r#"<script>urls: [{url: '/openapi/public.json'}, {url: '/openapi/admin.yaml'}]</script>"#;
        let candidates = extract_static_candidates(html, &base).unwrap();
        assert_eq!(candidates.len(), 2);
        assert!(candidates[0].contains("public.json"));
    }
}
