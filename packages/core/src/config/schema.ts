import { z } from "zod";

export const DatabaseConfigSchema = z.object({
  driver: z.enum(["postgres", "mysql", "mariadb"]).default("postgres"),
  url: z.string().min(1),
  poolMin: z.coerce.number().int().min(1).default(2),
  poolMax: z.coerce.number().int().min(1).default(10),
  ssl: z.coerce.boolean().default(false),
}).superRefine((value, ctx) => {
  const lower = value.url.toLowerCase();
  const validForDriver =
    (value.driver === "postgres" && lower.startsWith("postgres://")) ||
    (value.driver === "mysql" && lower.startsWith("mysql://")) ||
    (value.driver === "mariadb" && lower.startsWith("mariadb://"));

  if (!validForDriver) {
    ctx.addIssue({
      code: "custom",
      path: ["url"],
      message: `DATABASE_URL must use the ${value.driver}:// scheme when DATABASE_DRIVER=${value.driver}`,
    });
  }
});

export const StorageConfigSchema = z.object({
  driver: z.enum(["local", "s3"]).default("local"),
  localPath: z.string().default("./uploads"),
  s3Bucket: z.string().optional(),
  s3Region: z.string().optional(),
  s3Endpoint: z.string().optional(),
});

export const CacheConfigSchema = z.object({
  enabled: z.boolean().default(false),
  driver: z.enum(["memory", "filesystem", "redis"]).default("filesystem"),
  dir: z.string().optional(),
  redisUrl: z.string().optional(),
  ttlSeconds: z.coerce.number().int().min(0).default(300),
});

const EXAMPLE_SECRETS = new Set([
  "change-me-to-a-long-random-string-at-least-32-characters",
  "please-change-me-to-a-long-random-string-at-least-32-chars",
  "replace-this-with-a-long-random-string",
]);

export const AppConfigSchema = z.object({
  env: z.enum(["development", "test", "production"]).default("development"),
  port: z.coerce.number().int().min(1).max(65535).default(3000),
  host: z.string().default("0.0.0.0"),
  // z.url() is the Zod v4 preferred API (z.string().url() is deprecated)
  url: z.url(),
  secret: z.string().min(32),
  database: DatabaseConfigSchema,
  storage: StorageConfigSchema.default({ driver: "local", localPath: "./uploads" }),
  cache: CacheConfigSchema.default({ enabled: false, driver: "filesystem", ttlSeconds: 300 }),
  logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
}).superRefine((value, ctx) => {
  if (value.env === "production" && EXAMPLE_SECRETS.has(value.secret)) {
    ctx.addIssue({
      code: "custom",
      path: ["secret"],
      message: "APP_SECRET is a documented example value; set a unique production secret",
    });
  }
});

export type AppConfig = z.infer<typeof AppConfigSchema>;
export type DatabaseConfig = z.infer<typeof DatabaseConfigSchema>;
export type StorageConfig = z.infer<typeof StorageConfigSchema>;
export type CacheConfig = z.infer<typeof CacheConfigSchema>;
