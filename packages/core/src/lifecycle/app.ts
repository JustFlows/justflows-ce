import type { AppConfig } from "../config/schema.js";
import { createLogger, type Logger } from "../logging/logger.js";
import { HooksRegistry } from "../hooks/registry.js";
import { SettingsStore } from "../settings/store.js";
import { HealthMonitor, type HealthReport } from "../health/check.js";

const VERSION = "0.1.2";

export type AppState = "created" | "starting" | "running" | "stopping" | "stopped";

export interface AppContext {
  readonly config: AppConfig;
  readonly logger: Logger;
  readonly hooks: HooksRegistry;
  readonly settings: SettingsStore;
  readonly health: HealthMonitor;
  readonly state: AppState;
}

export class App implements AppContext {
  readonly config: AppConfig;
  readonly logger: Logger;
  readonly hooks: HooksRegistry;
  readonly settings: SettingsStore;
  readonly health: HealthMonitor;

  private _state: AppState = "created";

  constructor(config: AppConfig) {
    this.config = config;
    this.logger = createLogger(config.logLevel);
    this.hooks = new HooksRegistry({
      logger: this.logger.child({ component: "hooks" }),
      freezeEvents: config.env !== "production",
    });
    this.settings = new SettingsStore();
    this.health = new HealthMonitor(VERSION);
  }

  get state(): AppState {
    return this._state;
  }

  async start(): Promise<void> {
    if (this._state !== "created" && this._state !== "stopped") {
      throw new Error(`Cannot start app in state "${this._state}"`);
    }

    this._state = "starting";
    this.logger.info("Justflows starting", {
      env: this.config.env,
      url: this.config.url,
    });

    await this.hooks.dispatchAction(
      "app.starting",
      { version: VERSION, app: this },
      { source: "system" },
    );

    this._state = "running";
    this.logger.info("Justflows started");

    await this.hooks.dispatchAction(
      "app.started",
      { version: VERSION, app: this },
      { source: "system" },
    );
  }

  async stop(): Promise<void> {
    if (this._state !== "running") {
      throw new Error(`Cannot stop app in state "${this._state}"`);
    }

    this._state = "stopping";
    this.logger.info("Justflows stopping");

    await this.hooks.dispatchAction("app.stopping", { app: this }, { source: "system" });

    this._state = "stopped";
    this.logger.info("Justflows stopped");
  }

  async healthCheck(): Promise<HealthReport> {
    return this.health.check();
  }
}
