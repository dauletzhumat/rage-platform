/**
 * Deterministic JSON: object keys sorted recursively, arrays kept in order, `undefined` members
 * dropped (as `JSON.stringify` does). Used for the idempotency request hash so that the same
 * logical body always hashes the same, regardless of key order.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value)) ?? 'null';
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    // Null-prototype target + defineProperty: an own "__proto__" key from JSON.parse is kept
    // (and therefore hashed) instead of being swallowed by the prototype setter (gate I-2).
    const out = Object.create(null) as Record<string, unknown>;
    for (const key of Object.keys(value).sort()) {
      const v = Object.getOwnPropertyDescriptor(value, key)?.value as unknown;
      if (v !== undefined) {
        Object.defineProperty(out, key, {
          value: sortKeys(v),
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
    }
    return out;
  }
  return value;
}
