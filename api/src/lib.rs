use axum::{
    body::Bytes,
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Path, Query, State,
    },
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use serde::Deserialize;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::SqlitePool;
use std::collections::HashMap;
use std::str::FromStr;
use std::sync::{Arc, Mutex};
use tokio::sync::broadcast;
use tower_http::{cors::CorsLayer, trace::TraceLayer};
use uuid::Uuid;

const MAX_BLOB_SIZE: usize = 64 * 1024;
const ROOM_CHANNEL_CAPACITY: usize = 256;

type RoomRegistry = Arc<Mutex<HashMap<String, broadcast::Sender<Vec<u8>>>>>;

#[derive(Clone)]
pub struct AppState {
    pool: SqlitePool,
    rooms: RoomRegistry,
}

pub fn app(state: AppState) -> Router {
    Router::new()
        .route("/healthz", get(healthz))
        .route("/notes", post(create_note))
        .route("/notes/{id}", get(get_note).put(update_note))
        .route("/rooms/{id}/updates", get(room_updates))
        .route("/rooms/{id}/snapshot", axum::routing::put(room_snapshot))
        .route("/ws/{room}", get(ws_handler))
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}

pub async fn init_pool(database_url: &str) -> Result<SqlitePool, sqlx::Error> {
    let options = SqliteConnectOptions::from_str(database_url)?.create_if_missing(true);
    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(options)
        .await?;
    sqlx::migrate!("./migrations").run(&pool).await?;
    Ok(pool)
}

pub fn state(pool: SqlitePool) -> AppState {
    AppState {
        pool,
        rooms: Arc::new(Mutex::new(HashMap::new())),
    }
}

fn room_channel(state: &AppState, room: &str) -> broadcast::Sender<Vec<u8>> {
    let mut rooms = state.rooms.lock().expect("rooms lock poisoned");
    rooms
        .entry(room.to_string())
        .or_insert_with(|| broadcast::channel(ROOM_CHANNEL_CAPACITY).0)
        .clone()
}

async fn valid_edit_token(pool: &SqlitePool, room: &str, token: &str) -> bool {
    let row = sqlx::query("SELECT 1 FROM notes WHERE id = ? AND edit_token = ?")
        .bind(room)
        .bind(token)
        .fetch_optional(pool)
        .await;
    matches!(row, Ok(Some(_)))
}

async fn room_exists(pool: &SqlitePool, room: &str) -> bool {
    let row = sqlx::query("SELECT 1 FROM notes WHERE id = ?")
        .bind(room)
        .fetch_optional(pool)
        .await;
    matches!(row, Ok(Some(_)))
}

async fn healthz() -> &'static str {
    "ok"
}

async fn create_note(State(state): State<AppState>, body: Bytes) -> impl IntoResponse {
    if body.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "empty body"})),
        )
            .into_response();
    }
    let id = Uuid::new_v4().to_string();
    let edit_token = Uuid::new_v4().to_string();
    let result = sqlx::query("INSERT INTO notes (id, ciphertext, edit_token) VALUES (?, ?, ?)")
        .bind(&id)
        .bind(body.as_ref())
        .bind(&edit_token)
        .execute(&state.pool)
        .await;
    match result {
        Ok(_) => (
            StatusCode::CREATED,
            Json(serde_json::json!({"id": id, "edit_token": edit_token})),
        )
            .into_response(),
        Err(e) => {
            tracing::error!(error = %e, "failed to insert note");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": "internal error"})),
            )
                .into_response()
        }
    }
}

async fn get_note(State(state): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    let row = sqlx::query_as::<_, (Vec<u8>,)>("SELECT ciphertext FROM notes WHERE id = ?")
        .bind(&id)
        .fetch_optional(&state.pool)
        .await;
    match row {
        Ok(Some((ciphertext,))) => (StatusCode::OK, ciphertext).into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "note not found"})),
        )
            .into_response(),
        Err(e) => {
            tracing::error!(error = %e, "failed to fetch note");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": "internal error"})),
            )
                .into_response()
        }
    }
}

async fn update_note(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> impl IntoResponse {
    let Some(token) = headers
        .get("x-edit-token")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string())
    else {
        return (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({"error": "missing x-edit-token header"})),
        )
            .into_response();
    };
    if body.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "empty body"})),
        )
            .into_response();
    }
    let result = sqlx::query(
        "UPDATE notes SET ciphertext = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') \
         WHERE id = ? AND edit_token = ?",
    )
    .bind(body.as_ref())
    .bind(&id)
    .bind(&token)
    .execute(&state.pool)
    .await;
    match result {
        Ok(done) if done.rows_affected() > 0 => StatusCode::NO_CONTENT.into_response(),
        Ok(_) => (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({"error": "invalid id or edit token"})),
        )
            .into_response(),
        Err(e) => {
            tracing::error!(error = %e, "failed to update note");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": "internal error"})),
            )
                .into_response()
        }
    }
}

#[derive(Deserialize)]
pub struct UpdatesQuery {
    after: Option<i64>,
}

async fn room_updates(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Query(query): Query<UpdatesQuery>,
) -> impl IntoResponse {
    if !room_exists(&state.pool, &id).await {
        return (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "room not found"})),
        )
            .into_response();
    }
    let after = query.after.unwrap_or(-1);
    let rows = sqlx::query_as::<_, (i64, Vec<u8>)>(
        "SELECT seq, blob FROM room_updates WHERE room_id = ? AND seq > ? ORDER BY seq",
    )
    .bind(&id)
    .bind(after)
    .fetch_all(&state.pool)
    .await;
    match rows {
        Ok(rows) => {
            let updates: Vec<_> = rows
                .into_iter()
                .map(|(seq, blob)| {
                    serde_json::json!({"seq": seq, "blob": URL_SAFE_NO_PAD.encode(blob)})
                })
                .collect();
            Json(serde_json::json!({"updates": updates})).into_response()
        }
        Err(e) => {
            tracing::error!(error = %e, "failed to fetch room updates");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": "internal error"})),
            )
                .into_response()
        }
    }
}

async fn room_snapshot(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> impl IntoResponse {
    let Some(token) = headers
        .get("x-edit-token")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string())
    else {
        return (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({"error": "missing x-edit-token header"})),
        )
            .into_response();
    };
    if body.is_empty() || body.len() > MAX_BLOB_SIZE * 16 {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "invalid snapshot"})),
        )
            .into_response();
    }
    if !valid_edit_token(&state.pool, &id, &token).await {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({"error": "invalid id or edit token"})),
        )
            .into_response();
    }
    let mut tx = match state.pool.begin().await {
        Ok(tx) => tx,
        Err(e) => {
            tracing::error!(error = %e, "failed to begin transaction");
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": "internal error"})),
            )
                .into_response();
        }
    };
    if let Err(e) = sqlx::query("DELETE FROM room_updates WHERE room_id = ?")
        .bind(&id)
        .execute(&mut *tx)
        .await
    {
        tracing::error!(error = %e, "failed to clear room updates");
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "internal error"})),
        )
            .into_response();
    }
    if let Err(e) = sqlx::query("INSERT INTO room_updates (room_id, blob) VALUES (?, ?)")
        .bind(&id)
        .bind(body.as_ref())
        .execute(&mut *tx)
        .await
    {
        tracing::error!(error = %e, "failed to store snapshot");
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "internal error"})),
        )
            .into_response();
    }
    match tx.commit().await {
        Ok(_) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => {
            tracing::error!(error = %e, "failed to commit snapshot");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": "internal error"})),
            )
                .into_response()
        }
    }
}

async fn ws_handler(
    State(state): State<AppState>,
    Path(room): Path<String>,
    ws: WebSocketUpgrade,
) -> impl IntoResponse {
    if !room_exists(&state.pool, &room).await {
        return (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "room not found"})),
        )
            .into_response();
    }
    ws.on_upgrade(move |socket| handle_socket(socket, state, room))
        .into_response()
}

async fn handle_socket(mut socket: WebSocket, state: AppState, room: String) {
    let tx = room_channel(&state, &room);
    let mut rx = tx.subscribe();
    let mut writable = false;

    loop {
        tokio::select! {
            incoming = socket.recv() => {
                match incoming {
                    Some(Ok(Message::Binary(blob))) => {
                        if !writable || blob.len() > MAX_BLOB_SIZE {
                            continue;
                        }
                        let result = sqlx::query(
                            "INSERT INTO room_updates (room_id, blob) VALUES (?, ?)",
                        )
                        .bind(&room)
                        .bind(blob.as_ref())
                        .execute(&state.pool)
                        .await;
                        match result {
                            Ok(_) => {
                                let _ = tx.send(blob.to_vec());
                            }
                            Err(e) => {
                                tracing::error!(error = %e, "failed to persist room update");
                            }
                        }
                    }
                    Some(Ok(Message::Text(text))) => {
                        if writable {
                            continue;
                        }
                        let parsed = serde_json::from_str::<serde_json::Value>(&text);
                        if let Ok(value) = parsed {
                            if let Some(token) = value.get("edit_token").and_then(|t| t.as_str()) {
                                if valid_edit_token(&state.pool, &room, token).await {
                                    writable = true;
                                    let _ = socket
                                        .send(Message::Text("{\"writable\":true}".into()))
                                        .await;
                                }
                            }
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    _ => {}
                }
            }
            outgoing = rx.recv() => {
                match outgoing {
                    Ok(blob) => {
                        if socket.send(Message::Binary(blob.into())).await.is_err() {
                            break;
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
        }
    }
}
