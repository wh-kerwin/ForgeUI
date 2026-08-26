use app_lib::conformance::{execute_probe, ProbeCommand, ProbeResponse};
use std::io::{self, BufRead, Write};

fn main() {
    let stdin = io::stdin();
    let mut stdout = io::stdout().lock();
    for line in stdin.lock().lines() {
        let response = match line {
            Ok(line) if !line.trim().is_empty() => {
                match serde_json::from_str::<ProbeCommand>(&line) {
                    Ok(command) => tauri::async_runtime::block_on(execute_probe(command)),
                    Err(error) => ProbeResponse::Result {
                        ok: false,
                        page: None,
                        error: Some(format!("探针请求无效：{error}")),
                    },
                }
            }
            Ok(_) => continue,
            Err(error) => ProbeResponse::Result {
                ok: false,
                page: None,
                error: Some(format!("无法读取探针请求：{error}")),
            },
        };
        if serde_json::to_writer(&mut stdout, &response).is_err() {
            break;
        }
        if writeln!(&mut stdout).and_then(|_| stdout.flush()).is_err() {
            break;
        }
    }
}
