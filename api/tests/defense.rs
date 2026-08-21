use futures_util::{SinkExt, StreamExt};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::SqlitePool;
use std::net::SocketAddr;
use std::str::FromStr;
use tokio_tungstenite::{connect_async, tungstenite::Message};

use mynotes_api::{app, cleanup_expired, state_with_config, Config};

async fn test_pool() -> SqlitePool {
    let options = SqliteConnectOptions::from_str("sqlite::memory:")
        .unwrap()
        .create_if_missing(true);
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .unwrap();
    sqlx::migrate!("./migrations").run(&pool).await.unwrap();
    pool
}

fn test_config() -> Config {
    Config {
        max_blob_size: 64 * 1024,
        max_snapshot_size: 2 * 1024 * 1024,
        max_image_size: 5 * 1024 * 1024,
        max_room_bytes: 10 * 1024 * 1024,
        max_room_updates: 5_000,
        ttl_days: 90,
        cleanup_interval_secs: 3_600,
        rate_create_per_min: 10,
        rate_write_per_min: 30,
        rate_read_per_min: 120,
        rate_ws_per_min: 20,
        max_ws_per_ip: 10,
        max_room_subscribers: 32,
        create_token: None,
        trust_proxy_headers: true,
    }
}

async fn spawn_server(pool: SqlitePool, config: Config) -> String {
    let router = app(state_with_config(pool, config));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(
            listener,
            router.into_make_service_with_connect_info::<SocketAddr>(),
        )
        .await
        .unwrap();
    });
    format!("http://{addr}")
}

async fn create_room(base: &str) -> (String, String) {
    let client = reqwest::Client::new();
    let created = client
        .post(format!("{base}/notes"))
        .body(b"initial".to_vec())
        .send()
        .await
        .unwrap();
    assert_eq!(created.status(), 201);
    let body: serde_json::Value = created.json().await.unwrap();
    (
        body["id"].as_str().unwrap().to_string(),
        body["edit_token"].as_str().unwrap().to_string(),
    )
}

#[tokio::test]
async fn create_token_required_when_configured() {
    let mut config = test_config();
    config.create_token = Some("secret".into());
    let base = spawn_server(test_pool().await, config).await;
    let client = reqwest::Client::new();

    let missing = client
        .post(format!("{base}/notes"))
        .body(b"blob".to_vec())
        .send()
        .await
        .unwrap();
    assert_eq!(missing.status(), 403);

    let wrong = client
        .post(format!("{base}/notes"))
        .header("x-create-token", "nope")
        .body(b"blob".to_vec())
        .send()
        .await
        .unwrap();
    assert_eq!(wrong.status(), 403);

    let ok = client
        .post(format!("{base}/notes"))
        .header("x-create-token", "secret")
        .body(b"blob".to_vec())
        .send()
        .await
        .unwrap();
    assert_eq!(ok.status(), 201);
}

#[tokio::test]
async fn create_rate_limited_returns_429_with_retry_after() {
    let mut config = test_config();
    config.rate_create_per_min = 2;
    let base = spawn_server(test_pool().await, config).await;
    let client = reqwest::Client::new();

    for attempt in 0..2 {
        let res = client
            .post(format!("{base}/notes"))
            .body(format!("blob-{attempt}"))
            .send()
            .await
            .unwrap();
        assert_eq!(res.status(), 201);
    }
    let limited = client
        .post(format!("{base}/notes"))
        .body(b"blob-3".to_vec())
        .send()
        .await
        .unwrap();
    assert_eq!(limited.status(), 429);
    assert!(limited.headers().get("retry-after").is_some());
}

#[tokio::test]
async fn rate_limit_keys_on_forwarded_for() {
    let mut config = test_config();
    config.rate_create_per_min = 1;
    let base = spawn_server(test_pool().await, config).await;
    let client = reqwest::Client::new();

    let first = client
        .post(format!("{base}/notes"))
        .header("x-forwarded-for", "1.1.1.1")
        .body(b"blob".to_vec())
        .send()
        .await
        .unwrap();
    assert_eq!(first.status(), 201);

    let other_ip = client
        .post(format!("{base}/notes"))
        .header("x-forwarded-for", "2.2.2.2")
        .body(b"blob".to_vec())
        .send()
        .await
        .unwrap();
    assert_eq!(other_ip.status(), 201);

    let limited = client
        .post(format!("{base}/notes"))
        .header("x-forwarded-for", "1.1.1.1")
        .body(b"blob".to_vec())
        .send()
        .await
        .unwrap();
    assert_eq!(limited.status(), 429);
}

#[tokio::test]
async fn forwarded_for_uses_rightmost_entry() {
    let mut config = test_config();
    config.rate_create_per_min = 1;
    let base = spawn_server(test_pool().await, config).await;
    let client = reqwest::Client::new();

    // Proxies append the real client IP to any client-supplied chain, so the
    // rightmost entry is the trustworthy one.
    let chained = client
        .post(format!("{base}/notes"))
        .header("x-forwarded-for", "9.9.9.9, 1.1.1.1")
        .body(b"blob".to_vec())
        .send()
        .await
        .unwrap();
    assert_eq!(chained.status(), 201);

    let same_rightmost = client
        .post(format!("{base}/notes"))
        .header("x-forwarded-for", "8.8.8.8, 1.1.1.1")
        .body(b"blob".to_vec())
        .send()
        .await
        .unwrap();
    assert_eq!(same_rightmost.status(), 429);
}

#[tokio::test]
async fn spoofed_leftmost_entries_do_not_reset_the_bucket() {
    let mut config = test_config();
    config.rate_create_per_min = 1;
    let base = spawn_server(test_pool().await, config).await;
    let client = reqwest::Client::new();

    let first = client
        .post(format!("{base}/notes"))
        .header("x-forwarded-for", "1.1.1.1")
        .body(b"blob".to_vec())
        .send()
        .await
        .unwrap();
    assert_eq!(first.status(), 201);

    for spoofed in ["2.2.2.2", "3.3.3.3", "4.4.4.4"] {
        let res = client
            .post(format!("{base}/notes"))
            .header("x-forwarded-for", format!("{spoofed}, 1.1.1.1"))
            .body(b"blob".to_vec())
            .send()
            .await
            .unwrap();
        assert_eq!(res.status(), 429);
    }
}

#[tokio::test]
async fn forwarded_for_ignored_when_proxy_headers_not_trusted() {
    let mut config = test_config();
    config.rate_create_per_min = 1;
    config.trust_proxy_headers = false;
    let base = spawn_server(test_pool().await, config).await;
    let client = reqwest::Client::new();

    let first = client
        .post(format!("{base}/notes"))
        .header("x-forwarded-for", "1.1.1.1")
        .body(b"blob".to_vec())
        .send()
        .await
        .unwrap();
    assert_eq!(first.status(), 201);

    // A different XFF value must not yield a fresh bucket: the key is the peer addr.
    let limited = client
        .post(format!("{base}/notes"))
        .header("x-forwarded-for", "2.2.2.2")
        .body(b"blob".to_vec())
        .send()
        .await
        .unwrap();
    assert_eq!(limited.status(), 429);
}

#[tokio::test]
async fn snapshot_over_limit_returns_413() {
    let mut config = test_config();
    config.max_snapshot_size = 64;
    let base = spawn_server(test_pool().await, config).await;
    let (id, edit_token) = create_room(&base).await;
    let client = reqwest::Client::new();

    let res = client
        .put(format!("{base}/rooms/{id}/snapshot"))
        .header("x-edit-token", edit_token)
        .body(vec![0u8; 100])
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 413);
}

#[tokio::test]
async fn room_update_cap_drops_ws_inserts() {
    let mut config = test_config();
    config.max_room_updates = 3;
    let base = spawn_server(test_pool().await, config).await;
    let (room, edit_token) = create_room(&base).await;

    let url = format!("{}/ws/{room}", base.replacen("http", "ws", 1));
    let (mut socket, _) = connect_async(&url).await.unwrap();
    socket
        .send(Message::Text(
            format!("{{\"edit_token\":\"{edit_token}\"}}").into(),
        ))
        .await
        .unwrap();
    let ack = socket.next().await.unwrap().unwrap();
    assert_eq!(ack.into_text().unwrap(), "{\"writable\":true}");

    for i in 0..6 {
        socket
            .send(Message::Binary(format!("update-{i}").into_bytes().into()))
            .await
            .unwrap();
    }
    tokio::time::sleep(std::time::Duration::from_millis(500)).await;

    let res = reqwest::get(format!("{base}/rooms/{room}/updates"))
        .await
        .unwrap();
    let body: serde_json::Value = res.json().await.unwrap();
    assert_eq!(body["updates"].as_array().unwrap().len(), 3);
}

#[tokio::test]
async fn ws_connections_per_ip_are_capped() {
    let mut config = test_config();
    config.max_ws_per_ip = 1;
    let base = spawn_server(test_pool().await, config).await;
    let (room, _) = create_room(&base).await;

    let url = format!("{}/ws/{room}", base.replacen("http", "ws", 1));
    let (first, _) = connect_async(&url).await.unwrap();
    let second = connect_async(&url).await;
    assert!(second.is_err());
    drop(first);
}

#[tokio::test]
async fn cleanup_removes_expired_rooms_and_orphan_updates() {
    let pool = test_pool().await;
    sqlx::query(
        "INSERT INTO notes (id, ciphertext, edit_token, updated_at) \
         VALUES ('old-room', x'00', 'token', '2000-01-01T00:00:00Z')",
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query("INSERT INTO room_updates (room_id, blob) VALUES ('old-room', x'01')")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO room_updates (room_id, blob) VALUES ('orphan', x'02')")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO notes (id, ciphertext, edit_token) VALUES ('fresh', x'00', 'token')")
        .execute(&pool)
        .await
        .unwrap();

    let (notes, updates, blobs) = cleanup_expired(&pool, 90).await.unwrap();
    assert_eq!(notes, 1);
    assert_eq!(updates, 2);
    assert_eq!(blobs, 0);

    let remaining = sqlx::query_as::<_, (String,)>("SELECT id FROM notes")
        .fetch_all(&pool)
        .await
        .unwrap();
    assert_eq!(remaining.len(), 1);
    assert_eq!(remaining[0].0, "fresh");
}

#[tokio::test]
async fn cleanup_keeps_recently_active_rooms() {
    let pool = test_pool().await;
    sqlx::query(
        "INSERT INTO notes (id, ciphertext, edit_token, updated_at, last_activity) \
         VALUES ('active', x'00', 'token', '2000-01-01T00:00:00Z', \
         strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))",
    )
    .execute(&pool)
    .await
    .unwrap();

    let (notes, _, _) = cleanup_expired(&pool, 90).await.unwrap();
    assert_eq!(notes, 0);
}
