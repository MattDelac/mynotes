use mynotes_api::{app, init_pool, spawn_cleanup_task, state_with_config, Config};
use std::net::SocketAddr;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "mynotes_api=info,tower_http=info".into()),
        )
        .init();

    let database_url = std::env::var("DATABASE_URL").unwrap_or_else(|_| "sqlite:mynotes.db".into());
    let pool = init_pool(&database_url)
        .await
        .expect("failed to initialize database");

    let config = Config::from_env();
    spawn_cleanup_task(pool.clone(), config.clone());

    let bind = std::env::var("BIND_ADDR").unwrap_or_else(|_| "0.0.0.0:3000".into());
    let listener = tokio::net::TcpListener::bind(&bind)
        .await
        .expect("failed to bind");
    tracing::info!(addr = %bind, "listening");
    axum::serve(
        listener,
        app(state_with_config(pool, config)).into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await
    .expect("server error");
}
