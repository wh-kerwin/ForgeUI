use crate::repositories::{projects, secrets};
use crate::services::url_security::{
    read_limited_response, validate_content_length, validate_https_or_debug_local,
};
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, time::Duration};
use tokio_util::sync::CancellationToken;

#[derive(Debug, Deserialize)]
pub struct ApiRequest {
    pub url: String,
    pub method: String,
    pub headers: Option<HashMap<String, String>>,
    pub body: Option<serde_json::Value>,
    pub project_id: String,
    pub api_document_id: String,
    pub operation_key: Option<String>,
    /// Optional correlation ID; when supplied it must be nonblank and unique
    /// among active requests. Each write must use its own ID, never a query ID.
    #[serde(default)]
    pub request_id: Option<String>,
}

/// In-flight cancellation tokens keyed by client request_id.
/// Cleared automatically when the associated request finishes.
static ACTIVE_REQUESTS: std::sync::LazyLock<
    std::sync::Mutex<HashMap<String, std::sync::Arc<CancellationToken>>>,
> = std::sync::LazyLock::new(|| std::sync::Mutex::new(HashMap::new()));

#[derive(Debug, Serialize)]
pub struct ApiResponse {
    pub status: u16,
    pub body: serde_json::Value,
}

#[derive(Deserialize)]
struct StoredBusinessConnection {
    #[serde(default)]
    r#type: String,
    #[serde(rename = "secretRef")]
    secret_ref: Option<String>,
    #[serde(rename = "apiKeyName")]
    api_key_name: Option<String>,
    #[serde(rename = "caPem")]
    ca_pem: Option<String>,
    #[serde(rename = "apiBaseUrl")]
    api_base_url: Option<String>,
    #[serde(rename = "authorizedOperations", default)]
    authorized_operations: Vec<String>,
}

struct AuthorizedDocument {
    base_url: String,
    auth: StoredBusinessConnection,
}

fn authorize_document(
    project_id: &str,
    api_document_id: &str,
    method: &str,
    target: &url::Url,
    operation_key: Option<&str>,
) -> Result<AuthorizedDocument, String> {
    let operation_key = operation_key.ok_or("业务请求缺少 operation 授权标识")?;
    let document = projects::resolve_api_document(project_id, api_document_id)?;
    let connection: StoredBusinessConnection = serde_json::from_value(document.payload.auth)
        .map_err(|_| "API 文档的业务连接配置无效".to_string())?;
    let base_url = connection
        .api_base_url
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .map(ToOwned::to_owned)
        .or_else(|| {
            document
                .payload
                .spec
                .get("api_base_url")
                .and_then(|value| value.as_str())
                .map(ToOwned::to_owned)
        })
        .ok_or("API 文档缺少已授权服务地址")?;
    if !connection
        .authorized_operations
        .iter()
        .any(|item| item == operation_key)
    {
        return Err("该 operation 尚未获得用户授权".into());
    }
    let expected = operation_key
        .split(" · ")
        .next()
        .ok_or("operation 授权标识无效")?;
    let (expected_method, expected_path) =
        expected.split_once(' ').ok_or("operation 授权标识无效")?;
    validate_target(target, Some(&base_url))?;
    let base = url::Url::parse(&base_url).map_err(|_| "已授权业务服务地址无效".to_string())?;
    let base_path = base.path().trim_end_matches('/');
    let target_path = if base_path.is_empty() || base_path == "/" {
        target.path()
    } else {
        target
            .path()
            .strip_prefix(base_path)
            .unwrap_or(target.path())
    };
    let path_matches = matches_operation_path(expected_path, target_path);
    if expected_method != method || !path_matches {
        return Err("请求与已授权 operation 不匹配".into());
    }
    Ok(AuthorizedDocument {
        base_url,
        auth: connection,
    })
}

fn matches_operation_path(pattern: &str, path: &str) -> bool {
    let expected_segments: Vec<_> = pattern.split('/').collect();
    let actual_segments: Vec<_> = path.split('/').collect();
    expected_segments.len() == actual_segments.len()
        && expected_segments
            .iter()
            .zip(actual_segments)
            .all(|(expected, actual)| {
                (expected.starts_with('{') && expected.ends_with('}')) || *expected == actual
            })
}

fn is_safe_forwarded_header(name: &str) -> bool {
    matches!(
        name.to_ascii_lowercase().as_str(),
        "content-type" | "accept"
    )
}

fn validate_credential_header(name: &str) -> Result<(), String> {
    if name.trim().is_empty()
        || name.len() > 128
        || name.contains(['\r', '\n'])
        || matches!(
            name.to_ascii_lowercase().as_str(),
            "authorization" | "cookie" | "host" | "content-length"
        )
    {
        return Err("业务 API 凭证 Header 名称不允许使用该值".into());
    }
    Ok(())
}

pub fn validate_target(target: &url::Url, allowed_base_url: Option<&str>) -> Result<(), String> {
    let base_url = allowed_base_url.ok_or("业务请求缺少已授权 OpenAPI 服务地址")?;
    let base = url::Url::parse(base_url).map_err(|_| "已授权业务服务地址无效".to_string())?;
    let same_origin = target.scheme() == base.scheme()
        && target.host_str() == base.host_str()
        && target.port_or_known_default() == base.port_or_known_default();
    let base_path = base.path().trim_end_matches('/');
    if !same_origin
        || (!base_path.is_empty() && base_path != "/" && !target.path().starts_with(base_path))
    {
        return Err("请求目标不属于已授权 OpenAPI 服务".into());
    }
    Ok(())
}

fn validate_ca_pem(ca_pem: &str) -> Result<reqwest::Certificate, String> {
    if ca_pem.len() > 1024 * 1024 || ca_pem.contains("PRIVATE KEY") {
        return Err("企业 CA 配置只允许证书，不允许私钥或超大内容".into());
    }
    reqwest::Certificate::from_pem(ca_pem.as_bytes()).map_err(|_| "企业 CA PEM 无效".into())
}

pub async fn execute(request: ApiRequest) -> Result<ApiResponse, String> {
    let guard = RequestGuard::register(request.request_id.as_deref())?;
    let parsed = url::Url::parse(&request.url).map_err(|_| "业务 API 地址无效".to_string())?;
    let method = request.method.to_uppercase();
    let authorized = authorize_document(
        &request.project_id,
        &request.api_document_id,
        &method,
        &parsed,
        request.operation_key.as_deref(),
    )?;
    validate_target(&parsed, Some(&authorized.base_url))?;
    validate_https_or_debug_local(&parsed, "业务 API")?;
    if !matches!(method.as_str(), "GET" | "POST" | "PUT" | "PATCH" | "DELETE") {
        return Err("不支持的 HTTP 方法".into());
    }
    let mut client_builder = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::none());
    if let Some(ca_pem) = authorized.auth.ca_pem.filter(|pem| !pem.trim().is_empty()) {
        client_builder = client_builder.add_root_certificate(validate_ca_pem(&ca_pem)?);
    }
    let client = client_builder.build().map_err(|e| e.to_string())?;
    let mut builder = match method.as_str() {
        "GET" => client.get(parsed),
        "POST" => client.post(parsed),
        "PUT" => client.put(parsed),
        "PATCH" => client.patch(parsed),
        "DELETE" => client.delete(parsed),
        _ => unreachable!(),
    };
    if let Some(headers) = request.headers {
        for (key, value) in headers {
            if is_safe_forwarded_header(&key) {
                builder = builder.header(key, value);
            }
        }
    }
    if let Some(secret_ref) = authorized
        .auth
        .secret_ref
        .filter(|_| authorized.auth.r#type != "none")
    {
        let secret = secrets::load(&secret_ref).map_err(|_| "无法读取业务 API 凭证".to_string())?;
        builder = match authorized.auth.r#type.as_str() {
            "bearer" => builder.bearer_auth(secret),
            "apiKey" => {
                let header_name = authorized
                    .auth
                    .api_key_name
                    .unwrap_or_else(|| "x-api-key".into());
                validate_credential_header(&header_name)?;
                builder.header(header_name, secret)
            }
            _ => builder,
        };
    }
    if let Some(body) = request.body {
        builder = builder.json(&body);
    }
    execute_registered(builder, guard.as_ref(), method != "GET", REQUEST_TIMEOUT).await
}

const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

struct RequestGuard {
    id: String,
    token: std::sync::Arc<CancellationToken>,
}

impl RequestGuard {
    fn register(id: Option<&str>) -> Result<Option<Self>, String> {
        let Some(id) = id else { return Ok(None) };
        if id.trim().is_empty() {
            return Err("request_id 不能为空".into());
        }
        let mut active = ACTIVE_REQUESTS
            .lock()
            .map_err(|_| "内部错误：请求取消表已锁定")?;
        if active.contains_key(id) {
            return Err("重复 request_id：请求仍在执行".into());
        }
        let token = std::sync::Arc::new(CancellationToken::new());
        active.insert(id.to_owned(), token.clone());
        Ok(Some(Self {
            id: id.to_owned(),
            token,
        }))
    }
}

impl Drop for RequestGuard {
    fn drop(&mut self) {
        let mut active = ACTIVE_REQUESTS
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        // A cancelled request may have yielded its ID to a newer request.
        if active
            .get(&self.id)
            .is_some_and(|token| std::sync::Arc::ptr_eq(token, &self.token))
        {
            active.remove(&self.id);
        }
    }
}

fn interrupted(is_write: bool, reason: &str) -> String {
    if is_write {
        format!(
            "MutationOutcomeUnknown: {reason}；写入结果未确认，请先核实服务端状态，禁止自动重试"
        )
    } else {
        reason.to_owned()
    }
}

#[cfg(test)]
async fn execute_http(
    builder: reqwest::RequestBuilder,
    request_id: Option<&str>,
    is_write: bool,
) -> Result<ApiResponse, String> {
    let guard = RequestGuard::register(request_id)?;
    execute_registered(builder, guard.as_ref(), is_write, REQUEST_TIMEOUT).await
}

async fn execute_registered(
    builder: reqwest::RequestBuilder,
    guard: Option<&RequestGuard>,
    is_write: bool,
    timeout: Duration,
) -> Result<ApiResponse, String> {
    let token = guard
        .map(|guard| guard.token.as_ref())
        .cloned()
        .unwrap_or_default();
    let operation = async {
        let response = builder
            .send()
            .await
            .map_err(|_| interrupted(is_write, "业务 API 请求失败"))?;
        let status = response.status().as_u16();
        validate_content_length(response.content_length(), 10 * 1024 * 1024, "业务 API")
            .map_err(|error| interrupted(is_write, &error))?;
        let text = read_limited_response(response, 10 * 1024 * 1024, "业务 API")
            .await
            .map_err(|error| interrupted(is_write, &error))?;
        let body =
            serde_json::from_str(&text).unwrap_or_else(|_| serde_json::json!({"text": text}));
        if (300..400).contains(&status) {
            return Err("业务 API 返回重定向，已为安全起见拒绝跟随".into());
        }
        if status >= 400 {
            return Err(format!("业务 API 返回 HTTP {status}"));
        }
        Ok(ApiResponse { status, body })
    };
    tokio::select! {
        biased;
        _ = token.cancelled() => Err(interrupted(is_write, "Cancelled")),
        _ = tokio::time::sleep(timeout) => Err(interrupted(is_write, "业务 API 请求超时")),
        result = operation => result,
    }
}

/// Cancels an in-flight business API query by its client-supplied request_id.
/// Returns the number of tokens cancelled (0 means not found or already finished).
pub fn cancel_query(request_id: &str) -> u32 {
    let removed = ACTIVE_REQUESTS
        .lock()
        .map(|mut map| {
            if let Some(token) = map.remove(request_id) {
                token.cancel();
                true
            } else {
                false
            }
        })
        .unwrap_or(false);
    if removed {
        // Query cancellation is silent; write interruption is explicitly unknown.
        // No request is retried here.
        1
    } else {
        0
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cancel_signals_token_and_repeated_cancel_is_noop() {
        let id = "a1-cancel-signals-token";
        let token = std::sync::Arc::new(CancellationToken::new());
        ACTIVE_REQUESTS
            .lock()
            .unwrap()
            .insert(id.into(), token.clone());
        assert_eq!(cancel_query(id), 1);
        assert!(
            token.is_cancelled(),
            "removing the token must also signal cancellation"
        );
        assert_eq!(cancel_query(id), 0);
    }

    // Real loopback HTTP, with gates instead of sleep-based phase guesses. The
    // server never touches repositories, credentials, or external services.
    struct HttpFixture {
        url: String,
        reached: tokio::sync::oneshot::Receiver<()>,
        release: Option<std::sync::mpsc::Sender<()>>,
        thread: Option<std::thread::JoinHandle<()>>,
    }

    impl HttpFixture {
        fn new(before_gate: &'static [u8], after_gate: Vec<u8>) -> Self {
            use std::io::{Read, Write};
            let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            let url = format!("http://{}/items", listener.local_addr().unwrap());
            let (reached_tx, reached) = tokio::sync::oneshot::channel();
            let (release_tx, release_rx) = std::sync::mpsc::channel();
            listener.set_nonblocking(true).unwrap();
            let thread = std::thread::spawn(move || {
                let deadline = std::time::Instant::now() + Duration::from_secs(5);
                let mut stream = loop {
                    match listener.accept() {
                        Ok((stream, _)) => break stream,
                        Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                            if std::time::Instant::now() >= deadline {
                                return;
                            }
                            std::thread::sleep(Duration::from_millis(2));
                        }
                        Err(error) => panic!("fixture accept: {error}"),
                    }
                };
                stream.set_nonblocking(false).unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(10)))
                    .unwrap();
                let mut request = Vec::new();
                let mut byte = [0];
                while !request.ends_with(b"\r\n\r\n") {
                    if stream.read(&mut byte).unwrap_or(0) == 0 {
                        return;
                    }
                    request.push(byte[0]);
                }
                stream.write_all(before_gate).unwrap();
                stream.flush().unwrap();
                let _ = reached_tx.send(());
                let _ = release_rx.recv_timeout(Duration::from_secs(5));
                let _ = stream.write_all(&after_gate);
            });
            Self {
                url,
                reached,
                release: Some(release_tx),
                thread: Some(thread),
            }
        }

        async fn wait(&mut self) {
            tokio::time::timeout(Duration::from_secs(10), &mut self.reached)
                .await
                .expect("fixture must receive a real request")
                .unwrap();
        }

        fn release(&mut self) {
            self.release.take();
        }
    }

    impl Drop for HttpFixture {
        fn drop(&mut self) {
            self.release();
            if let Some(thread) = self.thread.take() {
                thread.join().unwrap();
            }
        }
    }

    fn http_request(url: &str, method: &str) -> reqwest::RequestBuilder {
        reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .unwrap()
            .request(method.parse().unwrap(), url)
    }

    async fn finishes(
        task: tokio::task::JoinHandle<Result<ApiResponse, String>>,
    ) -> Result<ApiResponse, String> {
        tokio::time::timeout(Duration::from_millis(800), task)
            .await
            .expect("request must finish without releasing the server gate")
            .unwrap()
    }

    fn assert_removed(id: &str) {
        assert!(
            !ACTIVE_REQUESTS.lock().unwrap().contains_key(id),
            "registry leaked {id}"
        );
        assert_eq!(cancel_query(id), 0);
    }

    #[tokio::test]
    async fn cancels_before_headers() {
        let id = "a1-before-headers";
        let mut server = HttpFixture::new(
            b"",
            b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\n{}".to_vec(),
        );
        let builder = http_request(&server.url, "GET");
        let task = tokio::spawn(async move { execute_http(builder, Some(id), false).await });
        server.wait().await;
        assert_eq!(cancel_query(id), 1);
        assert_eq!(finishes(task).await.unwrap_err(), "Cancelled");
        assert_removed(id);
    }

    #[tokio::test]
    async fn cancels_while_reading_body() {
        let id = "a1-during-body";
        let mut server = HttpFixture::new(
            b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\n{",
            b"}".to_vec(),
        );
        let builder = http_request(&server.url, "GET");
        let task = tokio::spawn(async move { execute_http(builder, Some(id), false).await });
        server.wait().await;
        // Yield enough for the client to consume headers, but keep body gated.
        tokio::time::sleep(Duration::from_millis(30)).await;
        assert_eq!(cancel_query(id), 1);
        assert_eq!(finishes(task).await.unwrap_err(), "Cancelled");
        assert_removed(id);
    }

    #[tokio::test]
    async fn rejects_empty_ids_before_sending() {
        for id in ["", " ", "\n\t"] {
            let error = execute_http(http_request("http://127.0.0.1:1/", "GET"), Some(id), false)
                .await
                .unwrap_err();
            assert!(error.contains("request_id"), "{error}");
            assert_removed(id);
        }
    }

    #[tokio::test]
    async fn duplicate_id_does_not_replace_original_token() {
        let id = "a1-duplicate";
        let mut server = HttpFixture::new(b"", Vec::new());
        let builder = http_request(&server.url, "GET");
        let task = tokio::spawn(async move { execute_http(builder, Some(id), false).await });
        server.wait().await;
        let error = execute_http(http_request("http://127.0.0.1:1/", "GET"), Some(id), false)
            .await
            .unwrap_err();
        assert!(error.contains("重复"), "{error}");
        assert_eq!(cancel_query(id), 1);
        assert_eq!(finishes(task).await.unwrap_err(), "Cancelled");
        assert_removed(id);
    }

    #[tokio::test]
    async fn send_error_removes_request() {
        let id = "a1-send-error";
        let mut server = HttpFixture::new(b"", Vec::new());
        server.release();
        assert!(
            execute_http(http_request(&server.url, "GET"), Some(id), false)
                .await
                .is_err()
        );
        assert_removed(id);
    }

    #[tokio::test]
    async fn interrupted_write_is_unknown_not_silent_query_cancellation() {
        let id = "a1-write";
        let mut server = HttpFixture::new(b"", Vec::new());
        let builder = http_request(&server.url, "POST");
        let task = tokio::spawn(async move { execute_http(builder, Some(id), true).await });
        server.wait().await;
        assert_eq!(cancel_query(id), 1);
        let error = finishes(task).await.unwrap_err();
        assert!(error.starts_with("MutationOutcomeUnknown:"), "{error}");
        assert_removed(id);
    }

    #[tokio::test]
    async fn removes_request_on_every_exit() {
        let cases: Vec<(&str, Vec<u8>, &str)> = vec![
            (
                "success",
                b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\n{}".to_vec(),
                "",
            ),
            (
                "http",
                b"HTTP/1.1 500 Error\r\nContent-Length: 0\r\n\r\n".to_vec(),
                "HTTP 500",
            ),
            (
                "redirect",
                b"HTTP/1.1 302 Found\r\nContent-Length: 0\r\nLocation: http://127.0.0.1:1/\r\n\r\n"
                    .to_vec(),
                "重定向",
            ),
            (
                "length",
                b"HTTP/1.1 200 OK\r\nContent-Length: 10485761\r\n\r\n".to_vec(),
                "大小限制",
            ),
            (
                "read",
                b"HTTP/1.1 200 OK\r\nContent-Length: 10\r\n\r\n{".to_vec(),
                "读取失败",
            ),
            (
                "utf8",
                b"HTTP/1.1 200 OK\r\nContent-Length: 1\r\n\r\n\xff".to_vec(),
                "UTF-8",
            ),
            (
                "stream-limit",
                {
                    let mut response = b"HTTP/1.1 200 OK\r\nConnection: close\r\n\r\n".to_vec();
                    response.extend(vec![b'x'; 10 * 1024 * 1024 + 1]);
                    response
                },
                "大小限制",
            ),
        ];
        for (name, response, expected_error) in cases {
            let id = format!("a1-exit-{name}");
            let mut server = HttpFixture::new(b"", response);
            let builder = http_request(&server.url, "GET");
            server.release();
            let result = execute_http(builder, Some(&id), false).await;
            if expected_error.is_empty() {
                assert_eq!(result.unwrap().status, 200);
            } else {
                let error = result.unwrap_err();
                assert!(error.contains(expected_error), "{name}: {error}");
            }
            assert_removed(&id);
        }
    }

    #[tokio::test]
    async fn cancels_registered_request_before_send() {
        let id = "a1-before-send";
        let guard = RequestGuard::register(Some(id)).unwrap();
        assert_eq!(cancel_query(id), 1);
        let result = execute_registered(
            http_request("http://127.0.0.1:1/", "GET"),
            guard.as_ref(),
            false,
            REQUEST_TIMEOUT,
        )
        .await;
        assert_eq!(result.unwrap_err(), "Cancelled");
        drop(guard);
        assert_removed(id);
    }

    #[tokio::test]
    async fn timeout_covers_headers_and_body_and_cleans_registry() {
        for (id, prefix) in [
            ("a1-timeout-headers", &b""[..]),
            (
                "a1-timeout-body",
                &b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\n{"[..],
            ),
        ] {
            let mut server = HttpFixture::new(prefix, b"}".to_vec());
            let builder = http_request(&server.url, "GET");
            let task = tokio::spawn(async move {
                let guard = RequestGuard::register(Some(id)).unwrap();
                execute_registered(builder, guard.as_ref(), false, Duration::from_millis(400)).await
            });
            server.wait().await;
            assert_eq!(finishes(task).await.unwrap_err(), "业务 API 请求超时");
            assert_removed(id);
        }
    }

    #[tokio::test]
    async fn write_without_request_id_timeout_is_unknown() {
        for prefix in [
            &b""[..],
            &b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\n{"[..],
        ] {
            let mut server = HttpFixture::new(prefix, b"}".to_vec());
            let builder = http_request(&server.url, "POST");
            let task = tokio::spawn(async move {
                let guard = RequestGuard::register(None).unwrap();
                assert!(guard.is_none());
                execute_registered(builder, guard.as_ref(), true, Duration::from_millis(400)).await
            });
            server.wait().await;
            let error = finishes(task).await.unwrap_err();
            assert!(error.starts_with("MutationOutcomeUnknown:"), "{error}");
            assert!(error.contains("请求超时"), "{error}");
            assert!(error.contains("禁止自动重试"), "{error}");
        }
    }

    #[tokio::test]
    async fn write_without_request_id_disconnect_is_unknown() {
        for prefix in [
            &b""[..],
            &b"HTTP/1.1 200 OK\r\nContent-Length: 10\r\n\r\n{"[..],
        ] {
            let mut server = HttpFixture::new(prefix, Vec::new());
            let builder = http_request(&server.url, "POST");
            let task = tokio::spawn(async move {
                let guard = RequestGuard::register(None).unwrap();
                assert!(guard.is_none());
                execute_registered(builder, guard.as_ref(), true, Duration::from_millis(400)).await
            });
            server.wait().await;
            server.release();
            let error = finishes(task).await.unwrap_err();
            assert!(error.starts_with("MutationOutcomeUnknown:"), "{error}");
            assert!(
                error.contains("请求失败") || error.contains("读取失败"),
                "disconnect must not be mistaken for timeout: {error}"
            );
            assert!(error.contains("禁止自动重试"), "{error}");
        }
    }

    #[tokio::test]
    async fn concurrent_ids_cancel_independently() {
        let mut first = HttpFixture::new(b"", Vec::new());
        let mut second = HttpFixture::new(
            b"",
            b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\n{}".to_vec(),
        );
        let a = http_request(&first.url, "GET");
        let b = http_request(&second.url, "GET");
        let task_a =
            tokio::spawn(async move { execute_http(a, Some("a1-isolated-a"), false).await });
        let task_b =
            tokio::spawn(async move { execute_http(b, Some("a1-isolated-b"), false).await });
        first.wait().await;
        second.wait().await;
        assert_eq!(cancel_query("a1-isolated-a"), 1);
        assert_eq!(finishes(task_a).await.unwrap_err(), "Cancelled");
        assert!(!task_b.is_finished());
        second.release();
        assert_eq!(finishes(task_b).await.unwrap().status, 200);
        assert_removed("a1-isolated-a");
        assert_removed("a1-isolated-b");
    }

    #[tokio::test]
    async fn dropping_old_request_preserves_reused_id() {
        let id = "a1-reuse";
        let old = RequestGuard::register(Some(id)).unwrap();
        assert_eq!(cancel_query(id), 1);
        let new = RequestGuard::register(Some(id)).unwrap();
        drop(old);
        assert_eq!(cancel_query(id), 1);
        assert!(new.as_ref().unwrap().token.is_cancelled());
        drop(new);
        assert_removed(id);
    }

    #[tokio::test]
    async fn dropping_execution_future_cleans_registry() {
        let id = "a1-abort";
        let mut server = HttpFixture::new(b"", Vec::new());
        let builder = http_request(&server.url, "GET");
        let task = tokio::spawn(async move { execute_http(builder, Some(id), false).await });
        server.wait().await;
        task.abort();
        assert!(task.await.unwrap_err().is_cancelled());
        assert_removed(id);
    }

    #[tokio::test]
    async fn validation_failure_cleans_registration_without_database_access() {
        let id = "a1-invalid-url";
        let error = execute(ApiRequest {
            url: "invalid url".into(),
            method: "GET".into(),
            headers: None,
            body: None,
            project_id: String::new(),
            api_document_id: String::new(),
            operation_key: None,
            request_id: Some(id.into()),
        })
        .await
        .unwrap_err();
        assert_eq!(error, "业务 API 地址无效");
        assert_removed(id);
    }

    #[test]
    fn target_must_match_authorized_origin_and_path() {
        let valid = url::Url::parse("https://api.example.com/v1/devices").unwrap();
        assert!(validate_target(&valid, Some("https://api.example.com/v1")).is_ok());
        let foreign = url::Url::parse("https://evil.example.com/v1/devices").unwrap();
        assert!(validate_target(&foreign, Some("https://api.example.com/v1")).is_err());
        let escaped = url::Url::parse("https://api.example.com/admin").unwrap();
        assert!(validate_target(&escaped, Some("https://api.example.com/v1")).is_err());
    }

    #[test]
    fn operation_path_allows_only_declared_path_parameters() {
        assert!(matches_operation_path("/devices/{deviceId}", "/devices/42"));
        assert!(!matches_operation_path(
            "/devices/{deviceId}",
            "/devices/42/logs"
        ));
        assert!(!matches_operation_path("/devices/{deviceId}", "/users/42"));
    }

    #[test]
    fn never_forwards_client_supplied_credential_headers() {
        assert!(is_safe_forwarded_header("content-type"));
        assert!(is_safe_forwarded_header("Accept"));
        assert!(!is_safe_forwarded_header("Authorization"));
        assert!(!is_safe_forwarded_header("X-API-Key"));
        assert!(validate_credential_header("X-API-Key").is_ok());
        assert!(validate_credential_header("Authorization").is_err());
    }

    #[test]
    fn rejects_private_keys_in_enterprise_ca_input() {
        assert!(
            validate_ca_pem("-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----")
                .is_err()
        );
        assert!(validate_ca_pem(&"A".repeat(1024 * 1024 + 1)).is_err());
    }
}
