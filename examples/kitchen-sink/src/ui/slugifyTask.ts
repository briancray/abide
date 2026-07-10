/*
Turns a recipe's task sentence into a stable, URL-safe anchor id. Recipe.abide
stamps this onto each recipe's <article id>, and scripts/cookbookIndex.ts derives
the same slug for the search index — so a filter hit deep-links to href#anchor. No
per-subpage task collides (verified), so the raw slug is unique within its page.
*/
export function slugifyTask(task: string): string {
    return task
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
}
