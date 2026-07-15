const SENSITIVE_RESPONSE_KEYS = new Set([
  'passwordhash',
  'tokenversion',
  'failedloginattempts',
  'lockeduntil',
  'tokenhash',
  'storagekey',
  'sha256',
]);

export function stripSensitiveFields(value, seen = new WeakSet()) {
  if (Array.isArray(value)) return value.map((item) => stripSensitiveFields(item, seen));
  if (!value || typeof value !== 'object') return value;

  // Preserve Dates, Buffers, Prisma Decimals, and other class instances so the
  // framework/client can serialize them using their own well-tested behavior.
  if (Object.getPrototypeOf(value) !== Object.prototype) return value;
  if (seen.has(value)) return undefined;
  seen.add(value);

  const sanitized = {};
  for (const [key, child] of Object.entries(value)) {
    if (SENSITIVE_RESPONSE_KEYS.has(key.toLowerCase())) continue;
    sanitized[key] = stripSensitiveFields(child, seen);
  }
  seen.delete(value);
  return sanitized;
}

export function sanitizeJsonResponses(_req, res, next) {
  const sendJson = res.json.bind(res);
  res.json = (body) => sendJson(stripSensitiveFields(body));
  next();
}
