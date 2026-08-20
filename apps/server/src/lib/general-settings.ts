import { getDb } from "./db.js";
import {
  DEFAULT_DATE_FORMAT,
  DEFAULT_START_OF_WEEK,
  DEFAULT_TIME_FORMAT,
  DEFAULT_TIMEZONE,
  formatPhpDate,
  isValidTimeZone,
} from "./datetime-format.js";
import { isUserRole, type UserRole } from "./rbac.js";
import { getSiteId, getSiteSetting } from "./site-settings.js";

export interface GeneralSettings {
  adminEmail: string;
  usersCanRegister: boolean;
  defaultRole: UserRole;
  timezone: string;
  dateFormat: string;
  timeFormat: string;
  startOfWeek: number;
}

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function asBool(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  return fallback;
}

function asInt(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return fallback;
}

async function fallbackAdminEmail(): Promise<string> {
  try {
    const db = await getDb();
    const rows = await db.query<{ email: string }>(
      "SELECT email FROM users WHERE role = ? ORDER BY created_at ASC LIMIT 1",
      ["administrator"],
    );
    return rows[0]?.email ?? "";
  } catch {
    return "";
  }
}

export async function getGeneralSettings(siteId?: string | null): Promise<GeneralSettings> {
  const id = siteId ?? (await getSiteId());
  if (!id) {
    return {
      adminEmail: "",
      usersCanRegister: false,
      defaultRole: "subscriber",
      timezone: DEFAULT_TIMEZONE,
      dateFormat: DEFAULT_DATE_FORMAT,
      timeFormat: DEFAULT_TIME_FORMAT,
      startOfWeek: DEFAULT_START_OF_WEEK,
    };
  }

  const [
    storedEmail,
    usersCanRegister,
    defaultRoleRaw,
    timezoneRaw,
    dateFormat,
    timeFormat,
    startOfWeekRaw,
  ] = await Promise.all([
    getSiteSetting<string>(id, "admin_email"),
    getSiteSetting<boolean>(id, "users_can_register"),
    getSiteSetting<string>(id, "default_role"),
    getSiteSetting<string>(id, "timezone"),
    getSiteSetting<string>(id, "date_format"),
    getSiteSetting<string>(id, "time_format"),
    getSiteSetting<number>(id, "start_of_week"),
  ]);

  const timezone = asString(timezoneRaw, DEFAULT_TIMEZONE);
  const defaultRole = asString(defaultRoleRaw, "subscriber");
  const startOfWeek = asInt(startOfWeekRaw, DEFAULT_START_OF_WEEK);

  return {
    adminEmail: asString(storedEmail, "") || (await fallbackAdminEmail()),
    usersCanRegister: asBool(usersCanRegister, false),
    defaultRole: isUserRole(defaultRole) ? defaultRole : "subscriber",
    timezone: isValidTimeZone(timezone) ? timezone : DEFAULT_TIMEZONE,
    dateFormat: asString(dateFormat, DEFAULT_DATE_FORMAT),
    timeFormat: asString(timeFormat, DEFAULT_TIME_FORMAT),
    startOfWeek: startOfWeek >= 0 && startOfWeek <= 6 ? startOfWeek : DEFAULT_START_OF_WEEK,
  };
}

export async function formatContentDate(date: Date | string): Promise<string> {
  const settings = await getGeneralSettings();
  const d = typeof date === "string" ? new Date(date) : date;
  return formatPhpDate(d, settings.dateFormat, { timeZone: settings.timezone });
}
