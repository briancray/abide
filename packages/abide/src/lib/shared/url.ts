// url() — isomorphic in-app href builder. Fills a page path's dynamic segments (`[name]` or
// `:name`) from `params` and returns the resolved path. Throws when a required param is missing so
// a broken link fails loudly at build time rather than producing a malformed URL.

export function url(path: string, params?: Record<string, string | number>): string {
  return path.replace(/\[([^\]]+)\]|:([A-Za-z0-9_]+)/g, (_match, bracketName?: string, colonName?: string) => {
    const name = bracketName ?? colonName!;
    const value = params?.[name];
    if (value === undefined) {
      throw new Error(`url(): missing param "${name}" for path "${path}".`);
    }
    return encodeURIComponent(String(value));
  });
}
