/*
For a route key like "posts/[id]/comments" returns the directory prefixes
from root to leaf: ["", "posts", "posts/[id]"]. The leaf segment itself
(the route file's basename) is dropped. Used to walk layout chains.
*/
export function routePrefixes(route: string): string[] {
    const segments = route.split('/').slice(0, -1)
    return ['', ...segments.map((_, i) => segments.slice(0, i + 1).join('/'))]
}
