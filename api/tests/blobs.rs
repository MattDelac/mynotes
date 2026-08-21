use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::SqlitePool;
use std::net::SocketAddr;
use std::str::FromStr;

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

#[tokio::test]
async fn blob_put_get_roundtrip_is_write_once() {
    let base = spawn_server(test_pool().await, test_config()).await;
    let client = reqwest::Client::new();
    let id = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
    let original = b"iv-ciphertext-tag".to_vec();

    let created = client
        .put(format!("{base}/blobs/{id}"))
        .body(original.clone())
        .send()
        .await
        .unwrap();
    assert_eq!(created.status(), 201);
    let body: serde_json::Value = created.json().await.unwrap();
    assert_eq!(body["id"].as_str().unwrap(), id);

    let fetched = client
        .get(format!("{base}/blobs/{id}"))
        .send()
        .await
        .unwrap();
    assert_eq!(fetched.status(), 200);
    assert_eq!(fetched.bytes().await.unwrap(), original);

    let overwrite = client
        .put(format!("{base}/blobs/{id}"))
        .body(b"different-bytes".to_vec())
        .send()
        .await
        .unwrap();
    assert_eq!(overwrite.status(), 204);

    let fetched = client
        .get(format!("{base}/blobs/{id}"))
        .send()
        .await
        .unwrap();
    assert_eq!(fetched.status(), 200);
    assert_eq!(fetched.bytes().await.unwrap(), original);
}

#[tokio::test]
async fn blob_get_missing_returns_404() {
    let base = spawn_server(test_pool().await, test_config()).await;

    let res = reqwest::get(format!("{base}/blobs/does-not-exist"))
        .await
        .unwrap();
    assert_eq!(res.status(), 404);
}

#[tokio::test]
async fn blob_put_empty_body_returns_400() {
    let base = spawn_server(test_pool().await, test_config()).await;
    let client = reqwest::Client::new();

    let res = client
        .put(format!("{base}/blobs/empty"))
        .body(Vec::new())
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 400);
}

#[tokio::test]
async fn blob_over_max_image_size_returns_413() {
    let mut config = test_config();
    config.max_image_size = 64;
    let base = spawn_server(test_pool().await, config).await;
    let client = reqwest::Client::new();

    let res = client
        .put(format!("{base}/blobs/big"))
        .body(vec![0u8; 100])
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 413);
}

#[tokio::test]
async fn body_limit_admits_bodies_up_to_max_image_size() {
    let mut config = test_config();
    config.max_snapshot_size = 64;
    config.max_image_size = 1024;
    let base = spawn_server(test_pool().await, config).await;
    let client = reqwest::Client::new();

    let res = client
        .put(format!("{base}/blobs/within-image-cap"))
        .body(vec![0u8; 512])
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 201);
}

#[tokio::test]
async fn blob_put_is_rate_limited_on_the_create_bucket() {
    let mut config = test_config();
    config.rate_create_per_min = 1;
    let base = spawn_server(test_pool().await, config).await;
    let client = reqwest::Client::new();

    let first = client
        .put(format!("{base}/blobs/a"))
        .body(b"one".to_vec())
        .send()
        .await
        .unwrap();
    assert_eq!(first.status(), 201);

    let limited = client
        .put(format!("{base}/blobs/b"))
        .body(b"two".to_vec())
        .send()
        .await
        .unwrap();
    assert_eq!(limited.status(), 429);
    assert!(limited.headers().get("retry-after").is_some());
}

#[tokio::test]
async fn blob_get_is_rate_limited_on_the_read_bucket() {
    let mut config = test_config();
    config.rate_read_per_min = 1;
    let base = spawn_server(test_pool().await, config).await;
    let client = reqwest::Client::new();

    client
        .put(format!("{base}/blobs/a"))
        .body(b"one".to_vec())
        .send()
        .await
        .unwrap();

    let first = client.get(format!("{base}/blobs/a")).send().await.unwrap();
    assert_eq!(first.status(), 200);

    let limited = client.get(format!("{base}/blobs/a")).send().await.unwrap();
    assert_eq!(limited.status(), 429);
}

#[tokio::test]
async fn blob_get_touches_last_activity() {
    let pool = test_pool().await;
    let base = spawn_server(pool.clone(), test_config()).await;
    let client = reqwest::Client::new();
    let id = "3f2504e0-4f89-41d3-9a0c-0305e82c3302";

    client
        .put(format!("{base}/blobs/{id}"))
        .body(b"cipher".to_vec())
        .send()
        .await
        .unwrap();

    // The GET touch is throttled and async; give the spawned update time to land.
    let fetched = client
        .get(format!("{base}/blobs/{id}"))
        .send()
        .await
        .unwrap();
    assert_eq!(fetched.status(), 200);
    tokio::time::sleep(std::time::Duration::from_millis(200)).await;

    let (last_activity,) =
        sqlx::query_as::<_, (Option<String>,)>("SELECT last_activity FROM blobs WHERE id = ?")
            .bind(id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(last_activity.is_some());
}

#[tokio::test]
async fn cleanup_removes_stale_blobs_and_spares_recently_active() {
    let pool = test_pool().await;
    sqlx::query(
        "INSERT INTO blobs (id, ciphertext, created_at) \
         VALUES ('stale', x'00', '2000-01-01T00:00:00Z')",
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO blobs (id, ciphertext, created_at, last_activity) \
         VALUES ('viewed', x'00', '2000-01-01T00:00:00Z', \
         strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))",
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query("INSERT INTO blobs (id, ciphertext) VALUES ('fresh', x'00')")
        .execute(&pool)
        .await
        .unwrap();

    let (notes, updates, blobs) = cleanup_expired(&pool, 90).await.unwrap();
    assert_eq!(notes, 0);
    assert_eq!(updates, 0);
    assert_eq!(blobs, 1);

    let remaining = sqlx::query_as::<_, (String,)>("SELECT id FROM blobs ORDER BY id")
        .fetch_all(&pool)
        .await
        .unwrap();
    let ids: Vec<&str> = remaining.iter().map(|(id,)| id.as_str()).collect();
    assert_eq!(ids, vec!["fresh", "viewed"]);
}
