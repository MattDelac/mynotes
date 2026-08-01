use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::SqlitePool;
use std::str::FromStr;

use mynotes_api::{app, state};

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

async fn spawn_server(pool: SqlitePool) -> String {
    let router = app(state(pool));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });
    format!("http://{addr}")
}

#[tokio::test]
async fn healthz_returns_ok() {
    let base = spawn_server(test_pool().await).await;

    let res = reqwest::get(format!("{base}/healthz")).await.unwrap();
    assert_eq!(res.status(), 200);
    assert_eq!(res.text().await.unwrap(), "ok");
}

#[tokio::test]
async fn note_roundtrip() {
    let base = spawn_server(test_pool().await).await;
    let client = reqwest::Client::new();
    let blob = b"fake-ciphertext-bytes".to_vec();

    let created = client
        .post(format!("{base}/notes"))
        .body(blob.clone())
        .send()
        .await
        .unwrap();
    assert_eq!(created.status(), 201);
    let body: serde_json::Value = created.json().await.unwrap();
    let id = body["id"].as_str().unwrap();
    let edit_token = body["edit_token"].as_str().unwrap();

    let fetched = client
        .get(format!("{base}/notes/{id}"))
        .send()
        .await
        .unwrap();
    assert_eq!(fetched.status(), 200);
    assert_eq!(fetched.bytes().await.unwrap(), blob);

    let forbidden = client
        .put(format!("{base}/notes/{id}"))
        .header("x-edit-token", "wrong-token")
        .body(b"updated".to_vec())
        .send()
        .await
        .unwrap();
    assert_eq!(forbidden.status(), 403);

    let updated_blob = b"updated-ciphertext".to_vec();
    let updated = client
        .put(format!("{base}/notes/{id}"))
        .header("x-edit-token", edit_token)
        .body(updated_blob.clone())
        .send()
        .await
        .unwrap();
    assert_eq!(updated.status(), 204);

    let fetched = client
        .get(format!("{base}/notes/{id}"))
        .send()
        .await
        .unwrap();
    assert_eq!(fetched.bytes().await.unwrap(), updated_blob);

    let missing = client
        .get(format!("{base}/notes/does-not-exist"))
        .send()
        .await
        .unwrap();
    assert_eq!(missing.status(), 404);
}
