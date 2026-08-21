use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct PageSpec {
    #[serde(default = "default_version")]
    pub version: u32,
    pub title: String,
    pub description: String,
    pub filters: Vec<String>,
    pub stats: Vec<StatSpec>,
    pub columns: Vec<String>,
    pub rows: Vec<Vec<String>>,
    #[serde(default)]
    pub operations: Vec<OperationBinding>,
}

fn default_version() -> u32 {
    1
}

#[derive(Debug, Serialize, Deserialize, Default)]
pub struct OperationBinding {
    pub operation_id: String,
    pub method: String,
    pub path: String,
    pub role: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct StatSpec {
    pub label: String,
    pub value: String,
}

pub fn validate(spec: &PageSpec) -> Result<(), String> {
    if spec.version != 1 {
        return Err("不支持的 PageSpec 版本".into());
    }
    if spec.title.trim().is_empty() || spec.title.len() > 120 {
        return Err("PageSpec 标题无效".into());
    }
    if spec.filters.len() > 20 || spec.columns.len() > 50 || spec.rows.len() > 100 {
        return Err("PageSpec 超出组件或数据行限制".into());
    }
    if spec.rows.iter().any(|row| row.len() != spec.columns.len()) {
        return Err("PageSpec 行列数量不一致".into());
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
                    "list" | "detail" | "create" | "update" | "delete" | "stats" | "read"
                )
        })
    {
        return Err("PageSpec operation 绑定无效".into());
    }
    Ok(())
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
            filters: vec![],
            stats: vec![],
            columns: vec!["a".into(), "b".into()],
            rows: vec![vec!["1".into()]],
            operations: vec![],
        };
        assert!(validate(&spec).is_err());
    }

    #[test]
    fn accepts_small_valid_page() {
        let spec = PageSpec {
            version: 1,
            title: "设备".into(),
            description: "".into(),
            filters: vec!["状态".into()],
            stats: vec![],
            columns: vec!["设备".into()],
            rows: vec![vec!["A".into()]],
            operations: vec![],
        };
        assert!(validate(&spec).is_ok());
    }
}
