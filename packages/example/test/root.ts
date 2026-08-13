// Where this app IS, for the cases that spawn it.
//
// One line, and its own file, because it is the one thing the spawn helpers cannot know: `abide-kit/spawn`
// runs a binary in a directory, and WHICH directory is a fact about the app under test. It lived in
// those helpers until they moved into the kit, where it would have been a framework package holding
// the path of one of its consumers.
export const EXAMPLE_ROOT = `${import.meta.dir}/..`
