/**
 * HTTP Utilities - thread-local session parity (Node is single-threaded; fetch is async).
 * Reserved for future Undici Agent / connection pooling if needed.
 */

export class ThreadLocalSessionMixin {
  // Intentionally minimal — Python used thread-local requests.Session.
}
