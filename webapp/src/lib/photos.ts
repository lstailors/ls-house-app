// Parse the lsh_photos field (a JSON-stringified array of URLs) defensively.
export function parsePhotos(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((p): p is string => typeof p === "string");
  if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === "string") : [];
    } catch {
      return [];
    }
  }
  return [];
}
