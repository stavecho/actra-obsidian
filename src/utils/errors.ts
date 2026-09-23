export class ActraError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retryable = false
  ) {
    super(message);
    this.name = "ActraError";
  }
}

export function messageFromUnknown(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function safeUserError(error: unknown): string {
  const message = messageFromUnknown(error);
  return message
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [已隐藏]")
    .replace(/\b\d{6}\b/g, "[配对码已隐藏]")
    .slice(0, 240);
}
