use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};

/// Provider compatibility projection only; the shared v2 schema remains authoritative.
pub fn v2_provider_schema(strict: bool) -> Value {
    let mut schema: Value = serde_json::from_str(include_str!(
        "../../../contracts/page-definition-v2.schema.json"
    ))
    .expect("embedded schema");
    if strict {
        project_v2_strict(&mut schema);
    }
    schema
}

// Compatibility inventory: strip dialect/id annotations and string/number/array
// limits/patterns (host rechecks); const -> typed enum; oneOf -> anyOf (host
// rechecks exclusivity); optional -> required nullable (transport adapter only).
// No Anthropic native strict claim: its existing transport is prompt-only.
fn project_v2_strict(value: &mut Value) {
    let Some(object) = value.as_object_mut() else {
        return;
    };
    for keyword in [
        "$schema",
        "$id",
        "minLength",
        "maxLength",
        "pattern",
        "minimum",
        "maximum",
        "minItems",
        "maxItems",
    ] {
        object.remove(keyword);
    }
    if let Some(value) = object.remove("const") {
        object.insert(
            "type".into(),
            json!(if value.is_string() {
                "string"
            } else {
                "integer"
            }),
        );
        object.insert("enum".into(), json!([value]));
    }
    if object.contains_key("enum") && !object.contains_key("type") {
        object.insert("type".into(), json!("string"));
    }
    if let Some(branches) = object.remove("oneOf") {
        object.insert("anyOf".into(), branches);
    }
    let required = object
        .get("required")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    if let Some(properties) = object.get_mut("properties").and_then(Value::as_object_mut) {
        let keys: Vec<Value> = properties.keys().map(|key| json!(key)).collect();
        for (key, property) in properties.iter_mut() {
            project_v2_strict(property);
            if !required.contains(&json!(key)) {
                *property = json!({"anyOf": [property.clone(), {"type":"null"}]});
            }
        }
        object.insert("required".into(), Value::Array(keys));
    }
    if let Some(defs) = object.get_mut("$defs").and_then(Value::as_object_mut) {
        for definition in defs.values_mut() {
            project_v2_strict(definition);
        }
    }
    if let Some(items) = object.get_mut("items") {
        project_v2_strict(items);
    }
    if let Some(branches) = object.get_mut("anyOf").and_then(Value::as_array_mut) {
        for branch in branches {
            project_v2_strict(branch);
        }
    }
}

pub fn adapt_v2_strict_output(mut value: Value) -> Result<(Value, bool), String> {
    let schema = v2_provider_schema(false);
    let changed = adapt_v2_node(&mut value, &schema, &schema)?;
    Ok((value, changed))
}

fn adapt_v2_node(value: &mut Value, schema: &Value, root: &Value) -> Result<bool, String> {
    if let Some(reference) = schema.get("$ref").and_then(Value::as_str) {
        let target = reference
            .strip_prefix('#')
            .and_then(|pointer| root.pointer(pointer))
            .ok_or("invalid schema reference")?;
        return adapt_v2_node(value, target, root);
    }
    if let Some(branches) = schema.get("oneOf").and_then(Value::as_array) {
        // Authoritative v2 view unions use a required const discriminator. Do
        // not infer a branch from optional values or accept ambiguous input.
        let matches: Vec<_> = branches
            .iter()
            .filter(|branch| {
                branch
                    .get("properties")
                    .and_then(Value::as_object)
                    .is_some_and(|properties| {
                        let constants: Vec<_> = properties
                            .iter()
                            .filter_map(|(key, spec)| {
                                spec.get("const").map(|constant| (key, constant))
                            })
                            .collect();
                        !constants.is_empty()
                            && constants
                                .iter()
                                .all(|(key, constant)| value.get(*key) == Some(*constant))
                    })
            })
            .collect();
        if matches.len() != 1 {
            return Err("ambiguous provider schema branch".into());
        }
        return adapt_v2_node(value, matches[0], root);
    }
    let mut changed = false;
    if let (Some(object), Some(properties)) = (
        value.as_object_mut(),
        schema.get("properties").and_then(Value::as_object),
    ) {
        let required = schema
            .get("required")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        for (key, property) in properties {
            if object.get(key).is_some_and(Value::is_null) && !required.contains(&json!(key)) {
                object.remove(key);
                changed = true;
            } else if let Some(child) = object.get_mut(key) {
                changed |= adapt_v2_node(child, property, root)?;
            }
        }
    }
    if let (Some(items), Some(item_schema)) = (value.as_array_mut(), schema.get("items")) {
        for item in items {
            changed |= adapt_v2_node(item, item_schema, root)?;
        }
    }
    Ok(changed)
}

#[cfg(test)]
mod v2_projection_tests {
    use super::*;

    #[test]
    fn strict_projection_requires_nullable_optionals_and_preserves_authority() {
        let authoritative = v2_provider_schema(false);
        let strict = v2_provider_schema(true);
        assert!(strict["required"]
            .as_array()
            .unwrap()
            .contains(&json!("layout")));
        assert_eq!(
            strict["properties"]["layout"]["anyOf"][1],
            json!({"type":"null"})
        );
        assert_eq!(
            strict["properties"]["styleTokens"]["anyOf"][0]["$ref"],
            "#/$defs/styleTokens"
        );
        assert!(
            strict["$defs"]["view"]["anyOf"][0]["properties"]["defaultSort"]["anyOf"][1]["type"]
                == "null"
        );
        assert_eq!(
            strict["$defs"]["styleTokens"]["properties"]["primary"]["anyOf"][1]["type"],
            "null"
        );
        assert_eq!(
            strict["properties"]["version"],
            json!({"type":"integer", "enum":[2]})
        );
        assert!(strict["$defs"]["view"].get("oneOf").is_none());
        assert!(strict["$defs"]["view"]["anyOf"].is_array());
        assert_eq!(authoritative["properties"]["version"], json!({"const":2}));
        assert!(!authoritative["required"]
            .as_array()
            .unwrap()
            .contains(&json!("layout")));
    }

    fn assert_provider_subset(schema: &Value, path: &str, issues: &mut Vec<String>) {
        let Value::Object(object) = schema else {
            return;
        };
        for keyword in [
            "$schema",
            "$id",
            "const",
            "oneOf",
            "minLength",
            "maxLength",
            "pattern",
            "minimum",
            "maximum",
            "minItems",
            "maxItems",
        ] {
            if object.contains_key(keyword) {
                issues.push(format!("{path}/{keyword}"));
            }
        }
        if let Some(properties) = object.get("properties").and_then(Value::as_object) {
            if object.get("additionalProperties") != Some(&json!(false)) {
                issues.push(format!("{path}/additionalProperties"));
            }
            let required = object
                .get("required")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            for key in properties.keys() {
                if !required.contains(&json!(key)) {
                    issues.push(format!("{path}/optional:{key}"));
                }
            }
        }
        for (key, value) in object {
            if key == "properties" {
                // The properties map holds field names, not schema keywords;
                // only its values are schema nodes.
                for (name, property) in value.as_object().unwrap() {
                    assert_provider_subset(property, &format!("{path}/properties/{name}"), issues);
                }
            } else {
                assert_provider_subset(value, &format!("{path}/{key}"), issues);
            }
        }
    }

    #[test]
    fn strict_projection_stays_within_declared_provider_subset() {
        let strict = v2_provider_schema(true);
        let mut issues = Vec::new();
        assert_provider_subset(&strict, "", &mut issues);
        assert!(issues.is_empty(), "unsupported strict keywords: {issues:?}");
    }

    #[test]
    fn strict_adapter_only_removes_declared_optional_nulls_in_matching_branches() {
        let mut original: Value = serde_json::from_str(include_str!(
            "../../../contracts/fixtures/v2/minimal-v2.json"
        ))
        .unwrap();
        original["dataSources"]["primary"]
            .as_object_mut()
            .unwrap()
            .remove("totalPointer");
        let (unchanged, changed) = adapt_v2_strict_output(original.clone()).unwrap();
        assert_eq!(unchanged, original);
        assert!(!changed);
        let mut wire = original.clone();
        wire["layout"] = Value::Null;
        wire["dataSources"]["primary"]["totalPointer"] = Value::Null;
        wire["views"][0]["defaultSort"] = Value::Null;
        let (adapted, changed) = adapt_v2_strict_output(wire).unwrap();
        assert!(changed);
        assert_eq!(adapted, original);
        assert!(crate::domain::page_definition_v2::validate_raw(adapted).is_ok());
        let mut invalid = original.clone();
        invalid["title"] = Value::Null;
        invalid["unknown"] = Value::Null;
        invalid["fields"] = json!([null]);
        let (adapted, _) = adapt_v2_strict_output(invalid.clone()).unwrap();
        assert_eq!(adapted, invalid);
        let issues = crate::domain::page_definition_v2::validate_raw(adapted)
            .err()
            .unwrap();
        assert_eq!(issues[0].code, "PAGE_V2_SCHEMA_INVALID");
        let mut ambiguous = original;
        ambiguous["views"][0]["type"] = Value::Null;
        assert!(adapt_v2_strict_output(ambiguous).is_err());
    }
}

pub fn schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": ["title", "description", "filters", "stats", "columns", "rows"],
        "properties": {
            "title": {"type": "string", "maxLength": 120},
            "description": {"type": "string", "maxLength": 1000},
            "layout": {"enum": ["sidebar", "full", "modal"]},
            "breadcrumb": {"type": "array", "maxItems": 10, "items": {"type": "string", "maxLength": 120}},
            "permissionRole": {"type": "string", "maxLength": 120},
            "createdAt": {"type": "string", "maxLength": 120},
            "updatedAt": {"type": "string", "maxLength": 120},
            "filters": {"type": "array", "maxItems": 20, "items": {"type": "string"}},
            "stats": {"type": "array", "maxItems": 20, "items": {"type": "object", "additionalProperties": false, "required": ["label", "value"], "properties": {"label": {"type": "string"}, "value": {"type": "string"}}}},
            "columns": {"type": "array", "maxItems": 50, "items": {"type": "string"}},
            "columnMeta": {"type": "array", "maxItems": 50, "items": {"type": "object", "additionalProperties": false, "required": ["name", "type"], "properties": {"name": {"type": "string"}, "type": {"enum": ["string", "number", "date", "datetime", "enum", "boolean", "money"]}, "format": {"type": "string"}, "enumLabels": {"type": "object", "additionalProperties": {"type": "string"}}, "sortable": {"type": "boolean"}, "filterable": {"type": "boolean"}, "searchMode": {"enum": ["exact", "fuzzy", "range"]}, "width": {"type": "string"}, "visible": {"type": "boolean"}}}},
            "rows": {"type": "array", "maxItems": 100, "items": {"type": "array", "items": {"type": "string"}}},
            "version": {"type": "integer", "const": 1},
            "operations": {"type": "array", "maxItems": 30, "items": {"type": "object", "additionalProperties": false, "required": ["operation_id", "method", "path", "role"], "properties": {"apiDocumentId": {"type": "string", "minLength": 1, "maxLength": 120}, "operation_id": {"type": "string"}, "method": {"enum": ["GET", "POST", "PUT", "PATCH", "DELETE"]}, "path": {"type": "string"}, "role": {"enum": ["list", "detail", "create", "update", "delete", "stat", "export", "stats", "read"]}, "bodySchema": {"type": "array", "maxItems": 50, "items": {"$ref": "#/$defs/fieldSchema"}}, "confirmMessage": {"type": "string", "maxLength": 500}, "sortParam": {"type": "string"}, "pagination": {"type": "object", "additionalProperties": false, "required": ["pageParam", "sizeParam", "defaultSize"], "properties": {"pageParam": {"type": "string"}, "sizeParam": {"type": "string"}, "defaultSize": {"type": "integer", "minimum": 1, "maximum": 1000}}}}}}
            ,"views": {"type": "array", "maxItems": 10, "items": {"$ref": "#/$defs/pageView"}},
            "interaction": {"type": "object", "additionalProperties": false, "properties": {
                "create": {"enum": ["modal", "drawer", "inline", "redirect"]},
                "update": {"enum": ["modal", "drawer", "inline", "redirect"]},
                "delete": {"enum": ["modal", "drawer", "inline", "redirect"]},
                "detail": {"enum": ["modal", "drawer", "inline", "redirect"]}
            }},
            "batchActions": {"type": "array", "maxItems": 10, "items": {"type": "object", "additionalProperties": false, "required": ["operation_id", "method", "path", "payloadBuilder"], "properties": {"apiDocumentId": {"type": "string", "minLength": 1, "maxLength": 120}, "operation_id": {"type": "string"}, "method": {"enum": ["POST", "DELETE"]}, "path": {"type": "string"}, "confirmMessage": {"type": "string", "maxLength": 500}, "payloadBuilder": {"type": "object", "additionalProperties": false, "required": ["type"], "properties": {"type": {"enum": ["ids", "custom"]}, "customPayload": {"type": "string"}}}}}}
            ,"theme": {"enum": ["forge-default", "enterprise-blue", "clean-light", "minimal-dark", "custom"]}
            ,"styleTokens": {"type": "object", "additionalProperties": false, "properties": {
                "primary":{"$ref":"#/$defs/color"}, "primaryBg":{"$ref":"#/$defs/color"}, "primaryBgHover":{"$ref":"#/$defs/color"},
                "surface":{"$ref":"#/$defs/color"}, "surfaceAlt":{"$ref":"#/$defs/color"}, "surfaceControl":{"$ref":"#/$defs/color"},
                "border":{"$ref":"#/$defs/color"}, "borderControl":{"$ref":"#/$defs/color"}, "focusRing":{"$ref":"#/$defs/color"},
                "text":{"$ref":"#/$defs/color"}, "textMuted":{"$ref":"#/$defs/color"}, "textSubtle":{"$ref":"#/$defs/color"},
                "danger":{"$ref":"#/$defs/color"}, "dangerBg":{"$ref":"#/$defs/color"}, "success":{"$ref":"#/$defs/color"},
                "radius":{"enum":["none","sm","md","lg","full"]}, "density":{"enum":["compact","comfortable","relaxed"]}
            }}
        },
        "$defs": {
            "color": {"type":"string", "pattern":"^#(?:[0-9A-Fa-f]{3,4}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$"},
            "fieldSchema": {"type":"object", "additionalProperties":false, "required":["name","type","required"], "properties": {
                "name":{"type":"string","minLength":1,"maxLength":120},
                "type":{"enum":["string","number","integer","boolean","date","enum"]},
                "enumValues":{"type":"array","minItems":1,"maxItems":100,"items":{"type":"string","maxLength":120}},
                "required":{"type":"boolean"},
                "description":{"type":"string","maxLength":500},
                "visibleWhen":{"type":"object","additionalProperties":false,"required":["field","equals"],"properties":{"field":{"type":"string","minLength":1,"maxLength":120},"equals":{"oneOf":[{"type":"string","maxLength":120},{"type":"array","minItems":1,"maxItems":50,"items":{"type":"string","maxLength":120}}]}}}
            }},
            "pageView": {"oneOf": [
                {"type":"object", "additionalProperties":false, "required":["type"], "properties":{"type":{"const":"list"},"title":{"type":"string"},"defaultSort":{"type":"object","additionalProperties":false,"required":["column","order"],"properties":{"column":{"type":"string"},"order":{"enum":["asc","desc"]}}}}},
                {"type":"object", "additionalProperties":false, "required":["type","title","chartType","xAxisColumn","yAxisColumn"], "properties":{"type":{"const":"chart"},"title":{"type":"string"},"chartType":{"enum":["bar","line","pie"]},"xAxisColumn":{"type":"string"},"yAxisColumn":{"type":"string"},"groupByColumn":{"type":"string"}}},
                {"type":"object", "additionalProperties":false, "required":["type","title","groupColumn","cardFields"], "properties":{"type":{"const":"kanban"},"title":{"type":"string"},"groupColumn":{"type":"string"},"cardFields":{"type":"array","maxItems":20,"items":{"type":"string"}}}},
                {"type":"object", "additionalProperties":false, "required":["type","items"], "properties":{"type":{"const":"tabs"},"items":{"type":"array","minItems":1,"maxItems":10,"items":{"type":"object","additionalProperties":false,"required":["key","label","view"],"properties":{"key":{"type":"string","minLength":1},"label":{"type":"string","minLength":1},"view":{"$ref":"#/$defs/pageView"}}}}}},
                {"type":"object", "additionalProperties":false, "required":["type","left","right"], "properties":{"type":{"const":"split"},"left":{"$ref":"#/$defs/pageView"},"right":{"$ref":"#/$defs/pageView"},"splitRatio":{"type":"number","minimum":0.2,"maximum":0.8}}}
            ]}
        }
    })
}

#[derive(Debug)]
pub struct DecodedPageSpec {
    pub page: super::page_spec::PageSpec,
    pub issues: Vec<super::page_spec::PageIssue>,
    pub repaired: bool,
}

/// Only an outer JSON envelope may be removed automatically. Field, row,
/// identity, API and view repairs are deliberately not applied at this boundary.
pub fn decode_page_spec_detailed(
    content: &str,
) -> Result<DecodedPageSpec, Vec<super::page_spec::PageIssue>> {
    use super::page_spec::{validate_detailed, PageIssue, PageSpec};
    let trimmed = content.trim();
    let (value, repaired) = match serde_json::from_str::<Value>(trimmed) {
        Ok(value) => (value, false),
        Err(_) => (
            decode_json(content).map_err(|_| {
                vec![PageIssue::error(
                    "PAGE_JSON_INVALID",
                    "",
                    "syntax",
                    "页面 JSON 无法解析，请重新生成或修复语法",
                )]
            })?,
            true,
        ),
    };
    if value
        .get("version")
        .is_some_and(|version| version.as_f64() != Some(1.0))
    {
        return Err(vec![PageIssue::error(
            "PAGE_VERSION_UNSUPPORTED",
            "/version",
            "schema",
            "仅支持 PageSpec v1",
        )]);
    }
    let page: PageSpec = serde_json::from_value(value).map_err(|_| {
        vec![PageIssue::error(
            "PAGE_SHAPE_INVALID",
            "",
            "schema",
            "页面字段类型或必填结构无效；不会自动改写字段或业务数据",
        )]
    })?;
    validate_detailed(&page)?;
    let issues = if repaired {
        vec![PageIssue {
            code: "PAGE_JSON_ENVELOPE_REMOVED".into(),
            path: "".into(),
            severity: "warning".into(),
            stage: "syntax".into(),
            message: "已移除 JSON 外层文本，页面字段未改写".into(),
            suggested_fix: None,
        }]
    } else {
        vec![]
    };
    Ok(DecodedPageSpec {
        page,
        issues,
        repaired,
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

    let column_aliases = build_column_aliases(page.get("columns").and_then(Value::as_array));
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

    if let Some(metadata) = page.get_mut("columnMeta").and_then(Value::as_array_mut) {
        for item in metadata {
            if let Some(name) = item.get_mut("name") {
                normalize_column_reference(name, &column_aliases);
            }
        }
    }

    if let Some(views) = page.get_mut("views").and_then(Value::as_array_mut) {
        views.retain_mut(|view| normalize_view(view, &column_aliases, 0));
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

fn build_column_aliases(columns: Option<&Vec<Value>>) -> HashMap<String, String> {
    let mut aliases = HashMap::new();
    for column in columns.into_iter().flatten() {
        let display = display_string(column);
        if display.is_empty() {
            continue;
        }
        aliases.insert(normalize_alias(&display), display.clone());
        if let Some(object) = column.as_object() {
            for key in ["key", "field", "id", "name", "label", "title"] {
                if let Some(alias) = object.get(key).and_then(Value::as_str) {
                    aliases.insert(normalize_alias(alias), display.clone());
                }
            }
        }
    }
    aliases
}

fn normalize_alias(value: &str) -> String {
    value
        .chars()
        .filter(|character| character.is_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}

fn normalize_column_reference(value: &mut Value, aliases: &HashMap<String, String>) -> bool {
    let Some(reference) = value.as_str() else {
        return false;
    };
    let Some(column) = aliases.get(&normalize_alias(reference)) else {
        return false;
    };
    *value = Value::String(column.clone());
    true
}

fn normalize_view(value: &mut Value, aliases: &HashMap<String, String>, depth: usize) -> bool {
    if depth > 4 {
        return false;
    }
    let Some(view) = value.as_object_mut() else {
        return false;
    };
    match view.get("type").and_then(Value::as_str) {
        Some("list") => {
            let sort_is_valid = view.get_mut("defaultSort").is_none_or(|sort| {
                let Some(sort) = sort.as_object_mut() else {
                    return false;
                };
                let column_is_valid = sort
                    .get_mut("column")
                    .is_some_and(|column| normalize_column_reference(column, aliases));
                let order_is_valid = sort.get_mut("order").is_some_and(|order| {
                    let Some(value) = order.as_str() else {
                        return false;
                    };
                    let normalized = value.to_ascii_lowercase();
                    if !matches!(normalized.as_str(), "asc" | "desc") {
                        return false;
                    }
                    *order = Value::String(normalized);
                    true
                });
                column_is_valid && order_is_valid
            });
            if !sort_is_valid {
                view.remove("defaultSort");
            }
            view.get("title").is_none_or(Value::is_string)
        }
        Some("chart") => {
            let Some(chart_type) = view.get_mut("chartType") else {
                return false;
            };
            let Some(raw_chart_type) = chart_type.as_str() else {
                return false;
            };
            let normalized_chart_type = match raw_chart_type.to_ascii_lowercase().as_str() {
                "bar" | "column" | "histogram" => "bar",
                "line" | "area" => "line",
                "pie" | "donut" | "doughnut" => "pie",
                _ => return false,
            };
            *chart_type = Value::String(normalized_chart_type.into());
            let title_is_valid = view.get("title").is_some_and(Value::is_string);
            let x_is_valid = view
                .get_mut("xAxisColumn")
                .is_some_and(|column| normalize_column_reference(column, aliases));
            let y_is_valid = view
                .get_mut("yAxisColumn")
                .is_some_and(|column| normalize_column_reference(column, aliases));
            let group_is_valid = view
                .get_mut("groupByColumn")
                .is_none_or(|column| normalize_column_reference(column, aliases));
            if !group_is_valid {
                view.remove("groupByColumn");
            }
            title_is_valid && x_is_valid && y_is_valid
        }
        Some("kanban") => {
            let group_is_valid = view
                .get_mut("groupColumn")
                .is_some_and(|column| normalize_column_reference(column, aliases));
            let fields_are_valid = view.get_mut("cardFields").is_some_and(|fields| {
                let Some(fields) = fields.as_array_mut() else {
                    return false;
                };
                fields.retain_mut(|field| normalize_column_reference(field, aliases));
                fields.len() <= 20
            });
            view.get("title").is_some_and(Value::is_string) && group_is_valid && fields_are_valid
        }
        Some("tabs") => {
            let Some(items) = view.get_mut("items").and_then(Value::as_array_mut) else {
                return false;
            };
            let mut keys = HashSet::new();
            items.retain_mut(|item| {
                let Some(item) = item.as_object_mut() else {
                    return false;
                };
                let Some(key) = item
                    .get("key")
                    .and_then(Value::as_str)
                    .filter(|key| !key.trim().is_empty())
                    .map(str::to_string)
                else {
                    return false;
                };
                let label_is_valid = item
                    .get("label")
                    .and_then(Value::as_str)
                    .is_some_and(|label| !label.trim().is_empty());
                label_is_valid
                    && keys.insert(key)
                    && item
                        .get_mut("view")
                        .is_some_and(|view| normalize_view(view, aliases, depth + 1))
            });
            !items.is_empty() && items.len() <= 10
        }
        Some("split") => {
            let left_is_valid = view
                .get_mut("left")
                .is_some_and(|view| normalize_view(view, aliases, depth + 1));
            let right_is_valid = view
                .get_mut("right")
                .is_some_and(|view| normalize_view(view, aliases, depth + 1));
            let ratio_is_valid = view
                .get("splitRatio")
                .and_then(Value::as_f64)
                .is_none_or(|ratio| (0.2..=0.8).contains(&ratio));
            if !ratio_is_valid {
                view.remove("splitRatio");
            }
            left_is_valid && right_is_valid
        }
        _ => false,
    }
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
    use crate::domain::page_spec::{validate, PageSpec};

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

    #[test]
    fn normalizes_view_column_aliases_and_common_chart_types() {
        let input = serde_json::json!({
            "version": 1,
            "title": "Devices",
            "description": "",
            "filters": [],
            "stats": [],
            "columns": [
                {"key": "created_at", "label": "Created At"},
                {"key": "device_count", "label": "Device Count"}
            ],
            "rows": [{"created_at": "2026-08-25", "device_count": 12}],
            "views": [{
                "type": "chart",
                "title": "Trend",
                "chartType": "area",
                "xAxisColumn": "created_at",
                "yAxisColumn": "device_count"
            }]
        });
        let normalized = normalize_page_spec(input);
        assert_eq!(normalized["views"][0]["chartType"], "line");
        assert_eq!(normalized["views"][0]["xAxisColumn"], "Created At");
        assert_eq!(normalized["views"][0]["yAxisColumn"], "Device Count");
        let page: PageSpec = serde_json::from_value(normalized).unwrap();
        assert!(validate(&page).is_ok());
    }

    #[test]
    fn drops_unresolvable_views_and_invalid_optional_sorting() {
        let input = serde_json::json!({
            "version": 1,
            "title": "Devices",
            "description": "",
            "filters": [],
            "stats": [{"label": "Total", "value": "12"}],
            "columns": ["Name", "Status"],
            "rows": [["Router", "Active"]],
            "views": [
                {"type": "list", "defaultSort": {"column": "missing", "order": "DESC"}},
                {"type": "chart", "title": "Trend", "chartType": "line", "xAxisColumn": "missing", "yAxisColumn": "Status"}
            ]
        });
        let normalized = normalize_page_spec(input);
        assert_eq!(normalized["views"].as_array().unwrap().len(), 1);
        assert!(normalized["views"][0].get("defaultSort").is_none());
        let page: PageSpec = serde_json::from_value(normalized).unwrap();
        assert!(validate(&page).is_ok());
    }
}
