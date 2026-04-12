export type DatabaseQueryParams =
  | readonly unknown[]
  | Readonly<Record<string, unknown>>;

export abstract class DatabaseAdapter {
  abstract execute(sql: string): Promise<void>;
  abstract query<T extends unknown[]>(sql: string, params?: DatabaseQueryParams): Promise<T[]>;
  abstract close(): Promise<void>;
}

export function coerceNumber(value: number | string | bigint | null): number | null {
  if (value === null) return null;
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string") return Number(value);
  return Number(value);
}
