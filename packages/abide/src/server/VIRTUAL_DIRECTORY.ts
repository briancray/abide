// Where `abide dev`'s compiled modules pretend to live, below the app's root: the compile points a
// relative import back at its source from here (34.14), and the worker serves the modules under it.
// Under the app's own root so that `#ui/…` and a bare package name resolve from here exactly as they
// resolve from the build tree — both sit inside the app's package — and under a `__abide` directory
// for the reason the addresses are: no app writes one.
export const VIRTUAL_DIRECTORY = '__abide'
