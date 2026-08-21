use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::{Arc, Mutex};
use std::time::Instant;

#[derive(Clone)]
pub struct Config {
    pub max_blob_size: usize,
    pub max_snapshot_size: usize,
    pub max_image_size: usize,
    pub max_room_bytes: usize,
    pub max_room_updates: u64,
    pub ttl_days: u64,
    pub cleanup_interval_secs: u64,
    pub rate_create_per_min: u32,
    pub rate_write_per_min: u32,
    pub rate_read_per_min: u32,
    pub rate_ws_per_min: u32,
    pub max_ws_per_ip: usize,
    pub max_room_subscribers: usize,
    pub create_token: Option<String>,
    pub trust_proxy_headers: bool,
}

fn env_usize(name: &str, default: usize) -> usize {
    std::env::var(name)
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(default)
}

fn env_u64(name: &str, default: u64) -> u64 {
    std::env::var(name)
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(default)
}

fn env_u32(name: &str, default: u32) -> u32 {
    std::env::var(name)
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(default)
}

fn env_bool(name: &str, default: bool) -> bool {
    std::env::var(name)
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(default)
}

impl Config {
    pub fn from_env() -> Self {
        Self {
            max_blob_size: env_usize("MAX_BLOB_SIZE", 64 * 1024),
            max_snapshot_size: env_usize("MAX_SNAPSHOT_SIZE", 2 * 1024 * 1024),
            max_image_size: env_usize("MAX_IMAGE_SIZE", 5 * 1024 * 1024),
            max_room_bytes: env_usize("MAX_ROOM_BYTES", 10 * 1024 * 1024),
            max_room_updates: env_u64("MAX_ROOM_UPDATES", 5_000),
            ttl_days: env_u64("TTL_DAYS", 90),
            cleanup_interval_secs: env_u64("CLEANUP_INTERVAL_SECS", 3_600),
            rate_create_per_min: env_u32("RATE_CREATE_PER_MIN", 10),
            rate_write_per_min: env_u32("RATE_WRITE_PER_MIN", 30),
            rate_read_per_min: env_u32("RATE_READ_PER_MIN", 120),
            rate_ws_per_min: env_u32("RATE_WS_PER_MIN", 20),
            max_ws_per_ip: env_usize("MAX_WS_PER_IP", 10),
            max_room_subscribers: env_usize("MAX_ROOM_SUBSCRIBERS", 32),
            create_token: std::env::var("CREATE_TOKEN")
                .ok()
                .filter(|token| !token.is_empty()),
            trust_proxy_headers: env_bool("TRUST_PROXY_HEADERS", false),
        }
    }
}

struct Bucket {
    tokens: f64,
    last: Instant,
}

pub struct RateLimiter {
    capacity: f64,
    refill_per_sec: f64,
    buckets: Mutex<HashMap<IpAddr, Bucket>>,
}

impl RateLimiter {
    pub fn new(per_min: u32) -> Self {
        let capacity = f64::from(per_min.max(1));
        Self {
            capacity,
            refill_per_sec: capacity / 60.0,
            buckets: Mutex::new(HashMap::new()),
        }
    }

    pub fn check(&self, ip: IpAddr) -> Result<(), u64> {
        let now = Instant::now();
        let mut buckets = self.buckets.lock().expect("rate limiter lock poisoned");
        if buckets.len() > 100_000 {
            buckets.retain(|_, bucket| bucket.tokens < self.capacity);
        }
        let bucket = buckets.entry(ip).or_insert(Bucket {
            tokens: self.capacity,
            last: now,
        });
        let elapsed = now.duration_since(bucket.last).as_secs_f64();
        bucket.tokens = (bucket.tokens + elapsed * self.refill_per_sec).min(self.capacity);
        bucket.last = now;
        if bucket.tokens >= 1.0 {
            bucket.tokens -= 1.0;
            Ok(())
        } else {
            Err(((1.0 - bucket.tokens) / self.refill_per_sec).ceil() as u64)
        }
    }
}

#[derive(Clone)]
pub struct RateLimits {
    pub create: Arc<RateLimiter>,
    pub write: Arc<RateLimiter>,
    pub read: Arc<RateLimiter>,
    pub ws: Arc<RateLimiter>,
}

impl RateLimits {
    pub fn new(config: &Config) -> Self {
        Self {
            create: Arc::new(RateLimiter::new(config.rate_create_per_min)),
            write: Arc::new(RateLimiter::new(config.rate_write_per_min)),
            read: Arc::new(RateLimiter::new(config.rate_read_per_min)),
            ws: Arc::new(RateLimiter::new(config.rate_ws_per_min)),
        }
    }
}

pub type ConnGauge = Arc<Mutex<HashMap<IpAddr, usize>>>;

pub struct ConnGuard {
    gauge: ConnGauge,
    ip: IpAddr,
}

impl ConnGuard {
    pub fn acquire(gauge: &ConnGauge, ip: IpAddr, max: usize) -> Option<Self> {
        let mut map = gauge.lock().expect("conn gauge lock poisoned");
        let count = map.entry(ip).or_insert(0);
        if *count >= max {
            return None;
        }
        *count += 1;
        Some(Self {
            gauge: gauge.clone(),
            ip,
        })
    }
}

impl Drop for ConnGuard {
    fn drop(&mut self) {
        let mut map = self.gauge.lock().expect("conn gauge lock poisoned");
        if let Some(count) = map.get_mut(&self.ip) {
            *count -= 1;
            if *count == 0 {
                map.remove(&self.ip);
            }
        }
    }
}

pub fn token_eq(a: &str, b: &str) -> bool {
    let (x, y) = (a.as_bytes(), b.as_bytes());
    if x.len() != y.len() {
        return false;
    }
    x.iter().zip(y).fold(0u8, |acc, (p, q)| acc | (p ^ q)) == 0
}
