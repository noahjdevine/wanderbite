export function firstRpcRow<T>(data: T[] | T | null | undefined): T | null {
  if (data == null) return null;
  if (Array.isArray(data)) return data[0] ?? null;
  return data;
}
