// Prints a block of chrome (banner/footer) with its trailing newline stripped,
// or nothing when the text is blank. Shared by the help, banner, and session
// footer so the trim-and-skip idiom lives in one place.
export function printTrimmed(text: string): void {
    if (text.trim()) {
        console.log(text.replace(/\n$/, ''))
    }
}
