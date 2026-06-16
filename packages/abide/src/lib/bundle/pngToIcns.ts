import { abideLog } from '../shared/abideLog.ts'

/*
The conventional macOS `.iconset` contents — each variant is a square PNG
at the named pixel size. `iconutil` packs a directory of exactly these
into a multi-resolution `.icns`. @2x entries are the retina variants.
*/
const ICONSET_VARIANTS = [
    { name: 'icon_16x16.png', size: 16 },
    { name: 'icon_16x16@2x.png', size: 32 },
    { name: 'icon_32x32.png', size: 32 },
    { name: 'icon_32x32@2x.png', size: 64 },
    { name: 'icon_128x128.png', size: 128 },
    { name: 'icon_128x128@2x.png', size: 256 },
    { name: 'icon_256x256.png', size: 256 },
    { name: 'icon_256x256@2x.png', size: 512 },
    { name: 'icon_512x512.png', size: 512 },
    { name: 'icon_512x512@2x.png', size: 1024 },
]

/*
Converts a PNG into a macOS `.icns` using the system `sips` + `iconutil`
tools, which ship with macOS. `sips` resizes the source into each iconset
variant; `iconutil` packs the iconset directory into the `.icns`. Returns
true on success. On any failure (tools missing, unreadable source) it logs
a warning and returns false so the bundle still completes without an icon
rather than aborting the whole build.
*/
export async function pngToIcns(pngPath: string, outPath: string): Promise<boolean> {
    const iconset = `${outPath}.iconset`
    try {
        await Bun.$`mkdir -p ${iconset}`.quiet()
        await Promise.all(
            ICONSET_VARIANTS.map(({ name, size }) =>
                Bun.$`sips -z ${size} ${size} ${pngPath} --out ${`${iconset}/${name}`}`.quiet(),
            ),
        )
        await Bun.$`iconutil -c icns ${iconset} -o ${outPath}`.quiet()
        return true
    } catch (error) {
        abideLog.warn(`could not convert ${pngPath} to .icns — bundling without an icon`)
        abideLog.error(error)
        return false
    } finally {
        await Bun.$`rm -rf ${iconset}`.quiet()
    }
}
