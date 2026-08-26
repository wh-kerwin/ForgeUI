use rusqlite::{Connection, OptionalExtension, Result as SqlResult};

const LATEST_VERSION: i64 = 4;
pub(crate) const DEFAULT_PROJECT_ID: &str = "default-project";
pub(crate) const LEGACY_API_DOCUMENT_ID: &str = "legacy-default-api";

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

    if current < 4 {
        migrate_project_api_catalog(db)?;
    }

    let final_version = current_version(db).map_err(|e| e.to_string())?;
    if final_version != LATEST_VERSION {
        return Err(format!(
            "数据库迁移未完成，当前版本 {final_version}，期望 {LATEST_VERSION}"
        ));
    }
    Ok(())
}

fn migrate_project_api_catalog(db: &Connection) -> Result<(), String> {
    let templates_need_project =
        !has_column(db, "templates", "project_id").map_err(|e| e.to_string())?;
    let sessions_need_project =
        !has_column(db, "generation_sessions", "project_id").map_err(|e| e.to_string())?;
    let transaction = db
        .unchecked_transaction()
        .map_err(|e| format!("开始项目目录迁移失败：{e}"))?;

    transaction
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS projects (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                selected_api_document_ids TEXT NOT NULL DEFAULT '[]',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
             );
             CREATE TABLE IF NOT EXISTS api_documents (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                name TEXT NOT NULL,
                payload TEXT NOT NULL,
                enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE RESTRICT
             );
             CREATE TABLE IF NOT EXISTS template_api_documents (
                template_id TEXT NOT NULL,
                api_document_id TEXT NOT NULL,
                PRIMARY KEY(template_id, api_document_id),
                FOREIGN KEY(template_id) REFERENCES templates(id) ON DELETE CASCADE,
                FOREIGN KEY(api_document_id) REFERENCES api_documents(id) ON DELETE RESTRICT
             );
             CREATE TABLE IF NOT EXISTS generation_session_api_documents (
                session_id TEXT NOT NULL,
                api_document_id TEXT NOT NULL,
                PRIMARY KEY(session_id, api_document_id),
                FOREIGN KEY(session_id) REFERENCES generation_sessions(id) ON DELETE CASCADE,
                FOREIGN KEY(api_document_id) REFERENCES api_documents(id) ON DELETE RESTRICT
             );",
        )
        .map_err(|e| format!("创建项目目录表失败：{e}"))?;

    if templates_need_project {
        transaction
            .execute("ALTER TABLE templates ADD COLUMN project_id TEXT", [])
            .map_err(|e| format!("迁移 templates.project_id 失败：{e}"))?;
    }
    if sessions_need_project {
        transaction
            .execute(
                "ALTER TABLE generation_sessions ADD COLUMN project_id TEXT",
                [],
            )
            .map_err(|e| format!("迁移 generation_sessions.project_id 失败：{e}"))?;
    }

    transaction
        .execute(
            "INSERT OR IGNORE INTO projects(id,name,selected_api_document_ids,created_at,updated_at)
             VALUES(?1,'默认项目','[]',datetime('now'),datetime('now'))",
            [DEFAULT_PROJECT_ID],
        )
        .map_err(|e| format!("创建默认项目失败：{e}"))?;
    transaction
        .execute(
            "UPDATE templates SET project_id=?1 WHERE project_id IS NULL",
            [DEFAULT_PROJECT_ID],
        )
        .map_err(|e| format!("迁移模板项目归属失败：{e}"))?;
    transaction
        .execute(
            "UPDATE generation_sessions SET project_id=?1 WHERE project_id IS NULL",
            [DEFAULT_PROJECT_ID],
        )
        .map_err(|e| format!("迁移生成会话项目归属失败：{e}"))?;

    let legacy_payload =
        if table_exists(&transaction, "business_connection").map_err(|e| e.to_string())? {
            transaction
                .query_row(
                    "SELECT payload FROM business_connection WHERE id=1",
                    [],
                    |row| row.get::<_, String>(0),
                )
                .optional()
                .map_err(|e| format!("读取旧业务连接失败：{e}"))?
        } else {
            None
        };
    if let Some(legacy_payload) = legacy_payload {
        let mut auth: serde_json::Value = serde_json::from_str(&legacy_payload)
            .map_err(|e| format!("旧业务连接 JSON 无效，无法迁移：{e}"))?;
        let spec = auth
            .as_object_mut()
            .and_then(|object| object.remove("openApiSpec"));
        if let Some(spec) = spec {
            let name = spec
                .get("title")
                .and_then(serde_json::Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .unwrap_or("旧版 API 文档")
                .to_owned();
            let document_payload = serde_json::to_string(&serde_json::json!({
                "spec": spec,
                "auth": auth,
            }))
            .map_err(|e| format!("序列化旧 API 文档失败：{e}"))?;
            transaction
                .execute(
                    "INSERT OR IGNORE INTO api_documents(id,project_id,name,payload,enabled,created_at,updated_at)
                     VALUES(?1,?2,?3,?4,1,datetime('now'),datetime('now'))",
                    rusqlite::params![
                        LEGACY_API_DOCUMENT_ID,
                        DEFAULT_PROJECT_ID,
                        name,
                        document_payload
                    ],
                )
                .map_err(|e| format!("迁移旧 API 文档失败：{e}"))?;
            transaction
                .execute(
                    "UPDATE projects SET selected_api_document_ids=?2,updated_at=datetime('now') WHERE id=?1",
                    rusqlite::params![DEFAULT_PROJECT_ID, format!("[\"{LEGACY_API_DOCUMENT_ID}\"]")],
                )
                .map_err(|e| format!("迁移默认 API 文档选择失败：{e}"))?;
            transaction
                .execute(
                    "INSERT OR IGNORE INTO template_api_documents(template_id,api_document_id)
                     SELECT id,?1 FROM templates",
                    [LEGACY_API_DOCUMENT_ID],
                )
                .map_err(|e| format!("迁移模板 API 文档引用失败：{e}"))?;
            transaction
                .execute(
                    "INSERT OR IGNORE INTO generation_session_api_documents(session_id,api_document_id)
                     SELECT id,?1 FROM generation_sessions",
                    [LEGACY_API_DOCUMENT_ID],
                )
                .map_err(|e| format!("迁移生成会话 API 文档引用失败：{e}"))?;
        }
    }

    transaction
        .execute_batch(
            "CREATE INDEX IF NOT EXISTS idx_api_documents_project ON api_documents(project_id, updated_at DESC);
             CREATE INDEX IF NOT EXISTS idx_templates_project ON templates(project_id, updated_at DESC);
             CREATE INDEX IF NOT EXISTS idx_generation_sessions_project ON generation_sessions(project_id, created_at DESC);
             INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(4,datetime('now'));",
        )
        .map_err(|e| format!("完成项目目录迁移失败：{e}"))?;
    transaction
        .commit()
        .map_err(|e| format!("提交项目目录迁移失败：{e}"))
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

fn table_exists(db: &Connection, table: &str) -> SqlResult<bool> {
    db.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1)",
        [table],
        |row| row.get(0),
    )
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
    use super::{apply, DEFAULT_PROJECT_ID, LEGACY_API_DOCUMENT_ID};
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
        assert_eq!(version, 4);
        let project_id: String = db
            .query_row("SELECT id FROM projects", [], |row| row.get(0))
            .expect("default project");
        assert_eq!(project_id, DEFAULT_PROJECT_ID);
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

    #[test]
    fn v3_data_is_migrated_into_default_project_and_legacy_document() {
        let db = Connection::open_in_memory().expect("in-memory database");
        db.execute_batch(
            r#"PRAGMA foreign_keys=ON;
             CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
             INSERT INTO schema_migrations VALUES(1, datetime('now'));
             INSERT INTO schema_migrations VALUES(2, datetime('now'));
             INSERT INTO schema_migrations VALUES(3, datetime('now'));
             CREATE TABLE business_connection(id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL, updated_at TEXT NOT NULL);
             CREATE TABLE templates(id TEXT PRIMARY KEY, name TEXT NOT NULL, payload TEXT NOT NULL, version INTEGER NOT NULL, updated_at TEXT NOT NULL, model_id TEXT);
             CREATE TABLE template_versions(template_id TEXT NOT NULL, version INTEGER NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(template_id,version));
             CREATE TABLE generation_sessions(id TEXT PRIMARY KEY, model_id TEXT NOT NULL, prompt TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL);
             INSERT INTO business_connection VALUES(1, '{"type":"bearer","secretRef":"employee-secret","authorizedOperations":["GET /api/employees · listEmployees"],"openApiSpec":{"title":"员工服务","api_base_url":"http://localhost:3000/"}}', datetime('now'));
             INSERT INTO templates VALUES('template-1','员工页','{}',1,datetime('now'),NULL);
             INSERT INTO generation_sessions VALUES('session-1','model-1','生成员工页','{}',datetime('now'));"#,
        )
        .expect("v3 schema");

        apply(&db).expect("v4 migration should succeed");

        let template_project: String = db
            .query_row(
                "SELECT project_id FROM templates WHERE id='template-1'",
                [],
                |row| row.get(0),
            )
            .expect("template project");
        assert_eq!(template_project, DEFAULT_PROJECT_ID);
        let session_project: String = db
            .query_row(
                "SELECT project_id FROM generation_sessions WHERE id='session-1'",
                [],
                |row| row.get(0),
            )
            .expect("session project");
        assert_eq!(session_project, DEFAULT_PROJECT_ID);

        let payload: String = db
            .query_row(
                "SELECT payload FROM api_documents WHERE id=?1",
                [LEGACY_API_DOCUMENT_ID],
                |row| row.get(0),
            )
            .expect("legacy document");
        let payload: serde_json::Value = serde_json::from_str(&payload).expect("document JSON");
        assert_eq!(payload["spec"]["title"], "员工服务");
        assert_eq!(payload["auth"]["secretRef"], "employee-secret");
        assert!(payload["auth"].get("openApiSpec").is_none());

        let template_links: i64 = db
            .query_row("SELECT COUNT(*) FROM template_api_documents", [], |row| {
                row.get(0)
            })
            .expect("template links");
        let session_links: i64 = db
            .query_row(
                "SELECT COUNT(*) FROM generation_session_api_documents",
                [],
                |row| row.get(0),
            )
            .expect("session links");
        assert_eq!((template_links, session_links), (1, 1));
    }
}
