import { TCK, TRK, TRX, TT, AnyNumberArray } from './nvmesh-types.js'
import { NVUtilities, Zip } from './nvutilities.js'
import { mat4, vec4, vec3 } from 'gl-matrix'
import { log } from './logger.js'

// read mrtrix tck format streamlines
// https://mrtrix.readthedocs.io/en/latest/getting_started/image_data.html#tracks-file-format-tck
export function readTCK(buffer: ArrayBuffer): TCK {
  const len = buffer.byteLength
  if (len < 20) {
    throw new Error('File too small to be TCK: bytes = ' + len)
  }
  const bytes = new Uint8Array(buffer)
  let pos = 0
  function readStr(): string {
    while (pos < len && bytes[pos] === 10) {
      pos++
    } // skip blank lines
    const startPos = pos
    while (pos < len && bytes[pos] !== 10) {
      pos++
    }
    pos++ // skip EOLN
    if (pos - startPos < 1) {
      return ''
    }
    return new TextDecoder().decode(buffer.slice(startPos, pos - 1))
  }
  let line = readStr() // 1st line: signature 'mrtrix tracks'
  if (!line.includes('mrtrix tracks')) {
    throw new Error('Not a valid TCK file')
  }
  let offset = -1 // "file: offset" is REQUIRED
  while (pos < len && !line.includes('END')) {
    line = readStr()
    if (line.toLowerCase().startsWith('file:')) {
      offset = parseInt(line.split(' ').pop()!)
    }
  }
  if (offset < 20) {
    throw new Error('Not a valid TCK file (missing file offset)')
  }
  pos = offset
  const reader = new DataView(buffer)
  // read and transform vertex positions
  let npt = 0
  // over-provision offset array to store number of segments
  let offsetPt0 = new Uint32Array(len / (4 * 4))
  let noffset = 0
  // over-provision points array to store vertex positions
  let npt3 = 0
  let pts = new Float32Array(len / 4)
  offsetPt0[0] = 0 // 1st streamline starts at 0
  while (pos + 12 < len) {
    const ptx = reader.getFloat32(pos, true)
    pos += 4
    const pty = reader.getFloat32(pos, true)
    pos += 4
    const ptz = reader.getFloat32(pos, true)
    pos += 4
    if (!isFinite(ptx)) {
      // both NaN and Infinity are not finite
      offsetPt0[noffset++] = npt
      if (!isNaN(ptx)) {
        // terminate if infinity
        break
      }
    } else {
      pts[npt3++] = ptx
      pts[npt3++] = pty
      pts[npt3++] = ptz
      npt++
    }
  }
  // resize offset/vertex arrays that were initially over-provisioned
  pts = pts.slice(0, npt3)
  offsetPt0 = offsetPt0.slice(0, noffset)
  return {
    pts,
    offsetPt0
  }
} // readTCK()

// not included in public docs
// read trackvis trk format streamlines
// http://trackvis.org/docs/?subsect=fileformat
export async function readTRK(buffer: ArrayBuffer): Promise<TRK> {
  // https://brain.labsolver.org/hcp_trk_atlas.html
  // https://github.com/xtk/X/tree/master/io
  // in practice, always little endian
  let reader = new DataView(buffer)
  let magic = reader.getUint32(0, true) // 'TRAC'
  if (magic !== 1128354388) {
    // e.g. TRK.gz
    let raw
    if (magic === 4247762216) {
      // e.g. TRK.zstd
      // raw = fzstd.decompress(new Uint8Array(buffer));
      // raw = new Uint8Array(raw);
      throw new Error('zstd TRK decompression is not supported')
    } else {
      raw = await NVUtilities.decompress(new Uint8Array(buffer))
    }
    buffer = raw.buffer
    reader = new DataView(buffer)
    magic = reader.getUint32(0, true) // 'TRAC'
  }
  const vers = reader.getUint32(992, true) // 2
  const hdr_sz = reader.getUint32(996, true) // 1000
  if (vers > 2 || hdr_sz !== 1000 || magic !== 1128354388) {
    throw new Error('Not a valid TRK file')
  }
  const n_scalars = reader.getInt16(36, true)
  const dpv = []
  // data_per_vertex
  for (let i = 0; i < n_scalars; i++) {
    const arr = new Uint8Array(buffer.slice(38 + i * 20, 58 + i * 20))
    const str = new TextDecoder().decode(arr).split('\0').shift()
    dpv.push({
      id: str!.trim(), // TODO can we guarantee this?
      vals: [] as number[]
    })
  }
  const voxel_sizeX = reader.getFloat32(12, true)
  const voxel_sizeY = reader.getFloat32(16, true)
  const voxel_sizeZ = reader.getFloat32(20, true)
  const zoomMat = mat4.fromValues(
    1 / voxel_sizeX,
    0,
    0,
    -0.5,
    0,
    1 / voxel_sizeY,
    0,
    -0.5,
    0,
    0,
    1 / voxel_sizeZ,
    -0.5,
    0,
    0,
    0,
    1
  )
  const n_properties = reader.getInt16(238, true)
  const dps = []
  // data_per_streamline
  for (let i = 0; i < n_properties; i++) {
    const arr = new Uint8Array(buffer.slice(240 + i * 20, 260 + i * 20))
    const str = new TextDecoder().decode(arr).split('\0').shift()
    dps.push({
      id: str!.trim(), // TODO can we guarantee this?
      vals: [] as number[]
    })
  }
  const mat = mat4.create()
  for (let i = 0; i < 16; i++) {
    mat[i] = reader.getFloat32(440 + i * 4, true)
  }
  if (mat[15] === 0.0) {
    // vox_to_ras[3][3] is 0, it means the matrix is not recorded
    log.warn('TRK vox_to_ras not set')
    mat4.identity(mat)
  }
  const vox2mmMat = mat4.create()
  mat4.mul(vox2mmMat, zoomMat, mat)
  let i32 = null
  let f32 = null
  i32 = new Int32Array(buffer.slice(hdr_sz))
  f32 = new Float32Array(i32.buffer)
  const ntracks = i32.length
  if (ntracks < 1) {
    throw new Error('Empty TRK file.')
  }
  // read and transform vertex positions
  let i = 0
  let npt = 0
  // pre-allocate and over-provision offset array
  let offsetPt0 = new Uint32Array(i32.length / 4)
  let noffset = 0
  // pre-allocate and over-provision vertex positions array
  let pts = new Float32Array(i32.length)
  let npt3 = 0
  while (i < ntracks) {
    const n_pts = i32[i]
    i = i + 1 // read 1 32-bit integer for number of points in this streamline
    offsetPt0[noffset++] = npt
    for (let j = 0; j < n_pts; j++) {
      const ptx = f32[i + 0]
      const pty = f32[i + 1]
      const ptz = f32[i + 2]
      i += 3 // read 3 32-bit floats for XYZ position
      pts[npt3++] = ptx * vox2mmMat[0] + pty * vox2mmMat[1] + ptz * vox2mmMat[2] + vox2mmMat[3]
      pts[npt3++] = ptx * vox2mmMat[4] + pty * vox2mmMat[5] + ptz * vox2mmMat[6] + vox2mmMat[7]
      pts[npt3++] = ptx * vox2mmMat[8] + pty * vox2mmMat[9] + ptz * vox2mmMat[10] + vox2mmMat[11]
      if (n_scalars > 0) {
        for (let s = 0; s < n_scalars; s++) {
          dpv[s].vals.push(f32[i])
          i++
        }
      }
      npt++
    } // for j: each point in streamline
    if (n_properties > 0) {
      for (let j = 0; j < n_properties; j++) {
        dps[j].vals.push(f32[i])
        i++
      }
    }
  } // for each streamline: while i < n_count
  // output uses static float32 not dynamic number[]
  const dps32 = []
  // data_per_streamline
  for (let i = 0; i < dps.length; i++) {
    dps32.push({
      id: dps[i].id,
      vals: Float32Array.from(dps[i].vals)
    })
  }
  const dpv32 = []
  for (let i = 0; i < dpv.length; i++) {
    dpv32.push({
      id: dpv[i].id,
      vals: Float32Array.from(dpv[i].vals)
    })
  }
  // add 'first index' as if one more line was added (fence post problem)
  offsetPt0[noffset++] = npt
  // resize offset/vertex arrays that were initially over-provisioned
  pts = pts.slice(0, npt3)
  offsetPt0 = offsetPt0.slice(0, noffset)
  return {
    pts,
    offsetPt0,
    dps: dps32,
    dpv: dpv32
  }
} // readTRK()

// read TRX format tractogram
// https://github.com/tee-ar-ex/trx-spec/blob/master/specifications.md

export async function readTRX(buffer: ArrayBuffer): Promise<TRX> {
  // Javascript does not support float16, so we convert to float32
  // https://stackoverflow.com/questions/5678432/decompressing-half-precision-floats-in-javascript
  function decodeFloat16(binary: number): number {
    'use strict'
    const exponent = (binary & 0x7c00) >> 10
    const fraction = binary & 0x03ff
    return (
      (binary >> 15 ? -1 : 1) *
      (exponent
        ? exponent === 0x1f
          ? fraction
            ? NaN
            : Infinity
          : Math.pow(2, exponent - 15) * (1 + fraction / 0x400)
        : 6.103515625e-5 * (fraction / 0x400))
    )
  } // decodeFloat16()
  let noff = 0
  let npt = 0
  let pts: Float32Array
  let offsetPt0: Uint32Array // number[] = []
  const dpg = []
  const dps = []
  const dpv = []
  let header = []
  let isOverflowUint64 = false
  const zip = new Zip(buffer)
  for (let i = 0; i < zip.entries.length; i++) {
    const entry = zip.entries[i]
    if (entry.uncompressedSize === 0) {
      continue // e.g. folder
    }
    const parts = entry.fileName.split('/')
    const fname = parts.slice(-1)[0] // my.trx/dpv/fx.float32 -> fx.float32
    if (fname.startsWith('.')) {
      continue
    }
    const pname = parts.slice(-2)[0] // my.trx/dpv/fx.float32 -> dpv
    const tag = fname.split('.')[0] // "positions.3.float16 -> "positions"
    const data = await entry.extract()
    // const data = await NVUtilities.zipInflate(buffer, entry.startsAt, entry.compressedSize, entry.uncompressedSize, entry.compressionMethod )
    // console.log(`entry ${pname}  ${fname}  ${tag} : ${data.length}`)
    if (fname.includes('header.json')) {
      header = JSON.parse(new TextDecoder().decode(data))
      continue
    }
    // next read arrays for all possible datatypes: int8/16/32/64 uint8/16/32/64 float16/32/64
    let nval = 0
    let vals: AnyNumberArray = []
    if (fname.endsWith('.uint64') || fname.endsWith('.int64')) {
      // javascript does not have 64-bit integers! read lower 32-bits
      // note for signed int64 we only read unsigned bytes
      // for both signed and unsigned, generate an error if any value is out of bounds
      // one alternative might be to convert to 64-bit double that has a flintmax of 2^53.
      nval = data.length / 8 // 8 bytes per 64bit input
      vals = new Uint32Array(nval)
      const u32 = new Uint32Array(data.buffer)
      let j = 0
      for (let i = 0; i < nval; i++) {
        vals[i] = u32[j]
        if (u32[j + 1] !== 0) {
          isOverflowUint64 = true
        }
        j += 2
      }
    } else if (fname.endsWith('.uint32')) {
      vals = new Uint32Array(data.buffer)
    } else if (fname.endsWith('.uint16')) {
      vals = new Uint16Array(data.buffer)
    } else if (fname.endsWith('.uint8')) {
      vals = new Uint8Array(data.buffer)
    } else if (fname.endsWith('.int32')) {
      vals = new Int32Array(data.buffer)
    } else if (fname.endsWith('.int16')) {
      vals = new Int16Array(data.buffer)
    } else if (fname.endsWith('.int8')) {
      vals = new Int8Array(data.buffer)
    } else if (fname.endsWith('.float64')) {
      vals = new Float64Array(data.buffer)
    } else if (fname.endsWith('.float32')) {
      vals = new Float32Array(data.buffer)
    } else if (fname.endsWith('.float16')) {
      // javascript does not have 16-bit floats! Convert to 32-bits
      nval = data.length / 2 // 2 bytes per 16bit input
      vals = new Float32Array(nval)
      const u16 = new Uint16Array(data.buffer)
      const lut = new Float32Array(65536)
      for (let i = 0; i < 65536; i++) {
        lut[i] = decodeFloat16(i)
      }
      for (let i = 0; i < nval; i++) {
        vals[i] = lut[u16[i]]
      }
    } else {
      continue
    } // not a data array
    nval = vals.length
    // next: read data_per_group
    if (pname.includes('groups')) {
      dpg.push({
        id: tag,
        vals: Float32Array.from(vals.slice())
      })
      continue
    }
    // next: read data_per_vertex
    if (pname.includes('dpv')) {
      dpv.push({
        id: tag,
        vals: Float32Array.from(vals.slice())
      })
      continue
    }
    // next: read data_per_streamline
    if (pname.includes('dps')) {
      dps.push({
        id: tag,
        vals: Float32Array.from(vals.slice())
      })
      continue
    }
    if (fname.startsWith('offsets.')) {
      noff = nval // 8 bytes per 64bit input
      offsetPt0 = new Uint32Array(vals.buffer)
    }
    if (fname.startsWith('positions.3.')) {
      npt = nval // 4 bytes per 32bit input
      pts = new Float32Array(vals.buffer)
    }
  }
  if (noff === 0 || npt === 0) {
    throw new Error('Failure reading TRX format (no offsets or points).')
  }
  if (isOverflowUint64) {
    // TODO use BigInt
    throw new Error('Too many vertices: JavaScript does not support 64 bit integers')
  }
  offsetPt0[noff] = npt / 3 // solve fence post problem, offset for final streamline
  return {
    pts,
    offsetPt0,
    dpg,
    dps,
    dpv,
    header
  }
} // readTRX()

// https://dsi-studio.labsolver.org/doc/cli_data.html
// https://brain.labsolver.org/hcp_trk_atlas.html
export async function readTT(buffer: ArrayBuffer): Promise<TT> {
  // Read a Matlab V4 file, n.b. does not support modern versions
  // https://www.mathworks.com/help/pdf_doc/matlab/matfile_format.pdf
  let offsetPt0 = new Uint32Array(0)
  let pts = new Float32Array(0)
  const mat = await NVUtilities.readMatV4(buffer)
  if (!('trans_to_mni' in mat)) {
    throw new Error("TT format file must have 'trans_to_mni'")
  }
  if (!('voxel_size' in mat)) {
    throw new Error("TT format file must have 'voxel_size'")
  }
  if (!('track' in mat)) {
    throw new Error("TT format file must have 'track'")
  }
  let trans_to_mni = mat4.create()
  const m = mat.trans_to_mni
  trans_to_mni = mat4.fromValues(
    m[0],
    m[1],
    m[2],
    m[3],
    m[4],
    m[5],
    m[6],
    m[7],
    m[8],
    m[9],
    m[10],
    m[11],
    m[12],
    m[13],
    m[14],
    m[15]
  )
  mat4.transpose(trans_to_mni, trans_to_mni)
  // unlike TRK, TT uses voxel centers, not voxel corners
  function parse_tt(
    track: Float64Array | Float32Array | Uint32Array | Uint16Array | Uint8Array | Int32Array | Int16Array | Int8Array
  ): void {
    const dv = new DataView(track.buffer)
    const pos = []
    let nvert3 = 0
    for (let i = 0; i < track.length; ) {
      pos.push(i)
      const newpts = dv.getUint32(i, true)
      i = i + newpts + 13
      nvert3 += newpts
    }
    offsetPt0 = new Uint32Array(pos.length + 1)
    pts = new Float32Array(nvert3)
    let npt = 0
    for (let i = 0; i < pos.length; i++) {
      offsetPt0[i] = npt / 3
      let p = pos[i]
      const sz = dv.getUint32(p, true) / 3
      let x = dv.getInt32(p + 4, true)
      let y = dv.getInt32(p + 8, true)
      let z = dv.getInt32(p + 12, true)
      p += 16
      pts[npt++] = x
      pts[npt++] = y
      pts[npt++] = z
      for (let j = 2; j <= sz; j++) {
        x = x + dv.getInt8(p++)
        y = y + dv.getInt8(p++)
        z = z + dv.getInt8(p++)
        pts[npt++] = x
        pts[npt++] = y
        pts[npt++] = z
      }
    } // for each streamline
    for (let i = 0; i < npt; i++) {
      pts[i] = pts[i] / 32.0
    }
    for (let v = 0; v < npt; v += 3) {
      const x = pts[v],
        y = pts[v + 1],
        z = pts[v + 2]
      pts[v] = trans_to_mni[0] * x + trans_to_mni[4] * y + trans_to_mni[8] * z + trans_to_mni[12]
      pts[v + 1] = trans_to_mni[1] * x + trans_to_mni[5] * y + trans_to_mni[9] * z + trans_to_mni[13]
      pts[v + 2] = trans_to_mni[2] * x + trans_to_mni[6] * y + trans_to_mni[10] * z + trans_to_mni[14]
    }
    offsetPt0[pos.length] = npt / 3 // solve fence post problem, offset for final streamline
  } // parse_tt()
  parse_tt(mat.track)
  return {
    pts,
    offsetPt0
  }
} //readTT
