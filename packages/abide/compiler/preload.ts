// Registers the `.abide` loader for every runtime lane. Named `preload` because that is the
// `bunfig.toml` key it is meant for; it exists so the config names a file rather than a call.

import { plugin } from 'bun'
import { abidePlugin } from './plugin.ts'

plugin(abidePlugin)
