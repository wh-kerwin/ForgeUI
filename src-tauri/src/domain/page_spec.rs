use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct PageSpec {
    #[serde(default = "default_version")]
    pub version: u32,
    pub title: String,
    pub description: String,
    #[serde(default)]
    pub layout: Option<String>,
    #[serde(default)]
    pub breadcrumb: Vec<String>,
    #[serde(rename = "permissionRole", default)]
    pub permission_role: Option<String>,
    #[serde(rename = "createdAt", default)]
    pub created_at: Option<String>,
    #[serde(rename = "updatedAt", default)]
    pub updated_at: Option<String>,
    pub filters: Vec<String>,
    pub stats: Vec<StatSpec>,
    pub columns: Vec<String>,
    #[serde(rename = "columnMeta", default)]
    pub column_meta: Vec<ColumnMeta>,
    pub rows: Vec<Vec<String>>,
    #[serde(default)]
    pub operations: Vec<OperationBinding>,
    #[serde(default)]
    pub views: Vec<PageView>,
    #[serde(default)]
    pub interaction: Option<InteractionSpec>,
    #[serde(rename = "batchActions", default)]
    pub batch_actions: Vec<BatchAction>,
    #[serde(default)]
    pub theme: Option<String>,
    #[serde(rename = "styleTokens", default)]
    pub style_tokens: Option<std::collections::HashMap<String, serde_json::Value>>,
}

fn default_version() -> u32 {
    1
}

#[derive(Debug, Serialize, Deserialize, Default)]
pub struct OperationBinding {
    #[serde(
        rename = "apiDocumentId",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub api_document_id: Option<String>,
    pub operation_id: String,
    pub method: String,
    pub path: String,
    pub role: String,
    #[serde(rename = "bodySchema", default)]
    pub body_schema: Option<Vec<FieldSchema>>,
    #[serde(rename = "confirmMessage", default)]
    pub confirm_message: Option<String>,
    #[serde(default)]
    pub pagination: Option<PaginationSpec>,
    #[serde(rename = "sortParam", default)]
    pub sort_param: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldSchema {
    pub name: String,
    pub r#type: String,
    pub enum_values: Option<Vec<String>>,
    pub required: bool,
    pub description: Option<String>,
    pub visible_when: Option<VisibleWhen>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct VisibleWhen {
    pub field: String,
    pub equals: VisibleEquals,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(untagged)]
pub enum VisibleEquals {
    One(String),
    Many(Vec<String>),
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PaginationSpec {
    #[serde(rename = "pageParam")]
    pub page_param: String,
    #[serde(rename = "sizeParam")]
    pub size_param: String,
    #[serde(rename = "defaultSize")]
    pub default_size: u32,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ColumnMeta {
    pub name: String,
    pub r#type: String,
    pub format: Option<String>,
    #[serde(rename = "enumLabels", default)]
    pub enum_labels: Option<std::collections::HashMap<String, String>>,
    pub sortable: Option<bool>,
    pub filterable: Option<bool>,
    #[serde(rename = "searchMode")]
    pub search_mode: Option<String>,
    pub width: Option<String>,
    pub visible: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BatchAction {
    #[serde(
        rename = "apiDocumentId",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub api_document_id: Option<String>,
    pub operation_id: String,
    pub method: String,
    pub path: String,
    #[serde(rename = "confirmMessage", default)]
    pub confirm_message: Option<String>,
    #[serde(rename = "payloadBuilder")]
    pub payload_builder: PayloadBuilder,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PayloadBuilder {
    pub r#type: String,
    #[serde(rename = "customPayload", default)]
    pub custom_payload: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Default)]
pub struct InteractionSpec {
    pub create: Option<InteractionMode>,
    pub update: Option<InteractionMode>,
    pub delete: Option<InteractionMode>,
    pub detail: Option<InteractionMode>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum InteractionMode {
    Modal,
    Drawer,
    Inline,
    Redirect,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct StatSpec {
    pub label: String,
    pub value: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum PageView {
    #[serde(rename = "list")]
    List {
        title: Option<String>,
        #[serde(rename = "defaultSort")]
        default_sort: Option<DefaultSort>,
    },
    #[serde(rename = "chart")]
    Chart {
        title: String,
        #[serde(rename = "chartType")]
        chart_type: String,
        #[serde(rename = "xAxisColumn")]
        x_axis_column: String,
        #[serde(rename = "yAxisColumn")]
        y_axis_column: String,
        #[serde(rename = "groupByColumn")]
        group_by_column: Option<String>,
    },
    #[serde(rename = "kanban")]
    Kanban {
        title: String,
        #[serde(rename = "groupColumn")]
        group_column: String,
        #[serde(rename = "cardFields")]
        card_fields: Vec<String>,
    },
    #[serde(rename = "tabs")]
    Tabs { items: Vec<TabItem> },
    #[serde(rename = "split")]
    Split {
        left: Box<PageView>,
        right: Box<PageView>,
        #[serde(rename = "splitRatio")]
        split_ratio: Option<f64>,
    },
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DefaultSort {
    pub column: String,
    pub order: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TabItem {
    pub key: String,
    pub label: String,
    pub view: PageView,
}

pub fn validate(spec: &PageSpec) -> Result<(), String> {
    if spec.version != 1 {
        return Err("不支持的 PageSpec 版本".into());
    }
    if spec.title.trim().is_empty() || spec.title.len() > 120 {
        return Err("PageSpec 标题无效".into());
    }
    if spec
        .layout
        .as_ref()
        .is_some_and(|layout| !matches!(layout.as_str(), "sidebar" | "full" | "modal"))
        || spec.breadcrumb.len() > 10
        || spec
            .breadcrumb
            .iter()
            .any(|item| item.trim().is_empty() || item.len() > 120)
        || [&spec.permission_role, &spec.created_at, &spec.updated_at]
            .into_iter()
            .flatten()
            .any(|value| value.len() > 120)
    {
        return Err("PageSpec 页面元数据无效".into());
    }
    if spec.filters.len() > 20
        || spec.columns.len() > 50
        || spec.column_meta.len() > 50
        || spec.rows.len() > 100
    {
        return Err("PageSpec 超出组件或数据行限制".into());
    }
    if spec.rows.iter().any(|row| row.len() != spec.columns.len()) {
        return Err("PageSpec 行列数量不一致".into());
    }
    if spec.theme.as_ref().is_some_and(|theme| {
        !matches!(
            theme.as_str(),
            "forge-default" | "enterprise-blue" | "clean-light" | "minimal-dark" | "custom"
        )
    }) || spec
        .style_tokens
        .as_ref()
        .is_some_and(|tokens| !valid_style_tokens(tokens))
    {
        return Err("PageSpec theme token 无效".into());
    }
    if spec.column_meta.iter().any(|meta| {
        !spec.columns.contains(&meta.name)
            || !matches!(
                meta.r#type.as_str(),
                "string" | "number" | "date" | "datetime" | "enum" | "boolean" | "money"
            )
            || meta.format.as_ref().is_some_and(|format| format.len() > 64)
            || meta
                .search_mode
                .as_ref()
                .is_some_and(|mode| !matches!(mode.as_str(), "exact" | "fuzzy" | "range"))
            || meta
                .width
                .as_ref()
                .is_some_and(|width| !valid_column_width(width))
            || meta.enum_labels.as_ref().is_some_and(|labels| {
                labels.len() > 100
                    || labels
                        .iter()
                        .any(|(key, value)| key.len() > 120 || value.len() > 120)
            })
    }) {
        return Err("PageSpec columnMeta 无效".into());
    }
    if spec.views.len() > 10
        || spec
            .views
            .iter()
            .any(|view| validate_view(view, &spec.columns, 0).is_err())
    {
        return Err("PageSpec view 结构无效".into());
    }
    if spec.operations.len() > 30
        || spec.operations.iter().any(|operation| {
            operation.operation_id.trim().is_empty()
                || !matches!(
                    operation.method.as_str(),
                    "GET" | "POST" | "PUT" | "PATCH" | "DELETE"
                )
                || !matches!(
                    operation.role.as_str(),
                    "list"
                        | "detail"
                        | "create"
                        | "update"
                        | "delete"
                        | "stat"
                        | "export"
                        | "stats"
                        | "read"
                )
                || operation
                    .body_schema
                    .as_ref()
                    .is_some_and(|fields| !valid_field_schema(fields))
                || operation
                    .confirm_message
                    .as_ref()
                    .is_some_and(|message| message.len() > 500)
                || operation.pagination.as_ref().is_some_and(|pagination| {
                    pagination.default_size == 0
                        || pagination.default_size > 1000
                        || pagination.page_param.is_empty()
                        || pagination.size_param.is_empty()
                })
        })
    {
        return Err("PageSpec operation 绑定无效".into());
    }
    if spec.batch_actions.len() > 10
        || spec.batch_actions.iter().any(|action| {
            !matches!(action.method.as_str(), "POST" | "DELETE")
                || action.operation_id.trim().is_empty()
                || action.path.trim().is_empty()
                || !matches!(action.payload_builder.r#type.as_str(), "ids" | "custom")
                || action.payload_builder.r#type == "custom"
                    && action
                        .payload_builder
                        .custom_payload
                        .as_ref()
                        .is_none_or(|payload| payload.trim().is_empty())
                || action
                    .confirm_message
                    .as_ref()
                    .is_some_and(|message| message.len() > 500)
        })
    {
        return Err("PageSpec batch action 无效".into());
    }
    Ok(())
}

fn valid_style_tokens(tokens: &std::collections::HashMap<String, serde_json::Value>) -> bool {
    tokens.len() <= 17
        && tokens.iter().all(|(key, value)| match key.as_str() {
            "radius" => value
                .as_str()
                .is_some_and(|value| matches!(value, "none" | "sm" | "md" | "lg" | "full")),
            "density" => value
                .as_str()
                .is_some_and(|value| matches!(value, "compact" | "comfortable" | "relaxed")),
            "primary" | "primaryBg" | "primaryBgHover" | "surface" | "surfaceAlt"
            | "surfaceControl" | "border" | "borderControl" | "focusRing" | "text"
            | "textMuted" | "textSubtle" | "danger" | "dangerBg" | "success" => {
                value.as_str().is_some_and(valid_hex_color)
            }
            _ => false,
        })
}

fn valid_hex_color(value: &str) -> bool {
    let digits = value.strip_prefix('#').unwrap_or_default();
    matches!(digits.len(), 3 | 4 | 6 | 8) && digits.bytes().all(|byte| byte.is_ascii_hexdigit())
}

pub(crate) fn valid_field_schema(fields: &[FieldSchema]) -> bool {
    if fields.len() > 50 {
        return false;
    }
    let field_names = fields
        .iter()
        .map(|field| field.name.as_str())
        .collect::<std::collections::HashSet<_>>();
    field_names.len() == fields.len()
        && fields.iter().all(|field| {
            !field.name.trim().is_empty()
                && field.name.len() <= 120
                && matches!(
                    field.r#type.as_str(),
                    "string" | "number" | "integer" | "boolean" | "date" | "enum"
                )
                && field
                    .description
                    .as_ref()
                    .is_none_or(|description| description.len() <= 500)
                && field.enum_values.as_ref().is_none_or(|values| {
                    !values.is_empty()
                        && values.len() <= 100
                        && values.iter().all(|value| value.len() <= 120)
                })
                && field.visible_when.as_ref().is_none_or(|condition| {
                    field_names.contains(condition.field.as_str())
                        && match &condition.equals {
                            VisibleEquals::One(_) => true,
                            VisibleEquals::Many(values) => {
                                !values.is_empty()
                                    && values.len() <= 50
                                    && values.iter().all(|value| value.len() <= 120)
                            }
                        }
                })
        })
}

fn valid_column_width(width: &str) -> bool {
    if width == "auto" {
        return true;
    }
    if let Some(value) = width
        .strip_suffix("px")
        .and_then(|value| value.parse::<u32>().ok())
    {
        return (48..=600).contains(&value);
    }
    width
        .strip_suffix('%')
        .and_then(|value| value.parse::<u32>().ok())
        .is_some_and(|value| (5..=100).contains(&value))
}

fn validate_view(view: &PageView, columns: &[String], depth: usize) -> Result<(), ()> {
    if depth > 4 {
        return Err(());
    }
    match view {
        PageView::List { default_sort, .. } => {
            if default_sort.as_ref().is_some_and(|sort| {
                !columns.contains(&sort.column) || !matches!(sort.order.as_str(), "asc" | "desc")
            }) {
                Err(())
            } else {
                Ok(())
            }
        }
        PageView::Chart {
            chart_type,
            x_axis_column,
            y_axis_column,
            group_by_column,
            ..
        } => {
            if !matches!(chart_type.as_str(), "bar" | "line" | "pie")
                || !columns.contains(x_axis_column)
                || !columns.contains(y_axis_column)
                || group_by_column
                    .as_ref()
                    .is_some_and(|column| !columns.contains(column))
            {
                Err(())
            } else {
                Ok(())
            }
        }
        PageView::Kanban {
            group_column,
            card_fields,
            ..
        } => {
            if !columns.contains(group_column)
                || card_fields.len() > 20
                || card_fields.iter().any(|field| !columns.contains(field))
            {
                Err(())
            } else {
                Ok(())
            }
        }
        PageView::Tabs { items } => {
            let mut keys = std::collections::HashSet::new();
            if items.is_empty()
                || items.len() > 10
                || items.iter().any(|item| {
                    item.key.trim().is_empty()
                        || item.label.trim().is_empty()
                        || !keys.insert(&item.key)
                        || validate_view(&item.view, columns, depth + 1).is_err()
                })
            {
                Err(())
            } else {
                Ok(())
            }
        }
        PageView::Split {
            left,
            right,
            split_ratio,
        } => {
            if split_ratio.is_some_and(|ratio| !(0.2..=0.8).contains(&ratio))
                || validate_view(left, columns, depth + 1).is_err()
                || validate_view(right, columns, depth + 1).is_err()
            {
                Err(())
            } else {
                Ok(())
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_mismatched_rows() {
        let spec = PageSpec {
            version: 1,
            title: "x".into(),
            description: "".into(),
            layout: None,
            breadcrumb: vec![],
            permission_role: None,
            created_at: None,
            updated_at: None,
            filters: vec![],
            stats: vec![],
            columns: vec!["a".into(), "b".into()],
            column_meta: vec![],
            rows: vec![vec!["1".into()]],
            operations: vec![],
            views: vec![],
            interaction: None,
            batch_actions: vec![],
            theme: None,
            style_tokens: None,
        };
        assert!(validate(&spec).is_err());
    }

    #[test]
    fn accepts_small_valid_page() {
        let spec = PageSpec {
            version: 1,
            title: "设备".into(),
            description: "".into(),
            layout: None,
            breadcrumb: vec![],
            permission_role: None,
            created_at: None,
            updated_at: None,
            filters: vec!["状态".into()],
            stats: vec![],
            columns: vec!["设备".into()],
            column_meta: vec![],
            rows: vec![vec!["A".into()]],
            operations: vec![],
            views: vec![],
            interaction: None,
            batch_actions: vec![],
            theme: None,
            style_tokens: None,
        };
        assert!(validate(&spec).is_ok());
    }

    #[test]
    fn accepts_optional_interaction_and_confirmation_copy() {
        let spec: PageSpec = serde_json::from_value(serde_json::json!({
            "version": 1,
            "title": "设备",
            "description": "",
            "filters": [],
            "stats": [],
            "columns": ["ID"],
            "rows": [["1"]],
            "operations": [{
                "apiDocumentId": "devices-api",
                "operation_id": "deleteDevice",
                "method": "DELETE",
                "path": "/devices/{id}",
                "role": "delete",
                "confirmMessage": "删除后无法恢复"
            }],
            "interaction": {"create": "modal", "update": "drawer", "delete": "modal", "detail": "inline"}
        })).unwrap();
        assert!(validate(&spec).is_ok());
        assert_eq!(
            spec.operations[0].confirm_message.as_deref(),
            Some("删除后无法恢复")
        );
        assert_eq!(
            spec.operations[0].api_document_id.as_deref(),
            Some("devices-api")
        );
        assert_eq!(
            serde_json::to_value(&spec).unwrap()["operations"][0]["apiDocumentId"],
            "devices-api"
        );
        assert!(matches!(
            spec.interaction.unwrap().update,
            Some(InteractionMode::Drawer)
        ));
    }

    #[test]
    fn validates_recursive_views_column_metadata_and_batch_payloads() {
        let valid: PageSpec = serde_json::from_value(serde_json::json!({
            "version": 1, "title": "Orders", "description": "", "filters": [], "stats": [],
            "columns": ["id", "amount"], "rows": [["1", "12"]],
            "columnMeta": [{"name": "amount", "type": "money", "width": "120px", "sortable": true}],
            "views": [{"type": "tabs", "items": [{"key": "main", "label": "Main", "view": {"type": "split", "splitRatio": 0.6, "left": {"type": "list", "defaultSort": {"column": "amount", "order": "desc"}}, "right": {"type": "chart", "title": "Amount", "chartType": "bar", "xAxisColumn": "id", "yAxisColumn": "amount"}}}]}],
            "batchActions": [{"operation_id": "archive", "method": "POST", "path": "/orders/archive", "payloadBuilder": {"type": "ids"}}]
        })).unwrap();
        assert!(validate(&valid).is_ok());

        let invalid: PageSpec = serde_json::from_value(serde_json::json!({
            "version": 1, "title": "Orders", "description": "", "filters": [], "stats": [],
            "columns": ["id"], "rows": [["1"]],
            "batchActions": [{"operation_id": "archive", "method": "POST", "path": "/orders/archive", "payloadBuilder": {"type": "custom"}}]
        })).unwrap();
        assert!(validate(&invalid).is_err());
    }

    #[test]
    fn validates_page_metadata_and_linked_operation_body_schema() {
        let valid: PageSpec = serde_json::from_value(serde_json::json!({
            "version": 1, "title": "Orders", "description": "", "filters": [], "stats": [],
            "layout": "sidebar", "breadcrumb": ["Operations", "Orders"], "permissionRole": "order.manager",
            "createdAt": "2026-08-25T10:00:00Z", "updatedAt": "2026-08-25T11:00:00Z",
            "columns": ["id"], "rows": [["1"]],
            "operations": [{
                "operation_id": "updateOrder", "method": "PATCH", "path": "/orders/{id}", "role": "update",
                "bodySchema": [
                    {"name": "status", "type": "enum", "required": true, "enumValues": ["open", "closed"]},
                    {"name": "reason", "type": "string", "required": true, "visibleWhen": {"field": "status", "equals": "closed"}}
                ]
            }, {"operation_id": "exportOrders", "method": "GET", "path": "/orders/export", "role": "export"}]
        })).unwrap();
        assert!(validate(&valid).is_ok());

        let invalid: PageSpec = serde_json::from_value(serde_json::json!({
            "version": 1, "title": "Orders", "description": "", "filters": [], "stats": [],
            "columns": ["id"], "rows": [["1"]],
            "operations": [{
                "operation_id": "updateOrder", "method": "PATCH", "path": "/orders/{id}", "role": "update",
                "bodySchema": [{"name": "reason", "type": "string", "required": true, "visibleWhen": {"field": "missing", "equals": []}}]
            }]
        })).unwrap();
        assert!(validate(&invalid).is_err());
    }

    #[test]
    fn rejects_non_color_css_theme_tokens() {
        let unsafe_theme: PageSpec = serde_json::from_value(serde_json::json!({
            "version": 1, "title": "Unsafe", "description": "", "filters": [], "stats": [],
            "columns": ["id"], "rows": [["1"]], "theme": "custom",
            "styleTokens": {"primary": "url(https://example.com/pixel)", "radius": "md"}
        }))
        .unwrap();
        assert!(validate(&unsafe_theme).is_err());

        let alpha_hex: PageSpec = serde_json::from_value(serde_json::json!({
            "version": 1, "title": "Safe", "description": "", "filters": [], "stats": [],
            "columns": ["id"], "rows": [["1"]], "theme": "custom",
            "styleTokens": {"text": "#000000e0", "radius": "md", "density": "compact"}
        }))
        .unwrap();
        assert!(validate(&alpha_hex).is_ok());
    }
}
