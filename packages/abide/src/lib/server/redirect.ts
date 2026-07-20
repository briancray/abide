// Redirect response helper (rpc-core §4). Sets Location and a 3xx status (default 302).

export function redirect(url: string, status: 301 | 302 | 303 | 307 | 308 = 302, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers);
  headers.set("location", url);
  return new Response(null, { ...init, status, headers });
}
