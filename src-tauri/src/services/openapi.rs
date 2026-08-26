use crate::services::url_security::{
    read_limited_response, validate_content_length, validate_https_or_debug_local,
};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
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
    #[serde(rename = "fieldSchemas")]
    pub field_schemas: HashMap<String, Vec<FieldSchema>>,
    #[serde(rename = "queryParameters")]
    pub query_parameters: HashMap<String, Vec<String>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldSchema {
    pub name: String,
    pub r#type: String,
    pub enum_values: Option<Vec<String>>,
    pub required: bool,
    pub description: Option<String>,
    pub visible_when: Option<VisibleWhen>,
}

#[derive(Debug, Clone, Serialize)]
pub struct VisibleWhen {
    pub field: String,
    pub equals: VisibilityEquals,
}

#[derive(Debug, Clone, Serialize)]
#[serde(untagged)]
pub enum VisibilityEquals {
    One(String),
    Many(Vec<String>),
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
            url::Url::parse(server)
                .ok()
                .or_else(|| {
                    url::Url::parse(source)
                        .ok()
                        .and_then(|base| base.join(server).ok())
                })
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
    let mut field_schemas = HashMap::new();
    let mut query_parameters = HashMap::new();
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
                        field_schemas.insert(
                            operation_id.to_string(),
                            extract_field_schemas(&value, path, operation, &spec_version),
                        );
                        query_parameters.insert(
                            operation_id.to_string(),
                            extract_query_parameters(&value, item, operation),
                        );
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
        field_schemas,
        query_parameters,
    })
}

fn extract_query_parameters(
    root: &serde_json::Value,
    path_item: &serde_json::Value,
    operation: &serde_json::Value,
) -> Vec<String> {
    let mut names = Vec::new();
    let mut seen = HashSet::new();
    for parameters in [path_item.get("parameters"), operation.get("parameters")] {
        for parameter in parameters.and_then(|value| value.as_array()).into_iter().flatten() {
            let parameter = resolve_parameter_reference(root, parameter);
            let name = parameter.get("name").and_then(|value| value.as_str());
            if parameter.get("in").and_then(|value| value.as_str()) == Some("query") {
                if let Some(name) = name.filter(|name| !name.trim().is_empty()) {
                    if seen.insert(name.to_string()) {
                        names.push(name.to_string());
                    }
                }
            }
        }
    }
    names
}

fn resolve_parameter_reference<'a>(root: &'a serde_json::Value, parameter: &'a serde_json::Value) -> &'a serde_json::Value {
    parameter
        .get("$ref")
        .and_then(|value| value.as_str())
        .and_then(|reference| reference.strip_prefix('#'))
        .and_then(|pointer| root.pointer(pointer))
        .unwrap_or(parameter)
}

fn extract_field_schemas(
    root: &serde_json::Value,
    path: &str,
    operation: &serde_json::Value,
    spec_version: &str,
) -> Vec<FieldSchema> {
    let mut fields = Vec::new();
    if let Some(body_schema) = request_body_schema(root, operation, spec_version) {
        if let Some(properties) = body_schema
            .get("properties")
            .and_then(|item| item.as_object())
        {
            let required = body_schema
                .get("required")
                .and_then(|item| item.as_array())
                .map(|items| {
                    items
                        .iter()
                        .filter_map(|item| item.as_str())
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            for (name, schema) in properties {
                fields.push(field_from_schema(
                    name,
                    schema,
                    required.contains(&name.as_str()),
                ));
            }
        } else if let Some(name) = path.split('/').next_back().filter(|name| !name.is_empty()) {
            fields.push(field_from_schema(name, body_schema, false));
        }
    }
    fields
}

fn request_body_schema<'a>(
    root: &'a serde_json::Value,
    operation: &'a serde_json::Value,
    spec_version: &str,
) -> Option<&'a serde_json::Value> {
    if spec_version.starts_with('2') {
        operation
            .get("parameters")?
            .as_array()?
            .iter()
            .find(|parameter| parameter.get("in").and_then(|v| v.as_str()) == Some("body"))
            .and_then(|parameter| parameter.get("schema"))
            .map(|schema| resolve_schema(root, schema))
    } else {
        operation
            .get("requestBody")?
            .get("content")?
            .as_object()?
            .values()
            .next()?
            .get("schema")
            .map(|schema| resolve_schema(root, schema))
    }
}

fn resolve_schema<'a>(
    root: &'a serde_json::Value,
    schema: &'a serde_json::Value,
) -> &'a serde_json::Value {
    schema
        .get("$ref")
        .and_then(|reference| reference.as_str())
        .and_then(|reference| reference.strip_prefix("#/"))
        .and_then(|pointer| root.pointer(&format!("/{pointer}")))
        .unwrap_or(schema)
}

fn field_from_schema(name: &str, schema: &serde_json::Value, required: bool) -> FieldSchema {
    let format = schema.get("format").and_then(|value| value.as_str());
    let enum_values = schema
        .get("enum")
        .and_then(|values| values.as_array())
        .map(|values| {
            values
                .iter()
                .filter_map(|value| value.as_str().map(ToOwned::to_owned))
                .collect::<Vec<_>>()
        })
        .filter(|values| !values.is_empty());
    let r#type = if enum_values.is_some() {
        "enum"
    } else if format == Some("date") || format == Some("date-time") {
        "date"
    } else {
        match schema
            .get("type")
            .and_then(|value| value.as_str())
            .unwrap_or("string")
        {
            "number" | "integer" | "boolean" | "string" => schema
                .get("type")
                .and_then(|value| value.as_str())
                .unwrap_or("string"),
            _ => "string",
        }
    };
    FieldSchema {
        name: name.to_string(),
        r#type: r#type.to_string(),
        enum_values,
        required,
        description: schema
            .get("description")
            .and_then(|value| value.as_str())
            .map(ToOwned::to_owned),
        visible_when: extract_visible_when(schema),
    }
}

fn extract_visible_when(schema: &serde_json::Value) -> Option<VisibleWhen> {
    let condition = schema
        .get("x-visible-when")
        .or_else(|| schema.get("x-visibleWhen"))?;
    let field = condition.get("field")?.as_str()?.trim();
    if field.is_empty() {
        return None;
    }
    let equals = match condition.get("equals")? {
        serde_json::Value::String(value) => VisibilityEquals::One(value.clone()),
        serde_json::Value::Array(values) => {
            let values = values
                .iter()
                .map(|value| value.as_str().map(ToOwned::to_owned))
                .collect::<Option<Vec<_>>>()?;
            if values.is_empty() {
                return None;
            }
            VisibilityEquals::Many(values)
        }
        _ => return None,
    };
    Some(VisibleWhen {
        field: field.to_string(),
        equals,
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
    fn uses_absolute_server_url_for_local_file_imports() {
        let document = r#"{"openapi":"3.0.3","info":{"title":"Local","version":"1"},"servers":[{"url":"http://localhost:3000"}],"paths":{}}"#;
        let summary = parse(document, "local-file").unwrap();
        assert_eq!(summary.api_base_url, "http://localhost:3000/");
    }

    #[test]
    fn extracts_typed_request_fields_and_parameters() {
        let document = serde_json::json!({
            "openapi": "3.0.0",
            "info": {"title": "Demo", "version": "1"},
            "paths": {"/items": {"post": {
                "operationId": "createItem",
                "parameters": [{"name": "trace", "in": "header", "required": true, "schema": {"type": "string"}}],
                "requestBody": {"content": {"application/json": {"schema": {
                    "type": "object",
                    "required": ["status"],
                    "properties": {
                        "status": {"type": "string", "enum": ["new", "done"]},
                        "count": {"type": "integer"},
                        "when": {"type": "string", "format": "date"},
                        "reason": {"type": "string", "x-visible-when": {"field": "status", "equals": "done"}}
                    }
                }}}
            }}}}
        }).to_string();
        let summary = parse(&document, "https://example.com/openapi.json").unwrap();
        let fields = &summary.field_schemas["createItem"];
        assert_eq!(
            fields
                .iter()
                .find(|field| field.name == "status")
                .unwrap()
                .r#type,
            "enum"
        );
        assert!(
            fields
                .iter()
                .find(|field| field.name == "status")
                .unwrap()
                .required
        );
        assert_eq!(
            fields
                .iter()
                .find(|field| field.name == "count")
                .unwrap()
                .r#type,
            "integer"
        );
        assert_eq!(
            fields
                .iter()
                .find(|field| field.name == "when")
                .unwrap()
                .r#type,
            "date"
        );
        let condition = fields
            .iter()
            .find(|field| field.name == "reason")
            .unwrap()
            .visible_when
            .as_ref()
            .unwrap();
        assert_eq!(condition.field, "status");
        assert!(matches!(
            &condition.equals,
            VisibilityEquals::One(value) if value == "done"
        ));
    }

    #[test]
    fn extracts_operation_and_path_query_parameters_in_document_order() {
        let document = serde_json::json!({
            "openapi": "3.0.0",
            "info": {"title": "Products", "version": "1"},
            "components": {"parameters": {"Sort": {"name": "sort", "in": "query", "schema": {"type": "string"}}}},
            "paths": {"/products": {
                "parameters": [{"name": "page", "in": "query", "schema": {"type": "integer"}}],
                "get": {
                    "operationId": "listProducts",
                    "parameters": [
                        {"name": "pageSize", "in": "query", "schema": {"type": "integer"}},
                        {"name": "keyword", "in": "query", "schema": {"type": "string"}},
                        {"name": "category", "in": "query", "schema": {"type": "string"}},
                        {"name": "minPrice", "in": "query", "schema": {"type": "number"}},
                        {"name": "maxPrice", "in": "query", "schema": {"type": "number"}},
                        {"$ref": "#/components/parameters/Sort"},
                        {"name": "authorization", "in": "header", "schema": {"type": "string"}}
                    ]
                }
            }}
        }).to_string();
        let summary = parse(&document, "https://example.com/openapi.json").unwrap();
        assert_eq!(summary.query_parameters["listProducts"], ["page", "pageSize", "keyword", "category", "minPrice", "maxPrice", "sort"]);
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
