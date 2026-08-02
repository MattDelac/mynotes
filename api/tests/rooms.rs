use futures_util::{SinkExt, StreamExt};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::SqlitePool;
use std::str::FromStr;
use tokio_tungstenite::{connect_async, tungstenite::Message};

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
async fn snapshot_replaces_update_log() {
    let base = spawn_server(test_pool().await).await;
    let (id, token) = create_room(&base).await;
    let client = reqwest::Client::new();

    let ok = client
        .put(format!("{base}/rooms/{id}/snapshot"))
        .header("x-edit-token", &token)
        .body(b"snapshot-v1".to_vec())
        .send()
        .await
        .unwrap();
    assert_eq!(ok.status(), 204);

    let ok = client
        .put(format!("{base}/rooms/{id}/snapshot"))
        .header("x-edit-token", &token)
        .body(b"snapshot-v2".to_vec())
        .send()
        .await
        .unwrap();
    assert_eq!(ok.status(), 204);

    let res = client
        .get(format!("{base}/rooms/{id}/updates"))
        .send()
        .await
        .unwrap();
    let body: serde_json::Value = res.json().await.unwrap();
    let updates = body["updates"].as_array().unwrap();
    assert_eq!(updates.len(), 1);
    assert_eq!(
        updates[0]["blob"].as_str().unwrap(),
        "c25hcHNob3QtdjI" // base64url("snapshot-v2")
    );

    let forbidden = client
        .put(format!("{base}/rooms/{id}/snapshot"))
        .header("x-edit-token", "wrong")
        .body(b"x".to_vec())
        .send()
        .await
        .unwrap();
    assert_eq!(forbidden.status(), 403);

    let missing = client
        .get(format!("{base}/rooms/does-not-exist/updates"))
        .send()
        .await
        .unwrap();
    assert_eq!(missing.status(), 404);
}

#[tokio::test]
async fn websocket_relays_updates_to_room() {
    let base = spawn_server(test_pool().await).await;
    let (id, token) = create_room(&base).await;
    let ws_url = format!("{}/ws/{id}", base.replacen("http", "ws", 1));

    let (mut writer_socket, _) = connect_async(&ws_url).await.unwrap();
    writer_socket
        .send(Message::Text(
            format!("{{\"edit_token\":\"{token}\"}}").into(),
        ))
        .await
        .unwrap();
    let ack = writer_socket.next().await.unwrap().unwrap();
    assert_eq!(ack.into_text().unwrap(), "{\"writable\":true}");

    let (mut reader_socket, _) = connect_async(&ws_url).await.unwrap();

    writer_socket
        .send(Message::Binary(b"encrypted-update-1".to_vec().into()))
        .await
        .unwrap();

    let received = reader_socket.next().await.unwrap().unwrap();
    assert_eq!(received.into_data().as_ref(), b"encrypted-update-1");

    let client = reqwest::Client::new();
    let res = client
        .get(format!("{base}/rooms/{id}/updates"))
        .send()
        .await
        .unwrap();
    let body: serde_json::Value = res.json().await.unwrap();
    let updates = body["updates"].as_array().unwrap();
    assert_eq!(updates.len(), 1);
    assert_eq!(
        updates[0]["blob"].as_str().unwrap(),
        "ZW5jcnlwdGVkLXVwZGF0ZS0x" // base64url("encrypted-update-1")
    );
}

#[tokio::test]
async fn unauthenticated_socket_cannot_write() {
    let base = spawn_server(test_pool().await).await;
    let (id, _token) = create_room(&base).await;
    let ws_url = format!("{}/ws/{id}", base.replacen("http", "ws", 1));

    let (mut socket, _) = connect_async(&ws_url).await.unwrap();
    socket
        .send(Message::Binary(b"should-be-dropped".to_vec().into()))
        .await
        .unwrap();

    tokio::time::sleep(std::time::Duration::from_millis(200)).await;

    let client = reqwest::Client::new();
    let res = client
        .get(format!("{base}/rooms/{id}/updates"))
        .send()
        .await
        .unwrap();
    let body: serde_json::Value = res.json().await.unwrap();
    assert_eq!(body["updates"].as_array().unwrap().len(), 0);

    let (mut socket, _) = connect_async(&ws_url).await.unwrap();
    socket
        .send(Message::Text("{\"edit_token\":\"wrong\"}".into()))
        .await
        .unwrap();
    socket
        .send(Message::Binary(b"also-dropped".to_vec().into()))
        .await
        .unwrap();

    tokio::time::sleep(std::time::Duration::from_millis(200)).await;

    let res = client
        .get(format!("{base}/rooms/{id}/updates"))
        .send()
        .await
        .unwrap();
    let body: serde_json::Value = res.json().await.unwrap();
    assert_eq!(body["updates"].as_array().unwrap().len(), 0);
}
