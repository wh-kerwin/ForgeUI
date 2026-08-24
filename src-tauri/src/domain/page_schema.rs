use serde_json::{json, Value};

pub fn schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": ["title", "description", "filters", "stats", "columns", "rows"],
        "properties": {
            "title": {"type": "string", "maxLength": 120},
            "description": {"type": "string", "maxLength": 1000},
            "filters": {"type": "array", "maxItems": 20, "items": {"type": "string"}},
            "stats": {"type": "array", "maxItems": 20, "items": {"type": "object", "additionalProperties": false, "required": ["label", "value"], "properties": {"label": {"type": "string"}, "value": {"type": "string"}}}},
            "columns": {"type": "array", "maxItems": 50, "items": {"type": "string"}},
            "rows": {"type": "array", "maxItems": 100, "items": {"type": "array", "items": {"type": "string"}}},
            "version": {"type": "integer", "const": 1},
            "operations": {"type": "array", "maxItems": 30, "items": {"type": "object", "additionalProperties": false, "required": ["operation_id", "method", "path", "role"], "properties": {"operation_id": {"type": "string"}, "method": {"enum": ["GET", "POST", "PUT", "PATCH", "DELETE"]}, "path": {"type": "string"}, "role": {"enum": ["list", "detail", "create", "update", "delete", "stats", "read"]}}}}
        }
    })
}

pub fn decode_json(content: &str) -> Result<Value, String> {
    let trimmed = content
        .trim()
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim();
    serde_json::from_str(trimmed)
        .or_else(|_| {
            let start = trimmed
                .find('{')
                .ok_or_else(|| "模型输出不包含 JSON 对象".to_string())?;
            let end = trimmed
                .rfind('}')
                .ok_or_else(|| "模型输出 JSON 不完整".to_string())?;
            if end <= start {
                return Err("模型输出 JSON 不完整".into());
            }
            serde_json::from_str(&trimmed[start..=end])
                .map_err(|_| "模型输出 JSON 无法修复".to_string())
        })
        .map_err(|error: String| format!("模型输出不符合 PageSpec：{error}"))
}

/// Apply one bounded, deterministic repair pass to common model deviations.
/// This never introduces executable content or unknown operations; it only
/// converts display-oriented values into the string shapes PageSpec accepts.
pub fn normalize_page_spec(mut value: Value) -> Value {
    let Some(page) = value.as_object_mut() else {
        return value;
    };

    let column_keys = page
        .get("columns")
        .and_then(Value::as_array)
        .map(|columns| columns.iter().map(column_key).collect::<Vec<_>>())
        .unwrap_or_default();
    let column_count = page
        .get("columns")
        .and_then(Value::as_array)
        .map_or(0, Vec::len);

    for field in ["filters", "columns"] {
        if let Some(items) = page.get_mut(field).and_then(Value::as_array_mut) {
            for item in items {
                *item = Value::String(display_string(item));
            }
        }
    }

    if let Some(stats) = page.get_mut("stats").and_then(Value::as_array_mut) {
        for (index, stat) in stats.iter_mut().enumerate() {
            if let Some(item) = stat.as_object_mut() {
                let label = item
                    .get("label")
                    .or_else(|| item.get("name"))
                    .or_else(|| item.get("title"))
                    .map(display_string)
                    .filter(|value| !value.is_empty())
                    .unwrap_or_else(|| format!("Metric {}", index + 1));
                let value = item
                    .get("value")
                    .or_else(|| item.get("result"))
                    .map(display_string)
                    .unwrap_or_default();
                *stat = serde_json::json!({"label": label, "value": value});
            } else {
                let value = display_string(stat);
                *stat =
                    serde_json::json!({"label": format!("Metric {}", index + 1), "value": value});
            }
        }
    }

    if let Some(rows) = page.get_mut("rows").and_then(Value::as_array_mut) {
        for row in rows {
            let cells = match row {
                Value::Array(items) => items.iter().map(display_string).collect(),
                Value::Object(item) if !column_keys.is_empty() => column_keys
                    .iter()
                    .map(|key| item.get(key).map(display_string).unwrap_or_default())
                    .collect(),
                Value::Object(item) => item.values().map(display_string).collect(),
                ref other => vec![display_string(other)],
            };
            let mut normalized = cells;
            normalized.truncate(column_count);
            normalized.resize(column_count, String::new());
            *row = Value::Array(normalized.into_iter().map(Value::String).collect());
        }
    }

    value
}

fn column_key(value: &Value) -> String {
    if let Some(value) = value.as_str() {
        return value.to_string();
    }
    ["key", "field", "id", "name", "label"]
        .iter()
        .find_map(|key| value.get(key).and_then(Value::as_str))
        .unwrap_or_default()
        .to_string()
}

fn display_string(value: &Value) -> String {
    match value {
        Value::String(value) => value.clone(),
        Value::Null => String::new(),
        Value::Bool(value) => value.to_string(),
        Value::Number(value) => value.to_string(),
        Value::Object(_) => ["label", "title", "name", "value", "field", "key", "id"]
            .iter()
            .find_map(|key| value.get(key))
            .map(display_string)
            .unwrap_or_else(|| serde_json::to_string(value).unwrap_or_default()),
        Value::Array(_) => serde_json::to_string(value).unwrap_or_default(),
    }
}

#[cfg(test)]
mod tests {
    use super::{decode_json, normalize_page_spec};

    #[test]
    fn repairs_json_wrapped_in_explanatory_text_once() {
        assert!(decode_json("结果如下： {\"title\":\"设备\"} 完成").is_ok());
        assert!(decode_json("结果尚未完成").is_err());
    }

    #[test]
    fn normalizes_object_columns_filters_and_rows_once() {
        let input = serde_json::json!({
            "title": "Devices",
            "description": "Inventory",
            "filters": [{"field": "status", "label": "Status"}],
            "stats": [{"name": "Total", "value": 12}],
            "columns": [{"key": "name", "label": "Name"}, {"key": "status", "label": "Status"}],
            "rows": [{"status": "online", "name": "Router"}]
        });
        let normalized = normalize_page_spec(input);
        assert_eq!(normalized["filters"][0], "Status");
        assert_eq!(normalized["columns"][0], "Name");
        assert_eq!(normalized["stats"][0]["value"], "12");
        assert_eq!(
            normalized["rows"][0],
            serde_json::json!(["Router", "online"])
        );
    }

    #[test]
    fn normalizes_short_and_long_rows_to_column_count() {
        let input = serde_json::json!({
            "title": "Devices",
            "description": "",
            "filters": [],
            "stats": [],
            "columns": ["Name", "Status", "Region"],
            "rows": [["Router"], ["Switch", "offline", "East", "extra"]]
        });
        let normalized = normalize_page_spec(input);
        assert_eq!(normalized["rows"][0], serde_json::json!(["Router", "", ""]));
        assert_eq!(
            normalized["rows"][1],
            serde_json::json!(["Switch", "offline", "East"])
        );
    }
}
