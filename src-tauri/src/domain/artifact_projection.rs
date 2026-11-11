//! Defense-in-depth structural projection for persisted artifacts.
//!
//! The front end already projects definitions before IPC. Rust re-validates and
//! re-projects every payload at save/import/export/version-restore boundaries so
//! a stale history row, a hand-edited import or a different host cannot reintroduce
//! loaded business data, custom payloads or cross-project credentials.

use serde_json::{Map, Value};

pub const DEFAULT_WRITE_VERSION: u8 = 1;
pub const MAX_ARTIFACT_BYTES: usize = 2 * 1024 * 1024;
pub const SESSION_PROMPT_MAX_BYTES: usize = 8 * 1024;
const MAX_TEXT_BYTES: usize = 512;
const MAX_DEPTH: usize = 8;

/// Only structural keys survive. Everything else (including unknown keys) is dropped.
const ALLOWED_KEYS: &[&str] = &[
    "version",
    "title",
    "description",
    "layout",
    "breadcrumb",
    "permissionRole",
    "createdAt",
    "updatedAt",
    "filters",
    "columns",
    "columnMeta",
    "operations",
    "views",
    "interaction",
    "batchActions",
    "theme",
    "styleTokens",
    "name",
    "type",
    "format",
    "width",
    "searchMode",
    "sortable",
    "filterable",
    "visible",
    "enumLabels",
    "operation_id",
    "method",
    "path",
    "role",
    "confirmMessage",
    "sortParam",
    "pagination",
    "pageParam",
    "sizeParam",
    "defaultSize",
    "bodySchema",
    "required",
    "enumValues",
    "visibleWhen",
    "field",
    "equals",
    "chartType",
    "xAxisColumn",
    "yAxisColumn",
    "groupByColumn",
    "groupColumn",
    "cardFields",
    "splitRatio",
    "items",
    "left",
    "right",
    "key",
    "label",
    "view",
    "order",
    "column",
    "payloadBuilder",
    "radius",
    "density",
    "primary",
    "primaryBg",
    "primaryBgHover",
    "surface",
    "surfaceAlt",
    "surfaceControl",
    "border",
    "borderControl",
    "focusRing",
    "text",
    "textMuted",
    "textSubtle",
    "danger",
    "dangerBg",
    "success",
    "constraints",
    "min",
    "max",
    "minLength",
    "maxLength",
    "pattern",
    "nullable",
    "readonly",
];

/// Fields that carry data or environment bindings rather than structure.
const DATA_KEYS: &[&str] = &[
    "rows",
    "stats",
    "customPayload",
    "sample",
    "sampleResponse",
    "response",
    "records",
    "cells",
    "rawBody",
    "body",
    "draft",
    "formDraft",
    "formValues",
    "defaultValue",
    "value",
    "prompt",
    "headers",
    "customHeaders",
    "auth",
    "credentials",
    "token",
    "apiKey",
    "secret",
    "secretRef",
    "baseUrl",
    "apiBaseUrl",
    "apiDocumentId",
];

fn walk(value: Value, depth: usize) -> Value {
    if depth > MAX_DEPTH {
        return Value::Null;
    }
    match value {
        Value::Object(map) => {
            let mut output = Map::new();
            for (key, item) in map {
                if !ALLOWED_KEYS.contains(&key.as_str()) {
                    continue;
                }
                let projected = walk(item, depth + 1);
                if !projected.is_null() {
                    output.insert(key, projected);
                }
            }
            Value::Object(output)
        }
        Value::Array(items) => Value::Array(
            items
                .into_iter()
                .map(|item| walk(item, depth + 1))
                .filter(|item| !item.is_null())
                .collect(),
        ),
        Value::String(text) => {
            if text.len() <= MAX_TEXT_BYTES {
                Value::String(text)
            } else {
                Value::String(text.chars().take(MAX_TEXT_BYTES).collect())
            }
        }
        other => other,
    }
}

fn contains_data(value: &Value, depth: usize) -> bool {
    if depth > MAX_DEPTH {
        return true;
    }
    match value {
        Value::Object(map) => map.iter().any(|(key, item)| {
            let empty = matches!(item, Value::Null)
                || matches!(item, Value::Array(items) if items.is_empty())
                || matches!(item, Value::String(text) if text.is_empty());
            (DATA_KEYS.contains(&key.as_str()) && !empty) || contains_data(item, depth + 1)
        }),
        Value::Array(items) => items.iter().any(|item| contains_data(item, depth + 1)),
        _ => false,
    }
}

/// Rebuild a v1 payload from the structural allowlist and re-serialize it.
pub fn project_payload(raw: &str) -> Result<String, String> {
    if raw.len() > MAX_ARTIFACT_BYTES {
        return Err("页面定义超过大小限制".into());
    }
    let value: Value =
        serde_json::from_str(raw).map_err(|_| "页面定义 JSON 无法解析".to_string())?;
    if !value.is_object() {
        return Err("页面定义必须是对象".into());
    }
    serde_json::to_string(&walk(value, 0)).map_err(|_| "页面定义投影失败".to_string())
}

/// True when a stored payload still carries data or environment bindings.
pub fn has_payload_data(raw: &str) -> Result<bool, String> {
    let value: Value =
        serde_json::from_str(raw).map_err(|_| "页面定义 JSON 无法解析".to_string())?;
    Ok(contains_data(&value, 0))
}

pub fn validate_session_prompt(prompt: &str) -> Result<(), String> {
    if prompt.len() > SESSION_PROMPT_MAX_BYTES {
        return Err("生成提示超过会话保留上限".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn polluted() -> Value {
        json!({
            "version": 1, "title": "Orders", "description": "",
            "filters": [], "columns": ["id"], "rows": [["secret-marker-row"]],
            "stats": [{"label": "count", "value": "secret-marker-stat"}],
            "batchActions": [{"operation_id":"batchDelete","method":"DELETE","path":"/orders",
                "payloadBuilder":{"type":"custom","customPayload":"secret-marker-payload"}}],
            "headers": {"Authorization": "secret-marker-header"},
            "draft": "secret-marker-draft",
            "secretRef": "secret-marker-secret", "apiDocumentId": "other-project-doc",
            "operations": [{"operation_id":"listOrders","method":"GET","path":"/orders","role":"list"}],
            "views": [{"type":"tabs","title":"Tabs","items":[{"key":"a","label":"A",
                "view":{"type":"list","title":"List","rows":[["secret-marker-nested"]]}}]}]
        })
    }

    #[test]
    fn projection_drops_every_injected_data_and_environment_value() {
        let projected = project_payload(&polluted().to_string()).unwrap();
        for marker in [
            "secret-marker-row",
            "secret-marker-stat",
            "secret-marker-payload",
            "secret-marker-header",
            "secret-marker-draft",
            "secret-marker-secret",
            "other-project-doc",
            "secret-marker-nested",
        ] {
            assert!(!projected.contains(marker), "leaked {marker}");
        }
        let value: Value = serde_json::from_str(&projected).unwrap();
        assert_eq!(value["title"], "Orders");
        assert_eq!(value["columns"][0], "id");
        assert_eq!(value["operations"][0]["operation_id"], "listOrders");
        assert_eq!(value["views"][0]["items"][0]["view"]["type"], "list");
        assert!(value.get("rows").is_none());
        assert!(value.get("stats").is_none());
    }

    #[test]
    fn projection_is_idempotent_and_keeps_nested_structure() {
        let first = project_payload(&polluted().to_string()).unwrap();
        let second = project_payload(&first).unwrap();
        assert_eq!(first, second);
    }

    #[test]
    fn data_detection_accepts_projected_payloads_only() {
        assert!(has_payload_data(&polluted().to_string()).unwrap());
        assert!(!has_payload_data(&project_payload(&polluted().to_string()).unwrap()).unwrap());
    }

    #[test]
    fn invalid_input_has_stable_errors_without_echoing_content() {
        for raw in [
            "[1,2]".to_string(),
            "null".to_string(),
            "{\"rows\":".to_string(),
            "x".repeat(MAX_ARTIFACT_BYTES + 1),
        ] {
            let error = project_payload(&raw).unwrap_err();
            assert!(!error.contains("secret"), "{error}");
        }
    }

    #[test]
    fn oversized_text_is_bounded_and_default_write_version_stays_v1() {
        let value = json!({"title": "secret-marker-".repeat(200), "columns": []});
        let projected = project_payload(&value.to_string()).unwrap();
        assert!(projected.len() < 1024);
        assert_eq!(DEFAULT_WRITE_VERSION, 1);
        assert!(validate_session_prompt(&"a".repeat(SESSION_PROMPT_MAX_BYTES)).is_ok());
        assert!(validate_session_prompt(&"a".repeat(SESSION_PROMPT_MAX_BYTES + 1)).is_err());
    }
}
