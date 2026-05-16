* use bun not node and prefer bun modules over node modules
* use one export per file named after the export and add to barrel files
* write svelte 5 components
* make sure you are considering the latest javascript technologies for opportunities before jumping into a solution
* always use full known types where possible instead of creating adhoc one-use types
* if a function is shared, add it to the proper utils folder and check utils folders for existing functionality before writing a utility
* run bun format on a file after changes
* always import from barrel files instead of importing directly
* use tailwindcss classes for styling, and prefer tailwind classes over style properties when possible.
* use sveltekit's $derived.by instead of $derived when making derived reactives
* always use openining and closing brackets for if statements, no single line ifsn on
* if you're transforming data, prefer tools like reduce and map over for loops when applicable
* do not start long living bun servers with `bun run dev`. When i type that it's a mistake
* use undefined instead of null for nullish values unless a type needs null
