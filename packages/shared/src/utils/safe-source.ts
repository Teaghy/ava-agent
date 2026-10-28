export function safeSource(source?: string): string | undefined {
  if (!source) return undefined;
  try {
    const url = new URL(source);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}
