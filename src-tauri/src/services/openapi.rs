use crate::services::url_security::{
    read_limited_response, validate_content_length, validate_url_transport,
};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::time::Duration;

/// 响应 Schema 摘要的解析上限：有界遍历，防止异常文档导致递归失控。
const MAX_REF_HOPS: usize = 8;
const MAX_ENVELOPE_DEPTH: usize = 3;
const MAX_PROPERTIES: usize = 50;
const MAX_VISITED_NODES: usize = 200;

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
    #[serde(rename = "responseSchemas")]
    pub response_schemas: HashMap<String, ResponseSchemaSummary>,
}

/// 建议指针的来源；inferred/unresolved 都需在客户端由用户确认。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PointerOrigin {
    Schema,
    /// 客户端推断来源；Rust 侧只产出 schema/unresolved，保留该值以对齐共享契约。
    #[allow(dead_code)]
    Inferred,
    Unresolved,
}

/// 单条记录的字段摘要；pointer 相对一条记录（RFC 6901）。
#[derive(Debug, Clone, Serialize)]
pub struct ResponseFieldSchema {
    pub pointer: String,
    pub name: String,
    #[serde(rename = "type")]
    pub r#type: String,
}

/// 解析诊断；message 仅含 code/路径/上限，绝不含响应数据。
#[derive(Debug, Clone, Serialize)]
pub struct ResponseSchemaIssue {
    pub code: String,
    pub message: String,
}

/// 有界、无数据的成功响应 Schema 摘要；按 operationId 索引。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResponseSchemaSummary {
    pub operation_key: String,
    pub operation_id: String,
    pub items_pointer: Option<String>,
    pub items_pointer_origin: PointerOrigin,
    pub total_pointer: Option<String>,
    pub total_pointer_origin: PointerOrigin,
    pub row_key_pointer: Option<String>,
    pub row_key_pointer_origin: PointerOrigin,
    pub fields: Vec<ResponseFieldSchema>,
    pub issues: Vec<ResponseSchemaIssue>,
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
    let mut response_schemas = HashMap::new();
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
                        let operation_key =
                            format!("{} {} · {}", method.to_uppercase(), path, operation_id);
                        operations.push(operation_key.clone());
                        response_schemas.insert(
                            operation_id.to_string(),
                            extract_response_schema(
                                &value,
                                operation,
                                &spec_version,
                                &operation_key,
                                operation_id,
                            ),
                        );
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
        response_schemas,
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
        for parameter in parameters
            .and_then(|value| value.as_array())
            .into_iter()
            .flatten()
        {
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

fn resolve_parameter_reference<'a>(
    root: &'a serde_json::Value,
    parameter: &'a serde_json::Value,
) -> &'a serde_json::Value {
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

/// 构造「全部未解析」的响应摘要，作为解析失败时的基线。
fn empty_response_schema(operation_key: &str, operation_id: &str) -> ResponseSchemaSummary {
    ResponseSchemaSummary {
        operation_key: operation_key.to_string(),
        operation_id: operation_id.to_string(),
        items_pointer: None,
        items_pointer_origin: PointerOrigin::Unresolved,
        total_pointer: None,
        total_pointer_origin: PointerOrigin::Unresolved,
        row_key_pointer: None,
        row_key_pointer_origin: PointerOrigin::Unresolved,
        fields: Vec::new(),
        issues: Vec::new(),
    }
}

fn push_issue(issues: &mut Vec<ResponseSchemaIssue>, code: &str, message: &str) {
    issues.push(ResponseSchemaIssue {
        code: code.to_string(),
        message: message.to_string(),
    });
}

/// 共享遍历预算：访问节点总数受限，超限只标记一次并停止当前分支。
struct ScanBudget {
    visited: usize,
    max_nodes: usize,
    bounded: bool,
}

impl ScanBudget {
    fn new(max_nodes: usize) -> Self {
        Self {
            visited: 0,
            max_nodes,
            bounded: false,
        }
    }

    /// 返回 false 表示已超出节点上限，调用方必须停止该分支。
    fn visit(&mut self) -> bool {
        self.visited += 1;
        if self.visited > self.max_nodes {
            self.bounded = true;
            false
        } else {
            true
        }
    }

    fn mark_bounded(&mut self) {
        self.bounded = true;
    }
}

struct EnvelopeScan<'a> {
    items_pointer: Option<String>,
    item_schema: Option<&'a serde_json::Value>,
    total_pointer: Option<String>,
}

impl<'a> Default for EnvelopeScan<'a> {
    fn default() -> Self {
        Self {
            items_pointer: None,
            item_schema: None,
            total_pointer: None,
        }
    }
}

struct LayerScan<'a> {
    first_array: Option<(String, &'a serde_json::Value)>,
    total_pointer: Option<String>,
    nested_objects: Vec<(String, &'a serde_json::Value)>,
}

/// RFC 6901 转义（生成 pointer）：先 ~ 后 /。
fn rfc6901_escape(segment: &str) -> String {
    segment.replace('~', "~0").replace('/', "~1")
}

/// RFC 6901 反转义（解析 $ref）：必须先 ~1 后 ~0。
fn rfc6901_unescape(segment: &str) -> String {
    segment.replace("~1", "/").replace("~0", "~")
}

fn join_pointer(base: &str, name: &str) -> String {
    format!("{base}/{}", rfc6901_escape(name))
}

fn schema_type(schema: &serde_json::Value) -> &str {
    schema
        .get("type")
        .and_then(|value| value.as_str())
        .unwrap_or("")
}

fn map_field_type(schema: &serde_json::Value) -> &'static str {
    match schema_type(schema) {
        "string" => "string",
        "number" => "number",
        "integer" => "integer",
        "boolean" => "boolean",
        "object" => "object",
        "array" => "array",
        _ => "unknown",
    }
}

fn is_unsafe_property(name: &str) -> bool {
    // Keep in sync with the TS runtime parser, which rejects these segments
    // case-insensitively.
    matches!(
        name.to_ascii_lowercase().as_str(),
        "__proto__" | "prototype" | "constructor"
    )
}

fn is_total_property(name: &str, schema: &serde_json::Value) -> bool {
    matches!(name, "total" | "totalCount" | "totalElements" | "count")
        && matches!(schema_type(schema), "integer" | "number")
}

fn is_supported_local_ref(reference: &str) -> bool {
    reference.starts_with("#/components/schemas/") || reference.starts_with("#/definitions/")
}

/// 按 RFC 6901 分段定位内部指针；不跟随外部引用。
fn resolve_local_pointer<'a>(
    root: &'a serde_json::Value,
    pointer: &str,
) -> Option<&'a serde_json::Value> {
    let body = pointer.strip_prefix('#').unwrap_or(pointer);
    if !body.starts_with('/') {
        return None;
    }
    let mut current = root;
    for raw in body.split('/').skip(1) {
        current = current.get(rfc6901_unescape(raw).as_str())?;
    }
    Some(current)
}

/// 跟随内部 $ref 链：最多 8 跳、检测循环、拒绝外部引用。
fn resolve_schema_chain<'a>(
    root: &'a serde_json::Value,
    mut schema: &'a serde_json::Value,
    issues: &mut Vec<ResponseSchemaIssue>,
) -> Option<&'a serde_json::Value> {
    let mut seen: HashSet<String> = HashSet::new();
    let mut hops = 0usize;
    loop {
        let Some(reference) = schema.get("$ref").and_then(|value| value.as_str()) else {
            return Some(schema);
        };
        if !is_supported_local_ref(reference) {
            push_issue(
                issues,
                "response.ref.unresolved",
                "不支持或无法定位的内部 $ref（response.ref.unresolved）",
            );
            return None;
        }
        if hops >= MAX_REF_HOPS {
            push_issue(
                issues,
                "response.ref.depth",
                "$ref 跳转超过上限 8（response.ref.depth）",
            );
            return None;
        }
        hops += 1;
        if !seen.insert(reference.to_string()) {
            push_issue(
                issues,
                "response.ref.cycle",
                "检测到 $ref 循环（response.ref.cycle）",
            );
            return None;
        }
        match resolve_local_pointer(root, reference) {
            Some(next) => schema = next,
            None => {
                push_issue(
                    issues,
                    "response.ref.unresolved",
                    "不支持或无法定位的内部 $ref（response.ref.unresolved）",
                );
                return None;
            }
        }
    }
}

fn is_2xx_status(key: &str) -> bool {
    key.len() == 3
        && key.starts_with('2')
        && key
            .parse::<u16>()
            .map_or(false, |status| (200..=299).contains(&status))
}

/// 成功响应优先级："200" > 其它 2xx > "default"。
fn select_success_response_key(
    responses: &serde_json::Map<String, serde_json::Value>,
) -> Option<String> {
    if responses.contains_key("200") {
        return Some("200".to_string());
    }
    if let Some(key) = responses.keys().find(|key| is_2xx_status(key)) {
        return Some(key.clone());
    }
    if responses.contains_key("default") {
        return Some("default".to_string());
    }
    None
}

fn success_schema<'a>(
    root: &'a serde_json::Value,
    operation: &'a serde_json::Value,
    spec_version: &str,
) -> Option<&'a serde_json::Value> {
    let responses = operation.get("responses")?.as_object()?;
    let key = select_success_response_key(responses)?;
    let response = responses.get(key.as_str())?;
    // 响应级 $ref（#/components/responses/X）仅跟随内部指针。
    let response = match response.get("$ref").and_then(|value| value.as_str()) {
        Some(reference) => resolve_local_pointer(root, reference)?,
        None => response,
    };
    if spec_version.starts_with('2') {
        response.get("schema")
    } else {
        let content = response.get("content")?.as_object()?;
        content
            .get("application/json")
            .or_else(|| content.values().next())?
            .get("schema")
    }
}

fn items_scan<'a>(
    root: &'a serde_json::Value,
    array_schema: &'a serde_json::Value,
    items_pointer: &str,
    total_pointer: Option<String>,
    issues: &mut Vec<ResponseSchemaIssue>,
) -> EnvelopeScan<'a> {
    EnvelopeScan {
        items_pointer: Some(items_pointer.to_string()),
        item_schema: array_schema
            .get("items")
            .and_then(|items| resolve_schema_chain(root, items, issues)),
        total_pointer,
    }
}

fn scan_object_layer<'a>(
    root: &'a serde_json::Value,
    properties: &'a serde_json::Map<String, serde_json::Value>,
    base_pointer: &str,
    budget: &mut ScanBudget,
    issues: &mut Vec<ResponseSchemaIssue>,
) -> LayerScan<'a> {
    let mut layer = LayerScan {
        first_array: None,
        total_pointer: None,
        nested_objects: Vec::new(),
    };
    let mut property_count = 0usize;
    for (name, property) in properties {
        if !budget.visit() {
            break;
        }
        property_count += 1;
        if property_count > MAX_PROPERTIES {
            budget.mark_bounded();
            break;
        }
        if is_unsafe_property(name) {
            push_issue(
                issues,
                "response.pointer.unsafe",
                "已跳过危险属性名（response.pointer.unsafe）",
            );
            continue;
        }
        let Some(child) = resolve_schema_chain(root, property, issues) else {
            continue;
        };
        let pointer = join_pointer(base_pointer, name);
        if layer.total_pointer.is_none() && is_total_property(name, child) {
            layer.total_pointer = Some(pointer.clone());
        }
        match schema_type(child) {
            "array" if layer.first_array.is_none() => {
                layer.first_array = Some((pointer, child));
            }
            "object" => layer.nested_objects.push((pointer, property)),
            _ => {}
        }
    }
    layer
}

/// 有界定位列表数组：根数组、object 直接属性、最多 3 层嵌套 object 属性。
fn scan_envelope<'a>(
    root: &'a serde_json::Value,
    schema: &'a serde_json::Value,
    base_pointer: &str,
    depth: usize,
    budget: &mut ScanBudget,
    issues: &mut Vec<ResponseSchemaIssue>,
) -> EnvelopeScan<'a> {
    if !budget.visit() {
        return EnvelopeScan::default();
    }
    let Some(resolved) = resolve_schema_chain(root, schema, issues) else {
        return EnvelopeScan::default();
    };
    if schema_type(resolved) == "array" {
        return items_scan(root, resolved, base_pointer, None, issues);
    }
    let Some(properties) = resolved
        .get("properties")
        .and_then(|value| value.as_object())
    else {
        return EnvelopeScan::default();
    };
    let layer = scan_object_layer(root, properties, base_pointer, budget, issues);
    if let Some((pointer, array_schema)) = layer.first_array {
        return items_scan(root, array_schema, &pointer, layer.total_pointer, issues);
    }
    if !layer.nested_objects.is_empty() && depth >= MAX_ENVELOPE_DEPTH {
        budget.mark_bounded();
        return EnvelopeScan::default();
    }
    for (pointer, nested) in layer.nested_objects {
        let sub = scan_envelope(root, nested, &pointer, depth + 1, budget, issues);
        if sub.items_pointer.is_some() {
            return sub;
        }
    }
    EnvelopeScan::default()
}

fn extract_fields(
    item_schema: &serde_json::Value,
    budget: &mut ScanBudget,
    issues: &mut Vec<ResponseSchemaIssue>,
) -> Vec<ResponseFieldSchema> {
    let mut fields = Vec::new();
    let Some(properties) = item_schema
        .get("properties")
        .and_then(|value| value.as_object())
    else {
        return fields;
    };
    let mut property_count = 0usize;
    for (name, property) in properties {
        if !budget.visit() {
            break;
        }
        property_count += 1;
        if property_count > MAX_PROPERTIES {
            budget.mark_bounded();
            break;
        }
        if is_unsafe_property(name) {
            push_issue(
                issues,
                "response.pointer.unsafe",
                "已跳过危险属性名（response.pointer.unsafe）",
            );
            continue;
        }
        fields.push(ResponseFieldSchema {
            pointer: join_pointer("", name),
            name: name.clone(),
            r#type: map_field_type(property).to_string(),
        });
    }
    fields
}

fn extract_row_key(
    item_schema: &serde_json::Value,
    budget: &mut ScanBudget,
) -> (Option<String>, PointerOrigin) {
    let Some(properties) = item_schema
        .get("properties")
        .and_then(|value| value.as_object())
    else {
        return (None, PointerOrigin::Unresolved);
    };
    let mut fallback: Option<String> = None;
    let mut property_count = 0usize;
    for (name, property) in properties {
        if !budget.visit() {
            break;
        }
        property_count += 1;
        if property_count > MAX_PROPERTIES {
            budget.mark_bounded();
            break;
        }
        if is_unsafe_property(name) {
            continue;
        }
        if property
            .get("x-primary-key")
            .and_then(|value| value.as_bool())
            == Some(true)
        {
            return (Some(join_pointer("", name)), PointerOrigin::Schema);
        }
        if fallback.is_none() && matches!(name.as_str(), "id" | "_id" | "uuid" | "guid") {
            fallback = Some(join_pointer("", name));
        }
    }
    match fallback {
        Some(pointer) => (Some(pointer), PointerOrigin::Schema),
        None => (None, PointerOrigin::Unresolved),
    }
}

/// 为单个 operation 生成有界、无数据的成功响应 Schema 摘要。
fn extract_response_schema(
    root: &serde_json::Value,
    operation: &serde_json::Value,
    spec_version: &str,
    operation_key: &str,
    operation_id: &str,
) -> ResponseSchemaSummary {
    let mut summary = empty_response_schema(operation_key, operation_id);
    let mut issues: Vec<ResponseSchemaIssue> = Vec::new();
    let mut budget = ScanBudget::new(MAX_VISITED_NODES);

    let Some(success) = success_schema(root, operation, spec_version) else {
        push_issue(
            &mut issues,
            "response.schema.missing",
            "未找到成功响应 Schema（response.schema.missing）",
        );
        summary.issues = issues;
        return summary;
    };

    let scan = scan_envelope(root, success, "", 0, &mut budget, &mut issues);
    if let Some(pointer) = scan.items_pointer {
        summary.items_pointer = Some(pointer);
        summary.items_pointer_origin = PointerOrigin::Schema;
    } else {
        push_issue(
            &mut issues,
            "response.items.unresolved",
            "无法从 Schema 定位列表数组（response.items.unresolved）",
        );
    }
    if let Some(item_schema) = scan.item_schema {
        summary.fields = extract_fields(item_schema, &mut budget, &mut issues);
        let (row_key, origin) = extract_row_key(item_schema, &mut budget);
        summary.row_key_pointer = row_key;
        summary.row_key_pointer_origin = origin;
        if origin == PointerOrigin::Unresolved {
            push_issue(
                &mut issues,
                "response.rowKey.unresolved",
                "无法从 Schema 定位行主键（response.rowKey.unresolved）",
            );
        }
    } else {
        push_issue(
            &mut issues,
            "response.rowKey.unresolved",
            "无法从 Schema 定位行主键（response.rowKey.unresolved）",
        );
    }
    // total 允许缺失：不产生诊断，仅保持 Unresolved。
    if let Some(total_pointer) = scan.total_pointer {
        summary.total_pointer = Some(total_pointer);
        summary.total_pointer_origin = PointerOrigin::Schema;
    }
    if budget.bounded {
        push_issue(
            &mut issues,
            "response.schema.bounded",
            "响应 Schema 遍历超过上限（response.schema.bounded；8 跳 / 3 层 / 50 属性 / 200 节点）",
        );
    }
    summary.issues = issues;
    summary
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
        validate_url_transport(&parsed, "Swagger/OpenAPI 地址")?;
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
    validate_url_transport(&parsed, "Swagger/OpenAPI 地址")?;
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
        assert_eq!(
            summary.query_parameters["listProducts"],
            ["page", "pageSize", "keyword", "category", "minPrice", "maxPrice", "sort"]
        );
    }

    #[test]
    fn discovers_multiple_swagger_ui_spec_urls_without_running_scripts() {
        let base = url::Url::parse("https://docs.example.com/swagger/index.html").unwrap();
        let html = r#"<script>urls: [{url: '/openapi/public.json'}, {url: '/openapi/admin.yaml'}]</script>"#;
        let candidates = extract_static_candidates(html, &base).unwrap();
        assert_eq!(candidates.len(), 2);
        assert!(candidates[0].contains("public.json"));
    }

    // ---------- C2: 响应 Schema 摘要（共享 fixtures / 表驱动 + 防御性） ----------

    fn fixtures_dir() -> std::path::PathBuf {
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../contracts/fixtures/openapi")
    }

    fn parse_fixture(spec: &str) -> OpenApiSummary {
        let content = std::fs::read_to_string(fixtures_dir().join(spec))
            .unwrap_or_else(|error| panic!("读取 fixture {spec} 失败：{error}"));
        parse(&content, "https://example.com/openapi.json").unwrap()
    }

    fn origin_label(origin: PointerOrigin) -> &'static str {
        match origin {
            PointerOrigin::Schema => "schema",
            PointerOrigin::Inferred => "inferred",
            PointerOrigin::Unresolved => "unresolved",
        }
    }

    fn option_to_json(value: &Option<String>) -> serde_json::Value {
        match value {
            Some(pointer) => serde_json::Value::String(pointer.clone()),
            None => serde_json::Value::Null,
        }
    }

    fn has_issue(summary: &ResponseSchemaSummary, code: &str) -> bool {
        summary.issues.iter().any(|issue| issue.code == code)
    }

    fn doc_with_response_schema(
        schema: serde_json::Value,
        components: serde_json::Value,
    ) -> String {
        serde_json::json!({
            "openapi": "3.0.0",
            "info": {"title": "T", "version": "1"},
            "components": {"schemas": components},
            "paths": {"/x": {"get": {
                "operationId": "listX",
                "responses": {"200": {"content": {"application/json": {"schema": schema}}}}
            }}}
        })
        .to_string()
    }

    #[test]
    fn response_schemas_match_shared_manifest() {
        let manifest: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(fixtures_dir().join("manifest.json")).unwrap(),
        )
        .unwrap();
        let cases = manifest["cases"].as_array().expect("manifest.cases");
        assert!(cases.len() >= 3, "manifest 至少包含 3 个 case");
        for case in cases {
            let id = case["id"].as_str().unwrap();
            let spec = case["spec"].as_str().unwrap();
            let operation_id = case["operationId"].as_str().unwrap();
            let summary = parse_fixture(spec);
            let rs = summary
                .response_schemas
                .get(operation_id)
                .unwrap_or_else(|| panic!("[{id}] 缺少 response schema：{operation_id}"));

            assert_eq!(
                rs.operation_key.as_str(),
                case["operation"].as_str().unwrap(),
                "[{id}] operationKey"
            );
            assert_eq!(rs.operation_id.as_str(), operation_id, "[{id}] operationId");
            assert_eq!(
                option_to_json(&rs.items_pointer),
                case["itemsPointer"],
                "[{id}] itemsPointer"
            );
            assert_eq!(
                origin_label(rs.items_pointer_origin),
                case["itemsPointerOrigin"].as_str().unwrap(),
                "[{id}] itemsPointerOrigin"
            );
            assert_eq!(
                option_to_json(&rs.total_pointer),
                case["totalPointer"],
                "[{id}] totalPointer"
            );
            assert_eq!(
                option_to_json(&rs.row_key_pointer),
                case["rowKeyPointer"],
                "[{id}] rowKeyPointer"
            );
            let total_origin = if rs.total_pointer.is_some() {
                PointerOrigin::Schema
            } else {
                PointerOrigin::Unresolved
            };
            assert_eq!(rs.total_pointer_origin, total_origin, "[{id}] totalOrigin");
            let row_key_origin = if rs.row_key_pointer.is_some() {
                PointerOrigin::Schema
            } else {
                PointerOrigin::Unresolved
            };
            assert_eq!(
                rs.row_key_pointer_origin, row_key_origin,
                "[{id}] rowKeyOrigin"
            );
            // 以集合等价断言字段指针，避免耦合 serde_json::Map 的排序实现。
            let mut got: Vec<&str> = rs
                .fields
                .iter()
                .map(|field| field.pointer.as_str())
                .collect();
            got.sort_unstable();
            let mut want: Vec<&str> = case["fieldPointers"]
                .as_array()
                .unwrap()
                .iter()
                .map(|value| value.as_str().unwrap())
                .collect();
            want.sort_unstable();
            assert_eq!(got, want, "[{id}] fieldPointers");
        }
    }

    #[test]
    fn response_schema_uses_x_primary_key_over_name_heuristic() {
        let document = doc_with_response_schema(
            serde_json::json!({
                "type": "array",
                "items": {"type": "object", "properties": {
                    "codeName": {"type": "string", "x-primary-key": true},
                    "id": {"type": "integer"}
                }}
            }),
            serde_json::json!({}),
        );
        let summary = parse(&document, "x").unwrap();
        let rs = &summary.response_schemas["listX"];
        assert_eq!(rs.row_key_pointer.as_deref(), Some("/codeName"));
        assert_eq!(rs.row_key_pointer_origin, PointerOrigin::Schema);
    }

    #[test]
    fn response_schema_resolves_rfc6901_escaped_ref() {
        let document = doc_with_response_schema(
            serde_json::json!({
                "type": "array",
                "items": {"$ref": "#/components/schemas/Order~1Item~0Special"}
            }),
            serde_json::json!({
                "Order/Item~Special": {
                    "type": "object",
                    "properties": {"id": {"type": "integer"}}
                }
            }),
        );
        let summary = parse(&document, "x").unwrap();
        let rs = &summary.response_schemas["listX"];
        assert_eq!(rs.items_pointer.as_deref(), Some(""));
        assert_eq!(rs.row_key_pointer.as_deref(), Some("/id"));
        assert!(rs.fields.iter().any(|field| field.pointer == "/id"));
        assert!(!has_issue(rs, "response.ref.unresolved"));
    }

    #[test]
    fn response_schema_reports_missing_schema() {
        let document = serde_json::json!({
            "openapi": "3.0.0",
            "info": {"title": "T", "version": "1"},
            "paths": {"/x": {"get": {"operationId": "listX", "responses": {}}}}
        })
        .to_string();
        let summary = parse(&document, "x").unwrap();
        let rs = &summary.response_schemas["listX"];
        assert_eq!(rs.items_pointer, None);
        assert_eq!(rs.items_pointer_origin, PointerOrigin::Unresolved);
        assert!(rs.fields.is_empty());
        assert!(has_issue(rs, "response.schema.missing"));
        let value = serde_json::to_value(&summary).unwrap();
        assert!(value["responseSchemas"]["listX"]["itemsPointer"].is_null());
    }

    #[test]
    fn response_schema_bounds_property_count() {
        let mut properties = serde_json::Map::new();
        for index in 0..60 {
            properties.insert(
                format!("field{index:02}"),
                serde_json::json!({"type": "string"}),
            );
        }
        let document = doc_with_response_schema(
            serde_json::json!({
                "type": "array",
                "items": {"type": "object", "properties": properties}
            }),
            serde_json::json!({}),
        );
        let summary = parse(&document, "x").unwrap();
        let rs = &summary.response_schemas["listX"];
        assert!(rs.fields.len() <= MAX_PROPERTIES);
        assert!(has_issue(rs, "response.schema.bounded"));
    }

    #[test]
    fn response_schema_bounds_envelope_depth() {
        // root -> a -> b -> c -> d -> items(array)：第 4 层嵌套被拒绝。
        let mut schema = serde_json::json!({"type": "array", "items": {"type": "object"}});
        for name in ["e", "d", "c", "b", "a"] {
            schema = serde_json::json!({
                "type": "object",
                "properties": { name: schema }
            });
        }
        let document = doc_with_response_schema(schema, serde_json::json!({}));
        let summary = parse(&document, "x").unwrap();
        let rs = &summary.response_schemas["listX"];
        assert_eq!(rs.items_pointer, None);
        assert_eq!(rs.items_pointer_origin, PointerOrigin::Unresolved);
        assert!(has_issue(rs, "response.schema.bounded"));
    }

    #[test]
    fn response_schema_rejects_unsafe_property_names() {
        let document = doc_with_response_schema(
            serde_json::json!({
                "type": "object",
                "properties": {
                    "__proto__": {"type": "array", "items": {"type": "object"}},
                    "__PROTO__": {"type": "array", "items": {"type": "object"}},
                    "items": {"type": "array", "items": {"type": "object", "properties": {
                        "id": {"type": "integer"},
                        "constructor": {"type": "string"},
                        "Constructor": {"type": "string"},
                        "prototype": {"type": "string"}
                    }}}
                }
            }),
            serde_json::json!({}),
        );
        let summary = parse(&document, "x").unwrap();
        let rs = &summary.response_schemas["listX"];
        assert_eq!(rs.items_pointer.as_deref(), Some("/items"));
        assert!(rs.fields.iter().all(|field| {
            let lower = field.pointer.to_ascii_lowercase();
            !matches!(lower.as_str(), "/__proto__" | "/prototype" | "/constructor")
        }));
        assert!(rs.fields.iter().any(|field| field.pointer == "/id"));
        assert!(has_issue(rs, "response.pointer.unsafe"));
    }

    #[test]
    fn response_schema_detects_ref_cycle() {
        let document = doc_with_response_schema(
            serde_json::json!({
                "type": "array",
                "items": {"$ref": "#/components/schemas/A"}
            }),
            serde_json::json!({
                "A": {"$ref": "#/components/schemas/B"},
                "B": {"$ref": "#/components/schemas/A"}
            }),
        );
        let summary = parse(&document, "x").unwrap();
        let rs = &summary.response_schemas["listX"];
        assert!(has_issue(rs, "response.ref.cycle"));
        assert!(rs.fields.is_empty());
    }

    #[test]
    fn response_schema_does_not_follow_external_ref() {
        let document = doc_with_response_schema(
            serde_json::json!({
                "type": "array",
                "items": {"$ref": "https://example.com/schemas.json#/Order"}
            }),
            serde_json::json!({}),
        );
        let summary = parse(&document, "x").unwrap();
        let rs = &summary.response_schemas["listX"];
        assert!(rs.fields.is_empty());
        assert!(has_issue(rs, "response.ref.unresolved"));
    }

    #[test]
    fn response_schema_serializes_camel_case_and_null() {
        let summary = parse_fixture("orders-3.1.json");
        let value = serde_json::to_value(&summary).unwrap();
        let rs = &value["responseSchemas"]["listOrders"];
        assert_eq!(
            rs["operationKey"].as_str(),
            Some("GET /orders · listOrders")
        );
        assert_eq!(rs["itemsPointer"].as_str(), Some("/data/items"));
        assert_eq!(rs["itemsPointerOrigin"].as_str(), Some("schema"));
        assert_eq!(rs["totalPointer"].as_str(), Some("/data/total"));
        assert_eq!(rs["rowKeyPointer"].as_str(), Some("/id"));
        assert!(rs["fields"][0]["type"].is_string());
        let stats = &value["responseSchemas"]["orderStats"];
        assert!(stats["itemsPointer"].is_null());
        assert_eq!(stats["itemsPointerOrigin"].as_str(), Some("unresolved"));
    }
}
