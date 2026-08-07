import { randomUUID } from 'crypto';

/**
 * Generate a unique identifier using crypto.randomUUID()
 */
export function generateId(prefix?: string): string {
  const id = randomUUID();
  return prefix ? `${prefix}_${id}` : id;
}
