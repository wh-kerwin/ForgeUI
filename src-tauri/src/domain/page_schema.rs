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

#[cfg(test)]
mod tests {
    use super::decode_json;

    #[test]
    fn repairs_json_wrapped_in_explanatory_text_once() {
        assert!(decode_json("结果如下： {\"title\":\"设备\"} 完成").is_ok());
        assert!(decode_json("结果尚未完成").is_err());
    }
}
