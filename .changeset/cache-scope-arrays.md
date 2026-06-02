---
"@briancray/belte": minor
---

`cache()`'s `scope` option now accepts an array of tags, not just a single tag, so a call can join multiple invalidation groups (`scope: ['media', 'sources']`). `cache.invalidate({ scope })` drops every entry sharing any of the requested tags, and a re-read merges new tags into an entry rather than replacing them.
</content>
</invoke>
