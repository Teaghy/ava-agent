/** Response-only filtering: never rewrite the durable audit trail. */
export function redactTrace(value: unknown, secrets: string[] = [], depth = 0): unknown {
  if (depth > 12) return '[内容层级已截断]';
  if (typeof value === 'string') {
    let text = value;
    for (const secret of secrets) if (secret) text = text.replaceAll(secret, '[REDACTED]');
    text = text
      .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 [REDACTED]')
      .replace(/([?&](?:api[_-]?key|token|password|secret)=)[^&#\s]+/gi, '$1[REDACTED]')
      .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[REDACTED]@');
    return text.length > 16000 ? text.slice(0, 16000) + '\n[内容已截断]' : text;
  }
  if (Array.isArray(value)) {
    const items = value.slice(0, 100).map((v) => redactTrace(v, secrets, depth + 1));
    if (value.length > 100) items.push('[其余条目已截断]');
    return items;
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 100)
        .map(([key, item]) => [
          key,
          /password|secret|apikey|authorization|cookie|credential|accesstoken|refreshtoken|^token$|reasoning|chainofthought/i.test(
            key.replace(/[_-]/g, ''),
          )
            ? '[REDACTED]'
            : redactTrace(item, secrets, depth + 1),
        ]),
    );
  }
  return value;
}
