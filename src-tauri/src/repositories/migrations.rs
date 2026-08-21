use rusqlite::{Connection, OptionalExtension, Result as SqlResult};

const LATEST_VERSION: i64 = 3;

pub fn apply(db: &Connection) -> Result<(), String> {
    db.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);",
    )
    .map_err(|e| e.to_string())?;

    let current = current_version(db).map_err(|e| e.to_string())?;
    if current < 1 {
        db.execute_batch(
            "CREATE TABLE IF NOT EXISTS model_configs (id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL);
             CREATE TABLE IF NOT EXISTS business_connection (id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL, updated_at TEXT NOT NULL);
             CREATE TABLE IF NOT EXISTS templates (id TEXT PRIMARY KEY, name TEXT NOT NULL, payload TEXT NOT NULL, version INTEGER NOT NULL, updated_at TEXT NOT NULL);
             CREATE TABLE IF NOT EXISTS template_versions (template_id TEXT NOT NULL, version INTEGER NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(template_id,version));
             CREATE TABLE IF NOT EXISTS generation_sessions (id TEXT PRIMARY KEY, model_id TEXT NOT NULL, prompt TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL);
             CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);",
        )
        .map_err(|e| e.to_string())?;
        record(db, 1)?;
    }

    if current < 2 && !has_column(db, "templates", "model_id").map_err(|e| e.to_string())? {
        db.execute("ALTER TABLE templates ADD COLUMN model_id TEXT", [])
            .map_err(|e| format!("迁移 templates.model_id 失败：{e}"))?;
        record(db, 2)?;
    } else if current < 2 {
        record(db, 2)?;
    }

    if current < 3 {
        db.execute_batch(
            "CREATE INDEX IF NOT EXISTS idx_templates_updated_at ON templates(updated_at);
             CREATE INDEX IF NOT EXISTS idx_template_versions_template ON template_versions(template_id, version DESC);
             CREATE INDEX IF NOT EXISTS idx_generation_sessions_created_at ON generation_sessions(created_at DESC);",
        )
        .map_err(|e| format!("迁移本地索引失败：{e}"))?;
        record(db, 3)?;
    }

    let final_version = current_version(db).map_err(|e| e.to_string())?;
    if final_version != LATEST_VERSION {
        return Err(format!(
            "数据库迁移未完成，当前版本 {final_version}，期望 {LATEST_VERSION}"
        ));
    }
    Ok(())
}

fn current_version(db: &Connection) -> SqlResult<i64> {
    db.query_row("SELECT MAX(version) FROM schema_migrations", [], |row| {
        row.get::<_, Option<i64>>(0)
    })
    .map(|value| value.unwrap_or(0))
}

fn record(db: &Connection, version: i64) -> Result<(), String> {
    db.execute(
        "INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES(?1, datetime('now'))",
        [version],
    )
    .map_err(|e| format!("记录数据库迁移 v{version} 失败：{e}"))?;
    Ok(())
}

fn has_column(db: &Connection, table: &str, column: &str) -> SqlResult<bool> {
    let mut statement = db.prepare(&format!("PRAGMA table_info([{table}])"))?;
    let mut rows = statement.query([])?;
    while let Some(row) = rows.next()? {
        let name: String = row.get(1)?;
        if name == column {
            return Ok(true);
        }
    }
    Ok(false)
}

#[allow(dead_code)]
fn migration_exists(db: &Connection, version: i64) -> SqlResult<bool> {
    db.query_row(
        "SELECT 1 FROM schema_migrations WHERE version=?1",
        [version],
        |_| Ok(true),
    )
    .optional()
    .map(|value| value.is_some())
}

#[cfg(test)]
mod tests {
    use super::apply;
    use rusqlite::Connection;

    #[test]
    fn fresh_database_reaches_latest_schema() {
        let db = Connection::open_in_memory().expect("in-memory database");
        apply(&db).expect("migrations should succeed");
        let model_id: String = db
            .query_row(
                "SELECT name FROM pragma_table_info('templates') WHERE name='model_id'",
                [],
                |row| row.get(0),
            )
            .expect("model_id column");
        assert_eq!(model_id, "model_id");
        let version: i64 = db
            .query_row("SELECT MAX(version) FROM schema_migrations", [], |row| {
                row.get(0)
            })
            .expect("migration version");
        assert_eq!(version, 3);
    }

    #[test]
    fn legacy_schema_adds_model_binding_without_losing_templates() {
        let db = Connection::open_in_memory().expect("in-memory database");
        db.execute_batch(
            "CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
             INSERT INTO schema_migrations VALUES(1, datetime('now'));
             CREATE TABLE templates(id TEXT PRIMARY KEY, name TEXT NOT NULL, payload TEXT NOT NULL, version INTEGER NOT NULL, updated_at TEXT NOT NULL);
             CREATE TABLE template_versions(template_id TEXT NOT NULL, version INTEGER NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(template_id,version));
             CREATE TABLE generation_sessions(id TEXT PRIMARY KEY, model_id TEXT NOT NULL, prompt TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL);
             INSERT INTO templates VALUES('legacy', '旧模板', '{}', 1, datetime('now'));",
        )
        .expect("legacy schema");
        apply(&db).expect("legacy migration should succeed");
        let name: String = db
            .query_row("SELECT name FROM templates WHERE id='legacy'", [], |row| {
                row.get(0)
            })
            .expect("legacy template");
        assert_eq!(name, "旧模板");
        let has_model_id: bool = db
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM pragma_table_info('templates') WHERE name='model_id')",
                [],
                |row| row.get(0),
            )
            .expect("model binding column");
        assert!(has_model_id);
    }
}
