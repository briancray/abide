import { POST } from 'abide/server'

/**
 * A form anyone could post is a call, exactly as a URL anyone could type is.
 *
 * Nothing here opens a form door. The entries of a `multipart/form-data` or an
 * `application/x-www-form-urlencoded` body are read ONE ENTRY PER ARGUMENT by the same reader a
 * read's query goes through, so the declared shape below is what turns the text `36` into a number,
 * the same name twice into a list, and a value it refuses into the 422 every other door answers with.
 *
 * Which of the two spellings arrived is not something this side can see — `Request.formData()` reads
 * both into the same entries — and the only difference between them is that a file can ride in one.
 *
 * Every field is OPTIONAL because that is what a form sends: a browser omits an empty file input and
 * an unchecked box entirely, so a shape requiring them would refuse a submission nobody got wrong.
 * The refusal that matters is still here — `age=thirty six` is a `number` the shape cannot read.
 */
export const enrol = POST(
    async ({
        name = 'nobody',
        age = 0,
        tags = [],
        avatar,
    }: {
        name?: string
        age?: number
        tags?: string[]
        avatar?: File
    }) => ({
        name,
        age,
        tags,
        // The declared shape's work, as a value a reader can see: the entry was the TEXT `36`.
        isNumber: typeof age === 'number',
        avatar: avatar === undefined ? null : { name: avatar.name, bytes: avatar.size },
    }),
)
