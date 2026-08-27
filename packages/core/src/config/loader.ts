import { AppConfigSchema, type AppConfig } from "./schema.js";
import { parseEnvBool } from "./env-bool.js";

/**
 * Load and validate configuration from environment variables.
 * Throws with a clear message if required values are missing or invalid.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const raw = {
    env: env["NODE_ENV"],
    port: env["PORT"],
    host: env["HOST"],
    url: env["APP_URL"],
    secret: env["APP_SECRET"],
    logLevel: env["LOG_LEVEL"],
    database: {
      driver: env["DATABASE_DRIVER"] || env["DB_DRIVER"],
      url: env["DATABASE_URL"],
      poolMin: env["DATABASE_POOL_MIN"],
      poolMax: env["DATABASE_POOL_MAX"],
      ssl: env["DATABASE_SSL"],
    },
    storage: {
      driver: env["STORAGE_DRIVER"],
      localPath: env["STORAGE_LOCAL_PATH"],
      s3Bucket: env["STORAGE_S3_BUCKET"],
      s3Region: env["STORAGE_S3_REGION"],
      s3Endpoint: env["STORAGE_S3_ENDPOINT"],
    },
    cache: {
      enabled: parseEnvBool(env["CACHE_ENABLED"], false),
      driver: env["CACHE_DRIVER"],
      dir: env["CACHE_DIR"],
      redisUrl: env["CACHE_REDIS_URL"],
      ttlSeconds: env["CACHE_TTL_SECONDS"],
    },
  };

  const result = AppConfigSchema.safeParse(raw);

  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Configuration is invalid:\n${issues}`);
  }

  return result.data;
}
