use std::net::{Ipv4Addr, Ipv6Addr};

/// Plain HTTP is acceptable only for loopback and private-network hosts, which
/// is the normal topology for on-premise B2B deployments. Public hosts still
/// require TLS so credentials never travel over the open Internet.
fn is_local_or_private_host(url: &url::Url) -> bool {
    let Some(host) = url.host() else {
        return false;
    };
    match host {
        url::Host::Domain(domain) => {
            let normalized = domain.to_ascii_lowercase();
            let trimmed = normalized.strip_suffix('.').unwrap_or(&normalized);
            trimmed == "localhost" || trimmed.ends_with(".localhost") || trimmed.ends_with(".local")
        }
        url::Host::Ipv4(ip) => is_private_ipv4(ip),
        url::Host::Ipv6(ip) => is_private_ipv6(ip),
    }
}

fn is_private_ipv4(ip: Ipv4Addr) -> bool {
    let [a, b, ..] = ip.octets();
    ip.is_loopback()
        || a == 10
        || (a == 172 && (16..=31).contains(&b))
        || (a == 192 && b == 168)
        || (a == 169 && b == 254)
}

fn is_private_ipv6(ip: Ipv6Addr) -> bool {
    if ip.is_loopback() {
        return true;
    }
    let octets = ip.octets();
    if octets[..10].iter().all(|byte| *byte == 0) && octets[10] == 0xff && octets[11] == 0xff {
        return is_private_ipv4(Ipv4Addr::new(
            octets[12], octets[13], octets[14], octets[15],
        ));
    }
    let first = ip.segments()[0];
    (first & 0xfe00 == 0xfc00) || (first & 0xffc0 == 0xfe80)
}

pub fn validate_url_transport(url: &url::Url, subject: &str) -> Result<(), String> {
    if url.scheme() != "https" && !is_local_or_private_host(url) {
        return Err(format!(
            "{subject} 必须使用 HTTPS（仅本地或局域网地址可使用 HTTP）"
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
        assert!(validate_url_transport(
            &url::Url::parse("https://user:secret@example.com/api").unwrap(),
            "服务地址"
        )
        .is_err());
        assert!(validate_url_transport(
            &url::Url::parse("https://example.com/api").unwrap(),
            "服务地址"
        )
        .is_ok());
        assert!(validate_url_transport(
            &url::Url::parse("http://example.com/api").unwrap(),
            "服务地址"
        )
        .is_err());
    }

    #[test]
    fn allows_plain_http_for_loopback_and_private_networks() {
        for candidate in [
            "http://localhost:3000/api-docs",
            "http://127.0.0.1:3000",
            "http://[::1]:3000",
            "http://192.168.1.20:8080/api",
            "http://10.20.30.40/api",
            "http://172.16.5.4/api",
            "http://172.31.255.254/api",
            "http://169.254.1.1/api",
            "http://printer.local/api",
            "http://[fc00::1]/api",
            "http://[fe80::1]/api",
            "https://example.com/api",
        ] {
            let parsed = url::Url::parse(candidate).unwrap();
            assert!(
                validate_url_transport(&parsed, "业务 API").is_ok(),
                "{candidate} should be allowed"
            );
        }
    }

    #[test]
    fn rejects_plain_http_for_public_hosts_and_lookalike_domains() {
        for candidate in [
            "http://example.com/api",
            "http://8.8.8.8/api",
            "http://172.32.0.1/api",
            "http://192.169.0.1/api",
            "http://11.0.0.1/api",
            "http://localhost.evil.com/api",
            "http://foo.local.evil.com/api",
            "http://user:secret@192.168.1.20/api",
        ] {
            let parsed = url::Url::parse(candidate).unwrap();
            assert!(
                validate_url_transport(&parsed, "业务 API").is_err(),
                "{candidate} should be rejected"
            );
        }
    }

    #[test]
    fn rejects_oversized_responses() {
        assert!(validate_content_length(Some(9), 8, "响应").is_err());
        assert!(validate_content_length(None, 8, "响应").is_ok());
    }
}
