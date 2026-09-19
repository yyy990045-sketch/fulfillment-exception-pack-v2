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
