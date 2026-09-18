use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
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

async fn fetch_updates(base: &str, id: &str, after: Option<i64>) -> Vec<(i64, String)> {
    let url = match after {
        Some(seq) => format!("{base}/rooms/{id}/updates?after={seq}"),
        None => format!("{base}/rooms/{id}/updates"),
    };
    let res = reqwest::Client::new().get(url).send().await.unwrap();
    assert_eq!(res.status(), 200);
    let body: serde_json::Value = res.json().await.unwrap();
    body["updates"]
        .as_array()
        .unwrap()
        .iter()
        .map(|row| {
            (
                row["seq"].as_i64().unwrap(),
                row["blob"].as_str().unwrap().to_string(),
            )
        })
        .collect()
}

async fn wait_for_updates(base: &str, id: &str, min_rows: usize) -> Vec<(i64, String)> {
    for _ in 0..50 {
        let rows = fetch_updates(base, id, None).await;
        if rows.len() >= min_rows {
            return rows;
        }
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    }
    panic!("updates did not arrive");
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

#[tokio::test]
async fn websocket_answers_ping_with_pong() {
    let base = spawn_server(test_pool().await).await;
    let (id, _token) = create_room(&base).await;
    let ws_url = format!("{}/ws/{id}", base.replacen("http", "ws", 1));

    let (mut socket, _) = connect_async(&ws_url).await.unwrap();
    socket
        .send(Message::Ping(b"liveness".to_vec().into()))
        .await
        .unwrap();

    let reply = tokio::time::timeout(std::time::Duration::from_secs(2), socket.next())
        .await
        .expect("the relay must answer websocket pings")
        .unwrap()
        .unwrap();
    assert_eq!(reply, Message::Pong(b"liveness".to_vec().into()));
}

#[tokio::test]
async fn snapshot_compaction_is_fetchable_after_the_old_cursor_and_keeps_seq_monotonic() {
    let base = spawn_server(test_pool().await).await;
    let (id, token) = create_room(&base).await;
    let ws_url = format!("{}/ws/{id}", base.replacen("http", "ws", 1));

    let (mut writer, _) = connect_async(&ws_url).await.unwrap();
    writer
        .send(Message::Text(
            format!("{{\"edit_token\":\"{token}\"}}").into(),
        ))
        .await
        .unwrap();
    let ack = writer.next().await.unwrap().unwrap();
    assert_eq!(ack.into_text().unwrap(), "{\"writable\":true}");

    for index in 0..3 {
        writer
            .send(Message::Binary(format!("row-{index}").into_bytes().into()))
            .await
            .unwrap();
    }
    let before = wait_for_updates(&base, &id, 3).await;
    let last_seq = before.last().unwrap().0;
    assert_eq!(last_seq, 3);

    let ok = reqwest::Client::new()
        .put(format!("{base}/rooms/{id}/snapshot"))
        .header("x-edit-token", &token)
        .body(b"snapshot-v1".to_vec())
        .send()
        .await
        .unwrap();
    assert_eq!(ok.status(), 204);

    let after = fetch_updates(&base, &id, Some(last_seq)).await;
    assert_eq!(after.len(), 1);
    assert_eq!(after[0].1, URL_SAFE_NO_PAD.encode(b"snapshot-v1"));
    assert!(
        after[0].0 > last_seq,
        "seq must stay monotonic across compaction so a stale cursor still sees the snapshot"
    );
}

#[tokio::test]
async fn snapshot_compaction_is_not_broadcast_to_connected_clients() {
    let base = spawn_server(test_pool().await).await;
    let (id, token) = create_room(&base).await;
    let ws_url = format!("{}/ws/{id}", base.replacen("http", "ws", 1));

    let (mut reader, _) = connect_async(&ws_url).await.unwrap();
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;

    let ok = reqwest::Client::new()
        .put(format!("{base}/rooms/{id}/snapshot"))
        .header("x-edit-token", &token)
        .body(b"snapshot-v1".to_vec())
        .send()
        .await
        .unwrap();
    assert_eq!(ok.status(), 204);

    let silent = tokio::time::timeout(std::time::Duration::from_millis(300), reader.next()).await;
    assert!(silent.is_err(), "compaction must not be broadcast");

    let (mut writer, _) = connect_async(&ws_url).await.unwrap();
    writer
        .send(Message::Text(
            format!("{{\"edit_token\":\"{token}\"}}").into(),
        ))
        .await
        .unwrap();
    let ack = writer.next().await.unwrap().unwrap();
    assert_eq!(ack.into_text().unwrap(), "{\"writable\":true}");
    writer
        .send(Message::Binary(b"live-after-snapshot".to_vec().into()))
        .await
        .unwrap();

    let received = tokio::time::timeout(std::time::Duration::from_secs(2), reader.next())
        .await
        .expect("a live frame after compaction must still be delivered")
        .unwrap()
        .unwrap();
    assert_eq!(received.into_data().as_ref(), b"live-after-snapshot");
}
