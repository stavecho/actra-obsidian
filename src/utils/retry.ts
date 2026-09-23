import { ActraError } from "./errors";

export async function withRetry<T>(operation: () => Promise<T>, maxAttempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const retryable = error instanceof ActraError && error.retryable;
      if (!retryable || attempt === maxAttempts) throw error;
      const base = 250 * 2 ** (attempt - 1);
      const jitter = Math.floor(Math.random() * 150);
      await new Promise((resolve) => window.setTimeout(resolve, base + jitter));
    }
  }
  throw lastError;
}
