use rust_xlsxwriter::Workbook;
use serde::Deserialize;

const MAX_EXPORT_ROWS: usize = 10_000;
const MAX_EXPORT_COLUMNS: usize = 100;
const MAX_EXPORT_CELL_BYTES: usize = 4_096;

/// A data export is not a page definition: it carries only the currently loaded
/// display values plus an explicit scope. Authorization and fetching stay in the UI.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ExportDataset {
    pub title: String,
    pub columns: Vec<String>,
    pub rows: Vec<Vec<String>>,
    pub scope: String,
    #[serde(default)]
    pub scope_note: Option<String>,
}

pub fn xlsx(dataset: ExportDataset) -> Result<Vec<u8>, String> {
    if dataset.columns.len() > MAX_EXPORT_COLUMNS || dataset.rows.len() > MAX_EXPORT_ROWS {
        return Err("导出数据超出安全上限".into());
    }
    if !matches!(dataset.scope.as_str(), "current-page" | "definition-sample") {
        return Err("导出数据范围无效".into());
    }
    let mut workbook = Workbook::new();
    {
        let worksheet = workbook.add_worksheet();
        worksheet
            .set_name(safe_sheet_name(&dataset.title))
            .map_err(|error| error.to_string())?;
        for (column, value) in dataset.columns.iter().enumerate() {
            worksheet
                .write_string(0, column as u16, safe_cell(value))
                .map_err(|error| error.to_string())?;
        }
        for (row, values) in dataset.rows.iter().enumerate() {
            for (column, value) in values.iter().enumerate().take(MAX_EXPORT_COLUMNS) {
                // write_string keeps spreadsheet formulas as data; it never evaluates them.
                worksheet
                    .write_string((row + 1) as u32, column as u16, safe_cell(value))
                    .map_err(|error| error.to_string())?;
            }
        }
    }
    // The scope travels with the file so a shared export cannot be read as a full dataset.
    if let Some(note) = dataset.scope_note.as_deref() {
        let info = workbook.add_worksheet();
        info.set_name("导出范围")
            .map_err(|error| error.to_string())?;
        info.write_string(0, 0, dataset.scope.as_str())
            .map_err(|error| error.to_string())?;
        info.write_string(1, 0, safe_cell(note))
            .map_err(|error| error.to_string())?;
    }
    workbook.save_to_buffer().map_err(|error| error.to_string())
}

fn safe_cell(value: &str) -> &str {
    if value.len() <= MAX_EXPORT_CELL_BYTES {
        value
    } else {
        let mut end = MAX_EXPORT_CELL_BYTES;
        while !value.is_char_boundary(end) {
            end -= 1;
        }
        &value[..end]
    }
}

fn safe_sheet_name(title: &str) -> String {
    let cleaned: String = title
        .chars()
        .filter(|character| !matches!(character, ':' | '\\' | '/' | '?' | '*' | '[' | ']'))
        .take(31)
        .collect();
    if cleaned.trim().is_empty() {
        "数据导出".into()
    } else {
        cleaned
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dataset() -> ExportDataset {
        ExportDataset {
            title: "设备/清单".into(),
            columns: vec!["名称".into(), "金额".into()],
            rows: vec![vec!["A".into(), "=1+1".into()]],
            scope: "current-page".into(),
            scope_note: Some("仅包含当前已加载页的展示值".into()),
        }
    }

    #[test]
    fn writes_valid_xlsx_bytes_from_a_bounded_dataset() {
        assert!(xlsx(dataset()).unwrap().starts_with(b"PK"));
    }

    #[test]
    fn formula_like_values_stay_strings_and_oversized_cells_are_bounded() {
        let mut value = dataset();
        value.rows[0][1] = "=HYPERLINK(\"http://example.invalid\")".into();
        value.rows[0].push("x".repeat(MAX_EXPORT_CELL_BYTES * 2));
        assert!(xlsx(value).unwrap().starts_with(b"PK"));
        assert_eq!(safe_cell("=1+1"), "=1+1");
        assert_eq!(
            safe_cell(&"é".repeat(MAX_EXPORT_CELL_BYTES)).len(),
            MAX_EXPORT_CELL_BYTES
        );
    }

    #[test]
    fn limits_and_scope_are_enforced() {
        let mut value = dataset();
        value.scope = "whole-dataset".into();
        assert!(xlsx(value).is_err());
        let mut value = dataset();
        value.rows = vec![vec!["A".into()]; MAX_EXPORT_ROWS + 1];
        assert!(xlsx(value).is_err());
        let mut value = dataset();
        value.columns = vec!["c".into(); MAX_EXPORT_COLUMNS + 1];
        assert!(xlsx(value).is_err());
    }

    #[test]
    fn unknown_dataset_fields_cannot_smuggle_a_definition() {
        let raw = r#"{"title":"t","columns":[],"rows":[],"scope":"current-page","page":{"rows":[["secret"]]}}"#;
        assert!(serde_json::from_str::<ExportDataset>(raw).is_err());
    }
}
