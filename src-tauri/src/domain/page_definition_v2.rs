use serde_json::Value;
use std::collections::HashSet;

use super::page_spec::PageIssue;

#[derive(Debug)]
pub struct ValidatedPageDefinitionV2 {
    pub value: Value,
}

pub fn validate_raw(value: Value) -> Result<ValidatedPageDefinitionV2, Vec<PageIssue>> {
    validate_definition(&value)?;
    Ok(ValidatedPageDefinitionV2 { value })
}

/// Safe borrowed entry: structural validation must precede private domain checks.
pub fn validate_definition(value: &Value) -> Result<(), Vec<PageIssue>> {
    let mut stack = vec![(value, 0usize)];
    let mut nodes = 0;
    while let Some((current, depth)) = stack.pop() {
        nodes += 1;
        let children = match current {
            Value::Array(items) => items.len(),
            Value::Object(items) => items.len(),
            _ => 0,
        };
        if nodes + stack.len() + children > 20000 || depth > 32 {
            return Err(vec![PageIssue::error(
                "PAGE_V2_INPUT_LIMIT_EXCEEDED",
                "/",
                "schema",
                "页面定义超过输入深度或节点预算",
            )]);
        }
        match current {
            Value::Array(items) => stack.extend(items.iter().map(|item| (item, depth + 1))),
            Value::Object(items) => stack.extend(items.values().map(|item| (item, depth + 1))),
            _ => {}
        }
    }
    super::page_definition_v2_schema::validate_v2(value).map_err(|_| {
        vec![PageIssue::error(
            "PAGE_V2_SCHEMA_INVALID",
            "",
            "schema",
            "页面定义不符合 v2 契约；请检查字段、数量或属性",
        )]
    })?;
    validate_domain(value)
}

fn safe_pattern(pattern: &str) -> Option<(&str, usize, usize)> {
    let inner = pattern.strip_prefix("^[")?.strip_suffix("}$")?;
    let (characters, counts) = inner.split_once("]{")?;
    if !matches!(characters, "0-9" | "A-Za-z" | "A-Za-z0-9" | "A-Za-z0-9_-") {
        return None;
    }
    let (low, high) = counts.split_once(',').unwrap_or((counts, counts));
    if low.is_empty()
        || high.is_empty()
        || !low.bytes().chain(high.bytes()).all(|c| c.is_ascii_digit())
    {
        return None;
    }
    // Parse numerically without overflow, also accepting leading zeros like TS.
    let parse = |s: &str| {
        s.bytes().try_fold(0usize, |n, c| {
            let n = n * 10 + (c - b'0') as usize;
            (n <= 10000).then_some(n)
        })
    };
    let min = parse(low)?;
    let max = parse(high)?;
    (min <= max).then_some((characters, min, max))
}

fn matches_safe_pattern(value: &str, pattern: (&str, usize, usize)) -> bool {
    let (characters, min, max) = pattern;
    value.len() >= min
        && value.len() <= max
        && value.bytes().all(|c| {
            (characters != "A-Za-z" && c.is_ascii_digit())
                || (characters != "0-9" && c.is_ascii_alphabetic())
                || (characters == "A-Za-z0-9_-" && matches!(c, b'_' | b'-'))
        })
}

fn validate_enum(field: &Value, path: &str, issues: &mut Vec<PageIssue>) {
    if field["type"] == "enum" {
        let values = field["enumValues"].as_array();
        if values.is_none_or(|values| {
            values.is_empty()
                || values
                    .iter()
                    .filter_map(Value::as_str)
                    .collect::<HashSet<_>>()
                    .len()
                    != values.len()
        }) {
            issues.push(PageIssue::error(
                "PAGE_V2_ENUM_VALUES_INVALID",
                &format!("{path}/enumValues"),
                "reference",
                "enumValues 必须非空且唯一",
            ));
        }
        let c = &field["constraints"];
        let pattern = c["pattern"].as_str().and_then(safe_pattern);
        if values.is_some_and(|values| {
            values.iter().any(|value| {
                let value = value.as_str().unwrap();
                // Schema-validated lengths are bounded mathematical integers, including 2.0/2e0.
                let length = value.chars().count() as f64;
                c["minLength"].as_f64().is_some_and(|min| length < min)
                    || c["maxLength"].as_f64().is_some_and(|max| length > max)
                    || pattern.is_some_and(|pattern| !matches_safe_pattern(value, pattern))
            })
        }) {
            issues.push(PageIssue::error(
                "PAGE_V2_ENUM_CONSTRAINT_INVALID",
                &format!("{path}/enumValues"),
                "reference",
                "枚举值必须满足自身约束",
            ));
        }
    } else if field.get("enumValues").is_some() {
        issues.push(PageIssue::error(
            "PAGE_V2_ENUM_VALUES_INVALID",
            &format!("{path}/enumValues"),
            "reference",
            "非 enum 字段不能提供 enumValues",
        ));
    }
}

fn validate_domain(value: &Value) -> Result<(), Vec<PageIssue>> {
    let mut issues = Vec::new();
    let fields = value["fields"].as_array().expect("schema validated fields");
    for (index, field) in fields.iter().enumerate() {
        validate_enum(field, &format!("/fields/{index}"), &mut issues);
    }
    let operations = value["operations"]
        .as_array()
        .expect("schema validated operations");
    let views = value["views"].as_array().expect("schema validated views");
    let field_keys = fields
        .iter()
        .filter_map(|v| v["key"].as_str())
        .collect::<HashSet<_>>();
    let source_ref = value["dataSources"]["primary"]["operationRef"]
        .as_str()
        .unwrap();
    match operations
        .iter()
        .find(|operation| operation["key"] == source_ref)
    {
        None => issues.push(PageIssue::error(
            "PAGE_V2_OPERATION_REFERENCE_INVALID",
            "/dataSources/primary/operationRef",
            "reference",
            "主数据源必须引用已定义的操作",
        )),
        Some(operation) if operation["role"] != "list" => issues.push(PageIssue::error(
            "PAGE_V2_PRIMARY_OPERATION_NOT_LIST",
            "/dataSources/primary/operationRef",
            "reference",
            "主数据源必须引用 list 操作",
        )),
        _ => {}
    }
    unique_keys(
        fields,
        "/fields",
        "PAGE_V2_DUPLICATE_FIELD_KEY",
        "字段",
        &mut issues,
    );
    unique_keys(
        operations,
        "/operations",
        "PAGE_V2_DUPLICATE_OPERATION_KEY",
        "操作",
        &mut issues,
    );
    unique_keys(
        value["filters"].as_array().unwrap(),
        "/filters",
        "PAGE_V2_DUPLICATE_FILTER_KEY",
        "筛选器",
        &mut issues,
    );
    for (index, operation) in operations.iter().enumerate() {
        let allowed: &[&str] = match operation["role"].as_str().unwrap() {
            "create" => &["POST"],
            "update" => &["PUT", "PATCH"],
            "delete" => &["DELETE"],
            "batch" => &["POST", "DELETE"],
            _ => &["GET"],
        };
        if !allowed.contains(&operation["method"].as_str().unwrap()) {
            issues.push(PageIssue::error(
                "PAGE_V2_OPERATION_METHOD_INVALID",
                &format!("/operations/{index}/method"),
                "reference",
                "操作方法与角色不匹配",
            ));
        }
        if let Some(body) = operation["bodySchema"].as_array() {
            unique_keys(
                body,
                &format!("/operations/{index}/bodySchema"),
                "PAGE_V2_DUPLICATE_BODY_FIELD_KEY",
                "请求字段",
                &mut issues,
            );
            for (field_index, field) in body.iter().enumerate() {
                let c = &field["constraints"];
                let path = format!("/operations/{index}/bodySchema/{field_index}");
                validate_enum(field, &path, &mut issues);
                let specific: &[&str] = match field["type"].as_str().unwrap() {
                    "number" | "integer" => &["min", "max"],
                    "string" | "enum" => &["minLength", "maxLength", "pattern"],
                    _ => &[],
                };
                if c.as_object().is_some_and(|c| {
                    c.keys().any(|key| {
                        key != "nullable" && key != "readonly" && !specific.contains(&key.as_str())
                    })
                }) {
                    issues.push(PageIssue::error(
                        "PAGE_V2_CONSTRAINT_TYPE_INVALID",
                        &format!("{path}/constraints"),
                        "reference",
                        "约束与字段类型不相容",
                    ));
                }
                if c["pattern"]
                    .as_str()
                    .is_some_and(|pattern| safe_pattern(pattern).is_none())
                {
                    issues.push(PageIssue::error(
                        "PAGE_V2_PATTERN_INVALID",
                        &format!("{path}/constraints/pattern"),
                        "reference",
                        "pattern 必须是受限的锚定单字符类模式",
                    ));
                }
                if field["type"] == "integer"
                    && matches!((c["min"].as_f64(), c["max"].as_f64()), (Some(min), Some(max)) if min <= max && min.ceil() > max.floor())
                {
                    issues.push(PageIssue::error(
                        "PAGE_V2_CONSTRAINT_RANGE_INVALID",
                        &format!("{path}/constraints"),
                        "reference",
                        "integer 区间必须包含整数",
                    ));
                }
                let inverted = [("min", "max"), ("minLength", "maxLength")].iter().any(|(min, max)| {
                    matches!((c[min].as_f64(), c[max].as_f64()), (Some(low), Some(high)) if low > high)
                });
                if inverted {
                    issues.push(PageIssue::error(
                        "PAGE_V2_CONSTRAINT_RANGE_INVALID",
                        &format!("/operations/{index}/bodySchema/{field_index}/constraints"),
                        "reference",
                        "约束下限不能大于上限",
                    ));
                }
            }
        }
        let path_params = operation["path"]
            .as_str()
            .unwrap()
            .split('{')
            .skip(1)
            .filter_map(|part| part.split('}').next())
            .collect::<HashSet<_>>();
        let mapping = operation.get("parameterMapping");
        let path_mappings = mapping
            .and_then(|mapping| mapping["path"].as_array())
            .cloned()
            .unwrap_or_default();
        let body_mappings = mapping
            .and_then(|mapping| mapping["body"].as_array())
            .cloned()
            .unwrap_or_default();
        for (key, entries) in [("path", &path_mappings), ("body", &body_mappings)] {
            let mut seen = HashSet::new();
            for (mapping_index, entry) in entries.iter().enumerate() {
                if !seen.insert(entry["param"].as_str().unwrap()) {
                    issues.push(PageIssue::error(
                        "PAGE_V2_PARAMETER_MAPPING_DUPLICATE",
                        &format!(
                            "/operations/{index}/parameterMapping/{key}/{mapping_index}/param"
                        ),
                        "reference",
                        "参数映射目标必须唯一",
                    ));
                }
            }
        }
        for (mapping_index, entry) in path_mappings.iter().enumerate() {
            if !path_params.contains(entry["param"].as_str().unwrap()) {
                issues.push(PageIssue::error(
                    "PAGE_V2_PARAMETER_MAPPING_PATH_INVALID",
                    &format!("/operations/{index}/parameterMapping/path/{mapping_index}/param"),
                    "reference",
                    "path 映射参数必须对应路径占位符",
                ));
            }
            if !field_keys.contains(entry["fieldKey"].as_str().unwrap()) {
                issues.push(PageIssue::error(
                    "PAGE_V2_PARAMETER_MAPPING_REFERENCE_INVALID",
                    &format!("/operations/{index}/parameterMapping/path/{mapping_index}/fieldKey"),
                    "reference",
                    "参数映射必须引用已定义字段",
                ));
            }
        }
        if !path_params.is_empty() {
            let mapped = path_mappings
                .iter()
                .filter_map(|entry| entry["param"].as_str())
                .collect::<HashSet<_>>();
            if path_params.iter().any(|param| !mapped.contains(param)) {
                issues.push(PageIssue::error(
                    "PAGE_V2_PARAMETER_MAPPING_PATH_MISSING",
                    &format!("/operations/{index}/parameterMapping/path"),
                    "reference",
                    "每个路径占位符都必须有参数映射",
                ));
            }
        }
        for (mapping_index, entry) in body_mappings.iter().enumerate() {
            let body_key = entry["bodyFieldKey"].as_str().unwrap();
            if !operation["bodySchema"]
                .as_array()
                .is_some_and(|body| body.iter().any(|field| field["key"] == body_key))
            {
                issues.push(PageIssue::error(
                    "PAGE_V2_PARAMETER_MAPPING_REFERENCE_INVALID",
                    &format!(
                        "/operations/{index}/parameterMapping/body/{mapping_index}/bodyFieldKey"
                    ),
                    "reference",
                    "参数映射必须引用已定义请求字段",
                ));
            }
        }
        if operation["role"] == "batch" {
            if operation.get("batch").is_none() {
                issues.push(PageIssue::error(
                    "PAGE_V2_BATCH_REQUIRED",
                    &format!("/operations/{index}/batch"),
                    "reference",
                    "batch role 必须提供 batch",
                ));
            } else {
                let batch = &operation["batch"];
                if !field_keys.contains(batch["idsFieldKey"].as_str().unwrap()) {
                    issues.push(PageIssue::error(
                        "PAGE_V2_BATCH_FIELD_REFERENCE_INVALID",
                        &format!("/operations/{index}/batch/idsFieldKey"),
                        "reference",
                        "batch idsFieldKey 必须引用字段",
                    ));
                }
                let target = batch["target"]["param"].as_str().unwrap();
                if body_mappings.iter().any(|entry| entry["param"] == target) {
                    issues.push(PageIssue::error(
                        "PAGE_V2_BATCH_TARGET_CONFLICT",
                        &format!("/operations/{index}/batch/target/param"),
                        "reference",
                        "batch 与普通 body 映射不能具有相同目标",
                    ));
                }
            }
        } else if operation.get("batch").is_some() {
            issues.push(PageIssue::error(
                "PAGE_V2_BATCH_ROLE_INVALID",
                &format!("/operations/{index}/batch"),
                "reference",
                "提供 batch 时 role 必须为 batch",
            ));
        }
    }
    for (index, filter) in value["filters"].as_array().unwrap().iter().enumerate() {
        if !field_keys.contains(filter["fieldKey"].as_str().unwrap()) {
            issues.push(PageIssue::error(
                "PAGE_V2_FIELD_REFERENCE_INVALID",
                &format!("/filters/{index}/fieldKey"),
                "reference",
                "筛选器必须引用已定义字段",
            ));
        }
    }
    let mut view_keys = HashSet::new();
    for (index, view) in views.iter().enumerate() {
        validate_view(
            view,
            &format!("/views/{index}"),
            1,
            &field_keys,
            &mut view_keys,
            &mut issues,
        );
    }
    if issues.is_empty() {
        Ok(())
    } else {
        Err(issues)
    }
}

fn unique_keys(items: &[Value], path: &str, code: &str, label: &str, issues: &mut Vec<PageIssue>) {
    let mut seen = HashSet::new();
    for (index, item) in items.iter().enumerate() {
        let key = item["key"].as_str().unwrap();
        if !seen.insert(key) {
            issues.push(PageIssue::error(
                code,
                &format!("{path}/{index}/key"),
                "reference",
                &format!("{label} key 必须唯一"),
            ));
        }
    }
}

fn validate_view(
    view: &Value,
    path: &str,
    depth: usize,
    field_keys: &HashSet<&str>,
    view_keys: &mut HashSet<String>,
    issues: &mut Vec<PageIssue>,
) {
    if depth > 3 {
        issues.push(PageIssue::error(
            "PAGE_V2_VIEW_DEPTH_EXCEEDED",
            path,
            "reference",
            "视图嵌套深度不能超过 3",
        ));
        return;
    }
    let key = view["key"].as_str().unwrap().to_string();
    if !view_keys.insert(key) {
        issues.push(PageIssue::error(
            "PAGE_V2_DUPLICATE_VIEW_KEY",
            &format!("{path}/key"),
            "reference",
            "视图 key 必须唯一",
        ));
    }
    let kind = view["type"].as_str().unwrap();
    let mut references = Vec::new();
    match kind {
        "list" => {
            references.extend(
                view["fieldKeys"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .filter_map(Value::as_str),
            );
            if let Some(key) = view["defaultSort"]["fieldKey"].as_str() {
                references.push(key);
            }
        }
        "chart" => {
            references.push(view["xFieldKey"].as_str().unwrap());
            references.push(view["yFieldKey"].as_str().unwrap());
            if let Some(key) = view["groupByFieldKey"].as_str() {
                references.push(key);
            }
        }
        "kanban" => {
            references.push(view["groupFieldKey"].as_str().unwrap());
            references.extend(
                view["cardFieldKeys"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .filter_map(Value::as_str),
            );
        }
        _ => {}
    }
    for reference in references {
        if !field_keys.contains(reference) {
            issues.push(PageIssue::error(
                "PAGE_V2_FIELD_REFERENCE_INVALID",
                path,
                "reference",
                "视图必须引用已定义字段",
            ));
        }
    }
    if kind == "tabs" {
        unique_keys(
            view["items"].as_array().unwrap(),
            &format!("{path}/items"),
            "PAGE_V2_DUPLICATE_TAB_ITEM_KEY",
            "标签项",
            issues,
        );
        for (index, item) in view["items"].as_array().unwrap().iter().enumerate() {
            validate_view(
                &item["view"],
                &format!("{path}/items/{index}/view"),
                depth + 1,
                field_keys,
                view_keys,
                issues,
            );
        }
    } else if kind == "split" {
        validate_view(
            &view["left"],
            &format!("{path}/left"),
            depth + 1,
            field_keys,
            view_keys,
            issues,
        );
        validate_view(
            &view["right"],
            &format!("{path}/right"),
            depth + 1,
            field_keys,
            view_keys,
            issues,
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    #[test]
    fn public_definition_entry_rejects_arbitrary_values_without_panicking() {
        for value in [
            serde_json::json!(null),
            serde_json::json!([]),
            serde_json::json!({}),
            serde_json::json!({"fields":[],"operations":[],"views":[]}),
        ] {
            let result = std::panic::catch_unwind(|| validate_definition(&value));
            assert!(result.is_ok(), "public validator panicked for {value}");
            assert!(result.unwrap().is_err());
        }
    }

    #[test]
    fn public_entry_bounds_input_before_schema() {
        let value = serde_json::json!({"extra": vec![Value::Null; 20001]});
        let issues = validate_definition(&value).unwrap_err();
        assert_eq!(issues[0].code, "PAGE_V2_INPUT_LIMIT_EXCEEDED");
    }

    #[test]
    fn shared_v2_fixtures_match_rust_validation() {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
        let directory = root.join("contracts/fixtures/v2");
        let manifest: Value =
            serde_json::from_slice(&fs::read(directory.join("manifest.json")).unwrap()).unwrap();
        for case in manifest["cases"].as_array().unwrap() {
            let name = case["file"].as_str().unwrap();
            let value: Value =
                serde_json::from_slice(&fs::read(directory.join(name)).unwrap()).unwrap();
            let result = validate_raw(value);
            if let Some(code) = case["issueCode"].as_str() {
                let issues = result.as_ref().unwrap_err();
                assert!(
                    issues.iter().any(|issue| issue.code == code
                        && issue.path == case["issuePath"].as_str().unwrap()),
                    "expected diagnostic for {name}: {issues:?}"
                );
            }
            assert_eq!(
                result.is_ok(),
                case["accepted"].as_bool().unwrap(),
                "shared fixture {name}: {result:?}"
            );
        }
    }
}
