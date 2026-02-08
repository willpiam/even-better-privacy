import { coerceDbNumber } from "./_db.ts";

export function formatEpoch(value: unknown): string | null {
  const numeric = coerceDbNumber(value);
  if (numeric === null) return null;
  const date = new Date(numeric);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function parseLimit(value: unknown, fallback = 100): number {
  const numeric = typeof value === "string" || typeof value === "number" ? Number(value) : NaN;
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return Math.floor(numeric);
}

export function parseOffset(value: unknown, fallback = 0): number {
  const numeric = typeof value === "string" || typeof value === "number" ? Number(value) : NaN;
  if (!Number.isFinite(numeric) || numeric < 0) return fallback;
  return Math.floor(numeric);
}
