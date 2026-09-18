/** PHP `date()`-compatible formatting used by WordPress general settings. */

export const DEFAULT_DATE_FORMAT = "F j, Y";
export const DEFAULT_TIME_FORMAT = "g:i a";
export const DEFAULT_TIMEZONE = "UTC";
/** Monday — WordPress's default `start_of_week`. */
export const DEFAULT_START_OF_WEEK = 1;

export const DATE_FORMAT_PRESETS = ["F j, Y", "Y-m-d", "m/d/Y", "d/m/Y"] as const;
export const TIME_FORMAT_PRESETS = ["g:i a", "g:i A", "H:i"] as const;

export const WEEKDAYS = [
  { value: 0, label: "Sunday" },
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
] as const;

const MONTHS_FULL = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

export interface PhpDateOptions {
  timeZone?: string;
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number;
  tzName: string;
  offsetMinutes: number;
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, "0");
}

function ordinal(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return "th";
  switch (n % 10) {
    case 1: return "st";
    case 2: return "nd";
    case 3: return "rd";
    default: return "th";
  }
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function listTimeZones(): string[] {
  const intl = Intl as typeof Intl & { supportedValuesOf?: (key: "timeZone") => string[] };
  const supported = intl.supportedValuesOf?.("timeZone") ?? [];
  return ["UTC", ...supported.filter((z) => z !== "UTC")];
}

function getZonedParts(date: Date, timeZone: string): ZonedParts {
  const zone = isValidTimeZone(timeZone) ? timeZone : "UTC";
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    weekday: "short",
    hourCycle: "h23",
    timeZoneName: "short",
  });

  const map: Record<string, string> = {};
  for (const part of fmt.formatToParts(date)) {
    if (part.type !== "literal") map[part.type] = part.value;
  }

  const offsetMinutes = parseShortOffset(map.timeZoneName ?? "GMT");

  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
    weekday: WEEKDAY_INDEX[map.weekday ?? "Sun"] ?? 0,
    tzName: map.timeZoneName ?? zone,
    offsetMinutes,
  };
}

/** Parse `GMT`, `GMT+2`, `GMT+02:00`, `UTC-5`. */
function parseShortOffset(name: string): number {
  const match = name.match(/(?:GMT|UTC)([+-])(\d{1,2})(?::?(\d{2}))?/);
  if (!match) return 0;
  const sign = match[1] === "-" ? -1 : 1;
  const hours = Number(match[2]);
  const minutes = Number(match[3] ?? 0);
  return sign * (hours * 60 + minutes);
}

function formatOffset(minutes: number, separator: boolean): string {
  const sign = minutes >= 0 ? "+" : "-";
  const abs = Math.abs(minutes);
  const hh = pad(Math.floor(abs / 60));
  const mm = pad(abs % 60);
  return separator ? `${sign}${hh}:${mm}` : `${sign}${hh}${mm}`;
}

function leapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function dayOfYear(year: number, month: number, day: number): number {
  const utc = Date.UTC(year, month - 1, day);
  const start = Date.UTC(year, 0, 1);
  return Math.floor((utc - start) / 86_400_000);
}

function token(char: string, date: Date, p: ZonedParts, timeZone: string): string {
  const hour12 = p.hour % 12 || 12;
  const ampm = p.hour < 12 ? "am" : "pm";

  switch (char) {
    case "d": return pad(p.day);
    case "D": return DAYS_SHORT[p.weekday]!;
    case "j": return String(p.day);
    case "l": return DAYS_FULL[p.weekday]!;
    case "N": return String(p.weekday === 0 ? 7 : p.weekday);
    case "S": return ordinal(p.day);
    case "w": return String(p.weekday);
    case "z": return String(dayOfYear(p.year, p.month, p.day));
    case "F": return MONTHS_FULL[p.month - 1]!;
    case "m": return pad(p.month);
    case "M": return MONTHS_SHORT[p.month - 1]!;
    case "n": return String(p.month);
    case "t": return String(daysInMonth(p.year, p.month));
    case "L": return leapYear(p.year) ? "1" : "0";
    case "Y": return String(p.year);
    case "y": return pad(p.year % 100);
    case "a": return ampm;
    case "A": return ampm.toUpperCase();
    case "g": return String(hour12);
    case "G": return String(p.hour);
    case "h": return pad(hour12);
    case "H": return pad(p.hour);
    case "i": return pad(p.minute);
    case "s": return pad(p.second);
    case "e": return timeZone;
    case "T": return p.tzName.replace(/^GMT/, "UTC");
    case "P": return formatOffset(p.offsetMinutes, true);
    case "O": return formatOffset(p.offsetMinutes, false);
    case "Z": return String(p.offsetMinutes * 60);
    case "c": return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}${formatOffset(p.offsetMinutes, true)}`;
    case "r": return `${DAYS_SHORT[p.weekday]}, ${pad(p.day)} ${MONTHS_SHORT[p.month - 1]} ${p.year} ${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)} ${formatOffset(p.offsetMinutes, false)}`;
    case "U": return String(Math.floor(date.getTime() / 1000));
    default: return char;
  }
}

export function formatPhpDate(date: Date, format: string, options: PhpDateOptions = {}): string {
  const timeZone = options.timeZone && isValidTimeZone(options.timeZone) ? options.timeZone : "UTC";
  const parts = getZonedParts(date, timeZone);
  let out = "";
  for (let i = 0; i < format.length; i++) {
    const char = format[i]!;
    if (char === "\\" && i + 1 < format.length) {
      out += format[++i]!;
      continue;
    }
    out += /[a-zA-Z]/.test(char) ? token(char, date, parts, timeZone) : char;
  }
  return out;
}

export function previewPhpDate(format: string, timeZone = "UTC", at = new Date()): string {
  return formatPhpDate(at, format, { timeZone });
}
