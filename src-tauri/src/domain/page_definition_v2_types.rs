//! Typed wire DTOs for v2, not an alternative set of domain validation rules.
//! Deserialize a complete `PageDefinitionV2` (or use `page_document`) at boundaries:
//! both paths run the shared schema and domain validator before constructing DTOs.
//! Individual nested DTOs are structural types, not proof of domain validity.

use serde::{Deserialize, Deserializer, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PageDefinitionV2 {
    pub version: VersionV2,
    pub title: String,
    pub description: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub layout: Option<Layout>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub breadcrumb: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub permission_role: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub theme: Option<Theme>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub style_tokens: Option<StyleTokens>,
    pub data_sources: DataSources,
    pub fields: Vec<Field>,
    pub filters: Vec<Filter>,
    pub operations: Vec<Operation>,
    pub views: Vec<View>,
}

// Private serde representation. It is reached only after validate_raw succeeds.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DefinitionWire {
    version: VersionV2,
    title: String,
    description: String,
    layout: Option<Layout>,
    breadcrumb: Option<Vec<String>>,
    permission_role: Option<String>,
    theme: Option<Theme>,
    style_tokens: Option<StyleTokens>,
    data_sources: DataSources,
    fields: Vec<Field>,
    filters: Vec<Filter>,
    operations: Vec<Operation>,
    views: Vec<View>,
}

impl<'de> Deserialize<'de> for PageDefinitionV2 {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let value = serde_json::Value::deserialize(deserializer)?;
        decode_validated(value).map_err(|_| serde::de::Error::custom("invalid v2 page definition"))
    }
}

pub(super) fn decode_validated(
    value: serde_json::Value,
) -> Result<PageDefinitionV2, Vec<super::page_spec::PageIssue>> {
    let validated = super::page_definition_v2::validate_raw(value)?;
    let wire: DefinitionWire = serde_json::from_value(validated.value).map_err(|_| {
        vec![super::page_spec::PageIssue::error(
            "PAGE_V2_DTO_INVALID",
            "",
            "schema",
            "页面定义无法转换为 v2 领域类型",
        )]
    })?;
    Ok(PageDefinitionV2 {
        version: wire.version,
        title: wire.title,
        description: wire.description,
        layout: wire.layout,
        breadcrumb: wire.breadcrumb,
        permission_role: wire.permission_role,
        theme: wire.theme,
        style_tokens: wire.style_tokens,
        data_sources: wire.data_sources,
        fields: wire.fields,
        filters: wire.filters,
        operations: wire.operations,
        views: wire.views,
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "f64", into = "u8")]
pub enum VersionV2 {
    V2,
}
impl TryFrom<f64> for VersionV2 {
    type Error = &'static str;
    fn try_from(value: f64) -> Result<Self, Self::Error> {
        if value == 2.0 {
            Ok(Self::V2)
        } else {
            Err("unsupported v2 version")
        }
    }
}
impl From<VersionV2> for u8 {
    fn from(_: VersionV2) -> Self {
        2
    }
}

macro_rules! string_enum {
    ($name:ident { $($variant:ident => $wire:literal),+ $(,)? }) => {
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
        pub enum $name { $(#[serde(rename = $wire)] $variant),+ }
    };
}
string_enum!(Layout { Sidebar => "sidebar", Full => "full", Modal => "modal" });
string_enum!(Theme { ForgeDefault => "forge-default", EnterpriseBlue => "enterprise-blue", CleanLight => "clean-light", MinimalDark => "minimal-dark", Custom => "custom" });
string_enum!(FieldType { String => "string", Number => "number", Date => "date", Datetime => "datetime", Enum => "enum", Boolean => "boolean", Money => "money" });
string_enum!(FilterOperator { Eq => "eq", Contains => "contains", Gt => "gt", Gte => "gte", Lt => "lt", Lte => "lte", In => "in" });
string_enum!(InputType { String => "string", Number => "number", Date => "date", Boolean => "boolean", Enum => "enum" });
string_enum!(BodyFieldType { String => "string", Number => "number", Integer => "integer", Boolean => "boolean", Date => "date", Enum => "enum" });
string_enum!(HttpMethod { Get => "GET", Post => "POST", Put => "PUT", Patch => "PATCH", Delete => "DELETE" });
string_enum!(OperationRole { List => "list", Detail => "detail", Create => "create", Update => "update", Delete => "delete", Stat => "stat", Export => "export", Stats => "stats", Read => "read", Batch => "batch" });
string_enum!(DataSourceRef { Primary => "primary" });
string_enum!(BatchType { Ids => "ids" });
string_enum!(BatchTargetIn { Body => "body" });
string_enum!(SortOrder { Asc => "asc", Desc => "desc" });
string_enum!(ChartType { Bar => "bar", Line => "line", Pie => "pie" });
string_enum!(Radius { None => "none", Sm => "sm", Md => "md", Lg => "lg", Full => "full" });
string_enum!(Density { Compact => "compact", Comfortable => "comfortable", Relaxed => "relaxed" });

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DataSources {
    pub primary: DataSource,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DataSource {
    pub operation_ref: String,
    pub items_pointer: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_pointer: Option<String>,
    pub row_key_pointer: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Field {
    pub key: String,
    pub label: String,
    pub value_pointer: String,
    #[serde(rename = "type")]
    pub field_type: FieldType,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub format: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enum_values: Option<Vec<String>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Filter {
    pub key: String,
    pub field_key: String,
    pub query_param: String,
    pub operator: FilterOperator,
    pub input_type: InputType,
}

// JSON Schema integers include integral decimal/exponent forms. These adapters
// preserve that acceptance without adding domain rules or lossy number casts.
fn integer<'de, D: Deserializer<'de>>(d: D) -> Result<u32, D::Error> {
    let n = f64::deserialize(d)?;
    if n.fract() == 0.0 && n >= 0.0 && n <= u32::MAX as f64 {
        Ok(n as u32)
    } else {
        Err(serde::de::Error::custom("invalid unsigned integer"))
    }
}
fn optional_integer<'de, D: Deserializer<'de>>(d: D) -> Result<Option<u32>, D::Error> {
    integer(d).map(Some)
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Constraint {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min: Option<serde_json::Number>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max: Option<serde_json::Number>,
    #[serde(
        default,
        deserialize_with = "optional_integer",
        skip_serializing_if = "Option::is_none"
    )]
    pub min_length: Option<u32>,
    #[serde(
        default,
        deserialize_with = "optional_integer",
        skip_serializing_if = "Option::is_none"
    )]
    pub max_length: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pattern: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub nullable: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub readonly: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BodyField {
    pub key: String,
    #[serde(rename = "type")]
    pub field_type: BodyFieldType,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub required: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub constraints: Option<Constraint>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enum_values: Option<Vec<String>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ParameterMappingEntry {
    pub param: String,
    pub field_key: String,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BodyParameterMappingEntry {
    pub param: String,
    pub body_field_key: String,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ParameterMapping {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<Vec<ParameterMappingEntry>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body: Option<Vec<BodyParameterMappingEntry>>,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Batch {
    #[serde(rename = "type")]
    pub batch_type: BatchType,
    pub data_source_ref: DataSourceRef,
    pub ids_field_key: String,
    pub target: BatchTarget,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BatchTarget {
    #[serde(rename = "in")]
    pub location: BatchTargetIn,
    pub param: String,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Operation {
    pub key: String,
    pub api_document_id: String,
    #[serde(rename = "operation_id")]
    pub operation_id: String,
    pub method: HttpMethod,
    pub path: String,
    pub role: OperationRole,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body_schema: Option<Vec<BodyField>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parameter_mapping: Option<ParameterMapping>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub batch: Option<Batch>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub confirm_message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sort_param: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pagination: Option<Pagination>,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Pagination {
    pub page_param: String,
    pub size_param: String,
    #[serde(deserialize_with = "integer")]
    pub default_size: u32,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Sort {
    pub field_key: String,
    pub order: SortOrder,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum View {
    List {
        key: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        title: Option<String>,
        data_source_ref: DataSourceRef,
        field_keys: Vec<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        default_sort: Option<Sort>,
    },
    Chart {
        key: String,
        data_source_ref: DataSourceRef,
        title: String,
        chart_type: ChartType,
        x_field_key: String,
        y_field_key: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        group_by_field_key: Option<String>,
    },
    Kanban {
        key: String,
        data_source_ref: DataSourceRef,
        title: String,
        group_field_key: String,
        card_field_keys: Vec<String>,
    },
    Tabs {
        key: String,
        items: Vec<TabItem>,
    },
    Split {
        key: String,
        left: Box<View>,
        right: Box<View>,
        #[serde(skip_serializing_if = "Option::is_none")]
        split_ratio: Option<serde_json::Number>,
    },
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TabItem {
    pub key: String,
    pub label: String,
    pub view: View,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StyleTokens {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub primary: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub primary_bg: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub primary_bg_hover: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub surface: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub surface_alt: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub surface_control: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub border: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub border_control: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub focus_ring: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text_muted: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text_subtle: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub danger: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub danger_bg: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub success: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub radius: Option<Radius>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub density: Option<Density>,
}
