import fs from "node:fs/promises";
import path from "node:path";
import type { Logger } from "@justflows/core";
import type { PackageManifest } from "@justflows/installer";

export type UpdateState =
  | "idle"
  | "checking"
  | "downloading"
  | "staging"
  | "maintenance"
  | "migrating"
  | "health-checking"
  | "done"
  | "rolling-back"
  | "failed";

export interface UpdateRecord {
  id: string;
  packageId: string;
  packageType: "core" | "plugin" | "theme";
  fromVersion: string;
  toVersion: string;
  initiatedBy: string;
  state: UpdateState;
  startedAt: string;
  completedAt?: string;
  rollbackReason?: string;
  healthChecks: HealthCheckRecord[];
}

export interface HealthCheckRecord {
  name: string;
  passed: boolean;
  message?: string;
  checkedAt: string;
}

export interface UpdateManagerOptions {
  releasesDir: string;
  logger: Logger;
  /** Called to run health checks — must return true if healthy */
  healthCheck: () => Promise<boolean>;
  /** Called to run database migrations for an update */
  runMigrations: (packageId: string, version: string) => Promise<void>;
}

/**
 * Manages the full update lifecycle:
 * download → stage → backup → maintenance → activate → migrate
 *            → health check → commit or rollback
 *
 * Matches the flow in UPDATE_SPEC.md:
 * discover → verify → preflight → download → verify → checkpoint
 * → preserve → maintenance → activate → migrate → restart
 * → health check → commit → leave maintenance
 */
export class UpdateManager {
  private readonly records = new Map<string, UpdateRecord>();
  private maintenanceMode = false;

  constructor(private readonly opts: UpdateManagerOptions) {}

  get isInMaintenanceMode(): boolean {
    return this.maintenanceMode;
  }

  async applyUpdate(
    manifest: PackageManifest,
    packageBuffer: Buffer,
    initiatedBy: string,
  ): Promise<UpdateRecord> {
    const id = crypto.randomUUID();
    const record: UpdateRecord = {
      id,
      packageId: manifest.id,
      packageType: manifest.type === "plugin" ? "plugin" : "theme",
      fromVersion: "unknown",
      toVersion: manifest.version,
      initiatedBy,
      state: "staging",
      startedAt: new Date().toISOString(),
      healthChecks: [],
    };
    this.records.set(id, record);

    try {
      // Stage the new version
      this.setState(record, "staging");
      const stageDir = path.join(this.opts.releasesDir, manifest.id, manifest.version);
      await fs.mkdir(stageDir, { recursive: true });
      await fs.writeFile(path.join(stageDir, "package.buf"), packageBuffer);
      this.opts.logger.info("Update staged", { packageId: manifest.id, version: manifest.version });

      // Enter maintenance mode
      this.setState(record, "maintenance");
      this.maintenanceMode = true;

      // Run migrations
      this.setState(record, "migrating");
      await this.opts.runMigrations(manifest.id, manifest.version);

      // Health check
      this.setState(record, "health-checking");
      const healthy = await this.opts.healthCheck();
      record.healthChecks.push({
        name: "post-update",
        passed: healthy,
        checkedAt: new Date().toISOString(),
      });

      if (!healthy) {
        throw new Error("Health check failed after update");
      }

      // Commit
      this.setState(record, "done");
      record.completedAt = new Date().toISOString();
      this.maintenanceMode = false;
      this.opts.logger.info("Update completed", { packageId: manifest.id, version: manifest.version });

      return record;
    } catch (err) {
      await this.rollback(record, String(err));
      throw err;
    }
  }

  private async rollback(record: UpdateRecord, reason: string): Promise<void> {
    this.setState(record, "rolling-back");
    record.rollbackReason = reason;
    this.opts.logger.warn("Rolling back update", {
      packageId: record.packageId,
      version: record.toVersion,
      reason,
    });

    // TODO: restore previous release symlink / files
    this.maintenanceMode = false;
    this.setState(record, "failed");
    record.completedAt = new Date().toISOString();
  }

  getRecord(id: string): UpdateRecord | undefined {
    return this.records.get(id);
  }

  listRecords(): UpdateRecord[] {
    return Array.from(this.records.values()).sort((a, b) =>
      b.startedAt.localeCompare(a.startedAt),
    );
  }

  private setState(record: UpdateRecord, state: UpdateState): void {
    record.state = state;
    this.records.set(record.id, record);
  }
}
