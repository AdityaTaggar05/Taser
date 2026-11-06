/** Stable comparison for JSON data; object insertion order is not part of a level revision. */
export function canonicalJSON(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalJSON).join(',') + ']';
  const object = value as Record<string, unknown>;
  return (
    '{' +
    Object.keys(object)
      .filter((k) => object[k] !== undefined)
      .sort()
      .map((k) => JSON.stringify(k) + ':' + canonicalJSON(object[k]))
      .join(',') +
    '}'
  );
}
