use axum::{
    body::Bytes,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::SqlitePool;
use std::str::FromStr;
use tower_http::{cors::CorsLayer, trace::TraceLayer};
use uuid::Uuid;

#[derive(Clone)]
pub struct AppState {
    pool: SqlitePool,
}

pub fn app(state: AppState) -> Router {
    Router::new()
        .route("/healthz", get(healthz))
        .route("/notes", post(create_note))
        .route("/notes/{id}", get(get_note).put(update_note))
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
    AppState { pool }
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
