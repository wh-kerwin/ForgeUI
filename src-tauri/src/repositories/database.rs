use rusqlite::{Connection, OpenFlags};
use serde::Serialize;
use std::path::PathBuf;

// Pure validation keeps tests independent of process-global environment changes.
#[cfg(debug_assertions)]
fn test_db_path(value: Option<&std::ffi::OsStr>) -> Result<Option<PathBuf>, String> {
    let Some(value) = value else { return Ok(None) };
    let invalid = || "FORGE_UI_TEST_DATA_DIR 必须为有效的绝对本地目录".to_string();
    let text = value.to_str().ok_or_else(invalid)?;
    let path = PathBuf::from(value);
    if text.trim().is_empty() || !path.is_absolute() {
        return Err(invalid());
    }
    #[cfg(windows)]
    {
        // Accept drive-rooted local paths only; reject UNC/device paths and aliases.
        let bytes = text.as_bytes();
        if bytes.len() < 3
            || !bytes[0].is_ascii_alphabetic()
            || bytes[1] != b':'
            || !matches!(bytes[2], b'/' | b'\\')
        {
            return Err(invalid());
        }
        for segment in text[3..].split(['/', '\\']).filter(|part| !part.is_empty()) {
            let stem = segment.split('.').next().unwrap_or("").to_ascii_uppercase();
            if segment == "."
                || segment == ".."
                || segment.ends_with(['.', ' '])
                || segment
                    .chars()
                    .any(|c| c.is_control() || "<>:\"|?*".contains(c))
                || matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
                || (stem.len() == 4
                    && (stem.starts_with("COM") || stem.starts_with("LPT"))
                    && matches!(stem.as_bytes()[3], b'1'..=b'9'))
            {
                return Err(invalid());
            }
        }
    }
    if path
        .components()
        .any(|part| matches!(part, std::path::Component::ParentDir))
    {
        return Err(invalid());
    }
    Ok(Some(path.join("forge.db")))
}

pub fn db_path() -> Result<PathBuf, String> {
    #[cfg(debug_assertions)]
    if let Some(path) = test_db_path(std::env::var_os("FORGE_UI_TEST_DATA_DIR").as_deref())? {
        return Ok(path);
    }
    Ok(dirs::data_local_dir()
        .ok_or("无法定位本地数据目录")?
        .join("ForgeUI")
        .join("forge.db"))
}

fn backup_dir() -> Result<PathBuf, String> {
    Ok(db_path()?.parent().ok_or("无效数据目录")?.join("backups"))
}

pub fn open() -> Result<Connection, String> {
    let path = db_path()?;
    std::fs::create_dir_all(path.parent().ok_or("无效数据目录")?).map_err(|e| e.to_string())?;
    let db = Connection::open(path).map_err(|e| e.to_string())?;
    db.execute_batch("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;")
        .map_err(|e| e.to_string())?;
    crate::repositories::migrations::apply(&db)?;
    Ok(db)
}

pub fn backup() -> Result<String, String> {
    let database = open()?;
    database
        .execute_batch("PRAGMA wal_checkpoint(FULL);")
        .map_err(|e| e.to_string())?;
    drop(database);
    let source = db_path()?;
    let backup_dir = backup_dir()?;
    std::fs::create_dir_all(&backup_dir).map_err(|e| e.to_string())?;
    let timestamp = chrono_like_timestamp();
    let mut target = backup_dir.join(format!("forge-{timestamp}.db"));
    let mut collision = 1_u32;
    while target.exists() {
        target = backup_dir.join(format!("forge-{timestamp}-{collision}.db"));
        collision = collision.saturating_add(1);
    }
    std::fs::copy(&source, &target).map_err(|e| e.to_string())?;
    Ok(target.to_string_lossy().to_string())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupInfo {
    pub file_name: String,
    pub size_bytes: u64,
    pub modified_at: u64,
}

pub fn list_backups() -> Result<Vec<BackupInfo>, String> {
    let directory = backup_dir()?;
    if !directory.exists() {
        return Ok(Vec::new());
    }
    let mut entries = std::fs::read_dir(&directory)
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let path = entry.path();
            let file_name = path.file_name()?.to_str()?.to_owned();
            if !is_valid_backup_name(&file_name) || !path.is_file() {
                return None;
            }
            let metadata = entry.metadata().ok()?;
            let modified_at = metadata
                .modified()
                .ok()?
                .duration_since(std::time::UNIX_EPOCH)
                .ok()?
                .as_secs();
            Some(BackupInfo {
                file_name,
                size_bytes: metadata.len(),
                modified_at,
            })
        })
        .collect::<Vec<_>>();
    entries.sort_by(|left, right| right.modified_at.cmp(&left.modified_at));
    Ok(entries)
}

pub fn restore_backup(file_name: String) -> Result<String, String> {
    if !is_valid_backup_name(&file_name) {
        return Err("备份文件名无效".into());
    }
    let directory = backup_dir()?;
    let source = directory.join(&file_name);
    if !source.is_file() {
        return Err("备份文件不存在".into());
    }
    let source = source
        .canonicalize()
        .map_err(|e| format!("无法定位备份文件：{e}"))?;
    let canonical_dir = directory
        .canonicalize()
        .map_err(|e| format!("无法定位备份目录：{e}"))?;
    if source.parent() != Some(canonical_dir.as_path()) {
        return Err("备份文件路径不在受控目录内".into());
    }

    // Validate the backup before touching the active database.
    let check = Connection::open_with_flags(&source, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| format!("备份不是有效的 SQLite 数据库：{e}"))?;
    let integrity: String = check
        .query_row("PRAGMA integrity_check", [], |row| row.get(0))
        .map_err(|e| format!("无法检查备份完整性：{e}"))?;
    if integrity != "ok" {
        return Err(format!("备份完整性检查失败：{integrity}"));
    }
    drop(check);

    // Preserve the current state so a failed restore can be recovered.
    backup()?;
    let current = db_path()?;
    let temp = current.with_extension(format!("restore-{}.tmp", std::process::id()));
    std::fs::copy(&source, &temp).map_err(|e| format!("无法准备恢复文件：{e}"))?;
    let result = (|| {
        std::fs::copy(&temp, &current).map_err(|e| format!("无法替换本地数据库：{e}"))?;
        for suffix in ["-wal", "-shm"] {
            let sidecar = PathBuf::from(format!("{}{}", current.to_string_lossy(), suffix));
            let _ = std::fs::remove_file(sidecar);
        }
        Ok::<(), String>(())
    })();
    let _ = std::fs::remove_file(&temp);
    result?;
    // Reopen once to apply any compatible migrations and ensure the file is usable.
    drop(open()?);
    Ok(file_name)
}

fn is_valid_backup_name(file_name: &str) -> bool {
    file_name.starts_with("forge-")
        && file_name.ends_with(".db")
        && file_name.len() > 10
        && file_name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_'))
}

#[cfg(test)]
mod tests {
    use super::is_valid_backup_name;

    #[cfg(debug_assertions)]
    #[test]
    fn explicit_test_directory_is_absolute_and_fail_closed() {
        use super::test_db_path;
        use std::ffi::OsStr;
        assert_eq!(test_db_path(None).unwrap(), None);
        let root = std::env::temp_dir().join("forge-path-test");
        assert_eq!(
            test_db_path(Some(root.as_os_str())).unwrap(),
            Some(root.join("forge.db"))
        );
        for invalid in [
            "",
            " ",
            "relative",
            "C:relative",
            "C:\\bad<name",
            "C:\\bad.\\dir",
            "C:\\good\\..\\other",
            "\\\\server\\share",
        ] {
            assert!(
                test_db_path(Some(OsStr::new(invalid))).is_err(),
                "accepted {invalid:?}"
            );
        }
    }

    #[test]
    fn backup_names_are_confined_to_expected_shape() {
        assert!(is_valid_backup_name("forge-1720000000.db"));
        assert!(!is_valid_backup_name("..\\forge-1.db"));
        assert!(!is_valid_backup_name("forge-1.sqlite"));
        assert!(!is_valid_backup_name("forge-.db"));
    }
}

fn chrono_like_timestamp() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
