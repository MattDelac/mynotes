pub mod config;

use axum::{
    body::Bytes,
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        ConnectInfo, DefaultBodyLimit, FromRequestParts, Path, Query, State,
    },
    http::{request::Parts, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use config::{token_eq, ConnGauge, ConnGuard, RateLimits};
use serde::Deserialize;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::SqlitePool;
use std::collections::HashMap;
use std::convert::Infallible;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::str::FromStr;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::sync::broadcast;
use tower_http::{cors::CorsLayer, trace::TraceLayer};
use uuid::Uuid;

pub use config::Config;

const ROOM_CHANNEL_CAPACITY: usize = 256;
const WS_IDLE_TIMEOUT: Duration = Duration::from_secs(300);
const ACTIVITY_TOUCH_INTERVAL: Duration = Duration::from_secs(60);

type RoomRegistry = Arc<Mutex<HashMap<String, broadcast::Sender<Vec<u8>>>>>;
type ActivityMap = Arc<Mutex<HashMap<String, Instant>>>;

#[derive(Clone)]
pub struct AppState {
    pool: SqlitePool,
    rooms: RoomRegistry,
    config: Config,
    limiters: RateLimits,
    ws_gauge: ConnGauge,
    activity: ActivityMap,
}

pub fn app(state: AppState) -> Router {
    Router::new()
        .route("/healthz", get(healthz))
        .route("/notes", post(create_note))
        .route("/notes/{id}", get(get_note).put(update_note))
        .route("/rooms/{id}/updates", get(room_updates))
        .route("/rooms/{id}/snapshot", axum::routing::put(room_snapshot))
        .route("/ws/{room}", get(ws_handler))
        .layer(DefaultBodyLimit::max(state.config.max_snapshot_size))
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
    state_with_config(pool, Config::from_env())
}

pub fn state_with_config(pool: SqlitePool, config: Config) -> AppState {
    AppState {
        pool,
        rooms: Arc::new(Mutex::new(HashMap::new())),
        limiters: RateLimits::new(&config),
        config,
        ws_gauge: Arc::new(Mutex::new(HashMap::new())),
        activity: Arc::new(Mutex::new(HashMap::new())),
    }
}

pub struct PeerAddr(Option<SocketAddr>);

impl<S> FromRequestParts<S> for PeerAddr
where
    S: Send + Sync,
{
    type Rejection = Infallible;

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        Ok(Self(
            parts
                .extensions
                .get::<ConnectInfo<SocketAddr>>()
                .map(|info| info.0),
        ))
    }
}

fn client_ip(headers: &HeaderMap, peer: &PeerAddr, trust_proxy: bool) -> IpAddr {
    if trust_proxy {
        if let Some(value) = headers.get("x-forwarded-for").and_then(|v| v.to_str().ok()) {
            if let Some(first) = value.split(',').next() {
                if let Ok(ip) = first.trim().parse() {
                    return ip;
                }
            }
        }
    }
    peer.0
        .map(|addr| addr.ip())
        .unwrap_or(IpAddr::V4(Ipv4Addr::UNSPECIFIED))
}

fn too_many_requests(retry_after: u64) -> Response {
    let mut response = (
        StatusCode::TOO_MANY_REQUESTS,
        Json(serde_json::json!({"error": "rate limited"})),
    )
        .into_response();
    if let Ok(value) = HeaderValue::from_str(&retry_after.to_string()) {
        response.headers_mut().insert("retry-after", value);
    }
    response
}

fn error_response(status: StatusCode, message: &str) -> Response {
    (status, Json(serde_json::json!({"error": message}))).into_response()
}

fn internal_error(context: &str, e: impl std::fmt::Display) -> Response {
    tracing::error!(error = %e, "{context}");
    error_response(StatusCode::INTERNAL_SERVER_ERROR, "internal error")
}

fn touch_activity(state: &AppState, room: &str) {
    let now = Instant::now();
    let should_touch = {
        let mut map = state.activity.lock().expect("activity lock poisoned");
        if map.len() > 10_000 {
            map.clear();
        }
        let due = map
            .get(room)
            .is_none_or(|last| now.duration_since(*last) > ACTIVITY_TOUCH_INTERVAL);
        if due {
            map.insert(room.to_string(), now);
        }
        due
    };
    if should_touch {
        let pool = state.pool.clone();
        let room = room.to_string();
        tokio::spawn(async move {
            let _ = sqlx::query(
                "UPDATE notes SET last_activity = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?",
            )
            .bind(room)
            .execute(&pool)
            .await;
        });
    }
}

pub async fn cleanup_expired(pool: &SqlitePool, ttl_days: u64) -> Result<(u64, u64), sqlx::Error> {
    let notes = sqlx::query(
        "DELETE FROM notes WHERE COALESCE(last_activity, updated_at) < \
         strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?)",
    )
    .bind(format!("-{ttl_days} days"))
    .execute(pool)
    .await?
    .rows_affected();
    let updates =
        sqlx::query("DELETE FROM room_updates WHERE room_id NOT IN (SELECT id FROM notes)")
            .execute(pool)
            .await?
            .rows_affected();
    Ok((notes, updates))
}

pub fn spawn_cleanup_task(pool: SqlitePool, config: Config) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        if config.ttl_days == 0 {
            tracing::info!("TTL cleanup disabled");
            return;
        }
        let mut interval =
            tokio::time::interval(Duration::from_secs(config.cleanup_interval_secs.max(60)));
        loop {
            interval.tick().await;
            match cleanup_expired(&pool, config.ttl_days).await {
                Ok((notes, updates)) if notes > 0 => {
                    tracing::info!(notes, updates, "expired shares removed");
                }
                Ok(_) => {}
                Err(e) => tracing::error!(error = %e, "cleanup failed"),
            }
        }
    })
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

async fn room_within_caps(pool: &SqlitePool, room: &str, config: &Config) -> bool {
    let row = sqlx::query_as::<_, (i64, i64)>(
        "SELECT COUNT(*), COALESCE(SUM(LENGTH(blob)), 0) FROM room_updates WHERE room_id = ?",
    )
    .bind(room)
    .fetch_one(pool)
    .await;
    match row {
        Ok((count, bytes)) => {
            count >= 0
                && (count as u64) < config.max_room_updates
                && bytes >= 0
                && (bytes as usize) < config.max_room_bytes
        }
        Err(_) => false,
    }
}

async fn healthz() -> &'static str {
    "ok"
}

async fn create_note(
    State(state): State<AppState>,
    headers: HeaderMap,
    peer: PeerAddr,
    body: Bytes,
) -> Response {
    if let Some(expected) = &state.config.create_token {
        let provided = headers.get("x-create-token").and_then(|v| v.to_str().ok());
        if !provided.is_some_and(|token| token_eq(token, expected)) {
            return error_response(StatusCode::FORBIDDEN, "invalid or missing x-create-token");
        }
    }
    let ip = client_ip(&headers, &peer, state.config.trust_proxy_headers);
    if let Err(retry_after) = state.limiters.create.check(ip) {
        return too_many_requests(retry_after);
    }
    if body.is_empty() {
        return error_response(StatusCode::BAD_REQUEST, "empty body");
    }
    if body.len() > state.config.max_snapshot_size {
        return error_response(StatusCode::PAYLOAD_TOO_LARGE, "blob too large");
    }
    let id = Uuid::new_v4().to_string();
    let edit_token = Uuid::new_v4().to_string();
    let result = sqlx::query(
        "INSERT INTO notes (id, ciphertext, edit_token, last_activity) \
         VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))",
    )
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
        Err(e) => internal_error("failed to insert note", e),
    }
}

async fn get_note(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    peer: PeerAddr,
) -> Response {
    let ip = client_ip(&headers, &peer, state.config.trust_proxy_headers);
    if let Err(retry_after) = state.limiters.read.check(ip) {
        return too_many_requests(retry_after);
    }
    let row = sqlx::query_as::<_, (Vec<u8>,)>("SELECT ciphertext FROM notes WHERE id = ?")
        .bind(&id)
        .fetch_optional(&state.pool)
        .await;
    match row {
        Ok(Some((ciphertext,))) => (StatusCode::OK, ciphertext).into_response(),
        Ok(None) => error_response(StatusCode::NOT_FOUND, "note not found"),
        Err(e) => internal_error("failed to fetch note", e),
    }
}

async fn update_note(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    peer: PeerAddr,
    body: Bytes,
) -> Response {
    let ip = client_ip(&headers, &peer, state.config.trust_proxy_headers);
    if let Err(retry_after) = state.limiters.write.check(ip) {
        return too_many_requests(retry_after);
    }
    let Some(token) = headers
        .get("x-edit-token")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string())
    else {
        return error_response(StatusCode::UNAUTHORIZED, "missing x-edit-token header");
    };
    if body.is_empty() {
        return error_response(StatusCode::BAD_REQUEST, "empty body");
    }
    if body.len() > state.config.max_snapshot_size {
        return error_response(StatusCode::PAYLOAD_TOO_LARGE, "blob too large");
    }
    let result = sqlx::query(
        "UPDATE notes SET ciphertext = ?, \
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), \
         last_activity = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') \
         WHERE id = ? AND edit_token = ?",
    )
    .bind(body.as_ref())
    .bind(&id)
    .bind(&token)
    .execute(&state.pool)
    .await;
    match result {
        Ok(done) if done.rows_affected() > 0 => StatusCode::NO_CONTENT.into_response(),
        Ok(_) => error_response(StatusCode::FORBIDDEN, "invalid id or edit token"),
        Err(e) => internal_error("failed to update note", e),
    }
}

#[derive(Deserialize)]
pub struct UpdatesQuery {
    after: Option<i64>,
}

async fn room_updates(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    peer: PeerAddr,
    Query(query): Query<UpdatesQuery>,
) -> Response {
    let ip = client_ip(&headers, &peer, state.config.trust_proxy_headers);
    if let Err(retry_after) = state.limiters.read.check(ip) {
        return too_many_requests(retry_after);
    }
    if !room_exists(&state.pool, &id).await {
        return error_response(StatusCode::NOT_FOUND, "room not found");
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
        Err(e) => internal_error("failed to fetch room updates", e),
    }
}

async fn room_snapshot(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    peer: PeerAddr,
    body: Bytes,
) -> Response {
    let ip = client_ip(&headers, &peer, state.config.trust_proxy_headers);
    if let Err(retry_after) = state.limiters.write.check(ip) {
        return too_many_requests(retry_after);
    }
    let Some(token) = headers
        .get("x-edit-token")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string())
    else {
        return error_response(StatusCode::UNAUTHORIZED, "missing x-edit-token header");
    };
    if body.is_empty() {
        return error_response(StatusCode::BAD_REQUEST, "empty snapshot");
    }
    if body.len() > state.config.max_snapshot_size {
        return error_response(StatusCode::PAYLOAD_TOO_LARGE, "snapshot too large");
    }
    if !valid_edit_token(&state.pool, &id, &token).await {
        return error_response(StatusCode::FORBIDDEN, "invalid id or edit token");
    }
    let mut tx = match state.pool.begin().await {
        Ok(tx) => tx,
        Err(e) => return internal_error("failed to begin transaction", e),
    };
    if let Err(e) = sqlx::query("DELETE FROM room_updates WHERE room_id = ?")
        .bind(&id)
        .execute(&mut *tx)
        .await
    {
        return internal_error("failed to clear room updates", e);
    }
    if let Err(e) = sqlx::query("INSERT INTO room_updates (room_id, blob) VALUES (?, ?)")
        .bind(&id)
        .bind(body.as_ref())
        .execute(&mut *tx)
        .await
    {
        return internal_error("failed to store snapshot", e);
    }
    if let Err(e) = sqlx::query(
        "UPDATE notes SET last_activity = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?",
    )
    .bind(&id)
    .execute(&mut *tx)
    .await
    {
        return internal_error("failed to touch room activity", e);
    }
    match tx.commit().await {
        Ok(_) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => internal_error("failed to commit snapshot", e),
    }
}

async fn ws_handler(
    State(state): State<AppState>,
    Path(room): Path<String>,
    headers: HeaderMap,
    peer: PeerAddr,
    ws: WebSocketUpgrade,
) -> Response {
    let ip = client_ip(&headers, &peer, state.config.trust_proxy_headers);
    if let Err(retry_after) = state.limiters.ws.check(ip) {
        return too_many_requests(retry_after);
    }
    if !room_exists(&state.pool, &room).await {
        return error_response(StatusCode::NOT_FOUND, "room not found");
    }
    let tx = room_channel(&state, &room);
    if tx.receiver_count() >= state.config.max_room_subscribers {
        return error_response(StatusCode::TOO_MANY_REQUESTS, "room is full");
    }
    let Some(guard) = ConnGuard::acquire(&state.ws_gauge, ip, state.config.max_ws_per_ip) else {
        return error_response(StatusCode::TOO_MANY_REQUESTS, "too many connections");
    };
    ws.on_upgrade(move |socket| handle_socket(socket, state, room, tx, guard))
        .into_response()
}

async fn handle_socket(
    mut socket: WebSocket,
    state: AppState,
    room: String,
    tx: broadcast::Sender<Vec<u8>>,
    _guard: ConnGuard,
) {
    let mut rx = tx.subscribe();
    let mut writable = false;
    let idle = tokio::time::sleep(WS_IDLE_TIMEOUT);
    tokio::pin!(idle);

    loop {
        tokio::select! {
            incoming = socket.recv() => {
                match incoming {
                    Some(Ok(Message::Binary(blob))) => {
                        idle.as_mut().reset(tokio::time::Instant::now() + WS_IDLE_TIMEOUT);
                        if !writable || blob.len() > state.config.max_blob_size {
                            continue;
                        }
                        if !room_within_caps(&state.pool, &room, &state.config).await {
                            tracing::warn!(room = %room, "room over size/update caps, dropping update");
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
                                touch_activity(&state, &room);
                                let _ = tx.send(blob.to_vec());
                            }
                            Err(e) => {
                                tracing::error!(error = %e, "failed to persist room update");
                            }
                        }
                    }
                    Some(Ok(Message::Text(text))) => {
                        idle.as_mut().reset(tokio::time::Instant::now() + WS_IDLE_TIMEOUT);
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
                        idle.as_mut().reset(tokio::time::Instant::now() + WS_IDLE_TIMEOUT);
                        if socket.send(Message::Binary(blob.into())).await.is_err() {
                            break;
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
            _ = &mut idle => {
                tracing::debug!(room = %room, "closing idle websocket");
                break;
            }
        }
    }
}
