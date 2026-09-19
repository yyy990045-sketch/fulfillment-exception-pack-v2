import { OperationalAnalyticsError, type OperationalBucket } from "./operational-types.js";

export function parseAnalyticsDate(value: string | undefined, field: "from" | "to") {
  if (value === undefined || value.trim() === "") return undefined;
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) throw new OperationalAnalyticsError("ANALYTICS_INVALID_DATE_RANGE");
  return timestamp;
}

export function normalizeBucket(value: string | undefined): OperationalBucket {
  const bucket = value || "month";
  if (!["day", "week", "month"].includes(bucket)) throw new OperationalAnalyticsError("ANALYTICS_INVALID_BUCKET");
  return bucket as OperationalBucket;
}

export function bucketKey(iso: string, bucket: OperationalBucket) {
  const date = new Date(iso);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  if (bucket === "month") return `${year}-${month}`;
  if (bucket === "day") return `${year}-${month}-${day}`;
  const monday = new Date(Date.UTC(year, date.getUTCMonth(), date.getUTCDate()));
  const weekday = monday.getUTCDay() || 7;
  monday.setUTCDate(monday.getUTCDate() - weekday + 1);
  return monday.toISOString().slice(0, 10);
}

export function bucketRange(key: string, bucket: OperationalBucket) {
  let start: Date;
  let end: Date;
  if (bucket === "month") {
    const match = /^(\d{4})-(\d{2})$/.exec(key);
    if (!match) throw new OperationalAnalyticsError("ANALYTICS_INVALID_BUCKET");
    const year = Number(match[1]);
    const month = Number(match[2]) - 1;
    start = new Date(Date.UTC(year, month, 1));
    end = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999));
  } else {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
    if (!match) throw new OperationalAnalyticsError("ANALYTICS_INVALID_BUCKET");
    start = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    end = new Date(start);
    if (bucket === "week") end.setUTCDate(end.getUTCDate() + 6);
    end.setUTCHours(23, 59, 59, 999);
  }
  const dayLabel = (date: Date) => `${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
  const label = bucket === "month"
    ? `${start.getUTCFullYear()}年${String(start.getUTCMonth() + 1).padStart(2, "0")}月`
    : bucket === "week"
      ? `${dayLabel(start)} 至 ${dayLabel(end)}`
      : dayLabel(start);
  return {
    label,
    from: start.toISOString(),
    to: end.toISOString(),
  };
}

export function bucketKeysBetween(from: number, to: number, bucket: OperationalBucket) {
  const keys: string[] = [];
  const cursor = new Date(from);
  cursor.setUTCHours(0, 0, 0, 0);
  while (cursor.getTime() <= to) {
    keys.push(bucketKey(cursor.toISOString(), bucket));
    if (bucket === "month") {
      cursor.setUTCDate(1);
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
    else cursor.setUTCDate(cursor.getUTCDate() + (bucket === "week" ? 7 : 1));
  }
  return [...new Set(keys)];
}
