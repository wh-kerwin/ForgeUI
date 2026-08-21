pub fn validate_https_or_debug_local(url: &url::Url, subject: &str) -> Result<(), String> {
    let local = matches!(
        url.host_str(),
        Some("localhost") | Some("127.0.0.1") | Some("::1")
    );
    if url.scheme() != "https" && !(cfg!(debug_assertions) && local) {
        return Err(format!(
            "{subject} 必须使用 HTTPS（开发环境仅允许 localhost）"
        ));
    }
    if url.username() != "" || url.password().is_some() {
        return Err(format!("{subject} 不允许在 URL 中包含凭证"));
    }
    Ok(())
}

pub fn validate_content_length(
    length: Option<u64>,
    limit: u64,
    subject: &str,
) -> Result<(), String> {
    if length.unwrap_or(0) > limit {
        return Err(format!(
            "{subject} 响应超过大小限制（{} MB）",
            limit / 1024 / 1024
        ));
    }
    Ok(())
}

pub async fn read_limited_response(
    response: reqwest::Response,
    limit: u64,
    subject: &str,
) -> Result<String, String> {
    validate_content_length(response.content_length(), limit, subject)?;
    use futures_util::StreamExt;
    let mut stream = response.bytes_stream();
    let mut bytes = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| format!("{subject} 响应读取失败：{error}"))?;
        if bytes.len() as u64 + chunk.len() as u64 > limit {
            return Err(format!(
                "{subject} 响应超过大小限制（{} MB）",
                limit / 1024 / 1024
            ));
        }
        bytes.extend_from_slice(&chunk);
    }
    String::from_utf8(bytes).map_err(|_| format!("{subject} 响应不是有效 UTF-8"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_credentials_and_non_https_remote_urls() {
        assert!(validate_https_or_debug_local(
            &url::Url::parse("https://user:secret@example.com/api").unwrap(),
            "服务地址"
        )
        .is_err());
        assert!(validate_https_or_debug_local(
            &url::Url::parse("https://example.com/api").unwrap(),
            "服务地址"
        )
        .is_ok());
    }

    #[test]
    fn rejects_oversized_responses() {
        assert!(validate_content_length(Some(9), 8, "响应").is_err());
        assert!(validate_content_length(None, 8, "响应").is_ok());
    }
}
