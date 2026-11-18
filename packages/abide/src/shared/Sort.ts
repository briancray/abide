/** Which column a table is sorted by, and which way: the direction is the `aria-sort` value it writes. */
export type Sort = { key: string; direction: 'ascending' | 'descending' }
