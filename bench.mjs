import * as tractVTK from './lib/vtk-loaders.js'
import * as tract from './lib/nvtract-loaders.js'
import * as fs from 'fs'
async function main() {
  let argv = process.argv.slice(2)
  let argc = argv.length
  if (argc < 1) {
    console.log("arguments required: 'node bench.mjs <filename> [-s]'")
    return
  }
  // Extract filename: first argument that does not start with "-"
  let fnm = null
  let flags = new Set()
  for (let arg of argv) {
    if (arg.startsWith('-')) {
      flags.add(arg)
    } else if (!fnm) {
      fnm = arg
    }
  }
  // Ensure a filename was found
  if (!fnm) {
    console.log('Error: No valid filename provided.')
    process.exit(1)
  }
  // Determine if silent mode is enabled
  let isSilent = flags.has('-s')
  let re = /(?:\.([^.]+))?$/
  let ext = re.exec(fnm)[1]
  ext = ext.toUpperCase()
  if (ext === 'GZ') {
    ext = re.exec(fnm.slice(0, -3))[1] // img.trk.gz -> img.trk
    ext = ext.toUpperCase()
  }
  let obj = []
  let d = Date.now()
  let nrepeats = 11 //11 iterations, ignore first
  for (let i = 0; i < nrepeats; i++) {
    if (i == 1) d = Date.now() //ignore first run for interpretting/disk
    const buf = fs.readFileSync(fnm).buffer
    if (ext === 'TCK') obj = tract.readTCK(buf)
    else if (ext === 'TT') obj = await tract.readTT(buf)
    else if (ext === 'FIB' || ext === 'VTK') obj = tractVTK.readVTK(buf)
    else if (ext === 'TRK') obj = await tract.readTRK(buf)
    else obj = await tract.readTRX(buf)
  }
  let ms = Date.now() - d
  //find file size:
  let dat = fs.readFileSync(fnm)
  console.log(`${fnm}\tSize\t${dat.length}\tTime\t${ms}`)
  if (!isSilent) {
    console.log('Vertices:' + obj.pts.length / 3)
    console.log(' First vertex (x,y,z):' + obj.pts[0] + ',' + obj.pts[1] + ',' + obj.pts[2])
    console.log('Streamlines: ' + (obj.offsetPt0.length - 1)) //-1 due to fence post
    console.log(' Vertices in first streamline: ' + (obj.offsetPt0[1] - obj.offsetPt0[0]))
    if (obj.hasOwnProperty('dpg')) {
      console.log('dpg (data_per_group) items: ' + obj.dpg.length)
      for (let i = 0; i < obj.dpg.length; i++) console.log("  '" + obj.dpg[i].id + "' items: " + obj.dpg[i].vals.length)
    }
    if (obj.hasOwnProperty('dps')) {
      console.log('dps (data_per_streamline) items: ' + obj.dps.length)
      for (let i = 0; i < obj.dps.length; i++) console.log("  '" + obj.dps[i].id + "' items: " + obj.dps[i].vals.length)
    }
    if (obj.hasOwnProperty('dpv')) {
      console.log('dpv (data_per_vertex) items: ' + obj.dpv.length)
      for (let i = 0; i < obj.dpv.length; i++) console.log("  '" + obj.dpv[i].id + "' items: " + obj.dpv[i].vals.length)
    }
    if (obj.hasOwnProperty('header')) {
      console.log('Header (header.json):')
      console.log(obj.header)
    }
  }
}
main().catch((error) => {
  console.error('Error:', error)
  process.exit(1)
})
