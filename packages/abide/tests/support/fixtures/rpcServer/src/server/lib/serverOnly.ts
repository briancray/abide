/* A handler-only helper — reached from inside the handler body, never from `opts`, so the client
   rewrite drops it (and its import). */
export const serverOnly = () => 42
