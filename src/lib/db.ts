import "server-only";

/**
 * Database access.
 *
 * Two rules, both load-bearing:
 *
 * 1. The whole product runs with nothing configured. No DATABASE_URL means the
 *    painting still records, forms, renders and downloads -- everything but
 *    persistence is client-side anyway (PRD 12) -- and sharing falls back to a
 *    self-contained URL fragment. Every write path checks `hasDatabase` and
 *    refuses loudly rather than pretending to have saved something.
 *
 * 2. The connection is created lazily and cached on globalThis. A module-level
 *    postgres(url) throws at import time when the URL is absent, which would
 *    take the no-database mode down with it, and a fresh pool per dev-mode
 *    module reload exhausts the server's connection limit within a few edits.
 */

import postgres from "postgres";

export const hasDatabase = Boolean(process.env.DATABASE_URL);

type Sql = ReturnType<typeof postgres>;
const key = Symbol.for("impression.sql");
const store = globalThis as unknown as { [key]: Sql | undefined };

export function db(): Sql {
  if (!hasDatabase) throw new Error("DATABASE_URL is not configured");
  if (!store[key]) {
    store[key] = postgres(process.env.DATABASE_URL!, {
      // Supabase's transaction pooler (port 6543) cannot hold prepared
      // statements across a pooled connection; leaving these on produces
      // intermittent failures that only appear once there is real traffic.
      prepare: false,
      max: 4,
      idle_timeout: 20,
      connect_timeout: 10,
    });
  }
  return store[key]!;
}

/** 10 url-safe characters from the CSPRNG (PRD 8: nanoid(10)). */
export function newId(len = 10): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = "";
  // Rejection-free because 62 does not divide 256 evenly but the bias is
  // negligible at this length and these ids are not secrets. The delete token
  // is, so it uses a full 32 bytes instead.
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

export function newDeleteToken(): string {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

/** Constant-time compare, so a delete token cannot be recovered by timing. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
