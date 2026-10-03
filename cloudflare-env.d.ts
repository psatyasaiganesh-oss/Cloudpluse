declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    MONITOR_ALLOWED_HOSTS?: string;
  }
}
