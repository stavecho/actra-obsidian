export function createId(prefix: string): string {
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  const suffix = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  return `${prefix}_${suffix}`;
}
