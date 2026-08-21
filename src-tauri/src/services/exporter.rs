use crate::domain::page_spec::{validate, PageSpec};
use rust_xlsxwriter::Workbook;

const MAX_EXPORT_ROWS: usize = 10_000;
const MAX_EXPORT_COLUMNS: usize = 100;

pub fn xlsx(page: PageSpec) -> Result<Vec<u8>, String> {
    validate(&page)?;
    if page.rows.len() > MAX_EXPORT_ROWS || page.columns.len() > MAX_EXPORT_COLUMNS {
        return Err("导出数据超出安全上限".into());
    }
    let mut workbook = Workbook::new();
    let worksheet = workbook.add_worksheet();
    worksheet
        .set_name(safe_sheet_name(&page.title))
        .map_err(|error| error.to_string())?;
    for (column, value) in page.columns.iter().enumerate() {
        worksheet
            .write_string(0, column as u16, value)
            .map_err(|error| error.to_string())?;
    }
    for (row, values) in page.rows.iter().enumerate() {
        for (column, value) in values.iter().enumerate() {
            worksheet
                .write_string((row + 1) as u32, column as u16, value)
                .map_err(|error| error.to_string())?;
        }
    }
    workbook.save_to_buffer().map_err(|error| error.to_string())
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

    #[test]
    fn writes_valid_xlsx_bytes() {
        let page = PageSpec {
            version: 1,
            title: "设备/清单".into(),
            description: "".into(),
            filters: vec![],
            stats: vec![],
            columns: vec!["名称".into()],
            rows: vec![vec!["A".into()]],
            operations: vec![],
        };
        assert!(xlsx(page).unwrap().starts_with(b"PK"));
    }
}
