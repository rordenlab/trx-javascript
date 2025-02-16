// n.b. NiiVue can read both meshes AND tracts stored in VTK: this is more limited

/**
 * Reads a VTK file (ASCII or Binary) and extracts streamline data (LINES).
 * @param buffer Binary buffer of the VTK file
 * @returns Parsed streamline data `{ pts, offsetPt0 }`
 */
export function readVTK(buffer: ArrayBuffer): {
  pts: Float32Array
  offsetPt0: Uint32Array
} {
  const len = buffer.byteLength
  if (len < 20) {
    throw new Error(`File too small to be VTK: bytes = ${len}`)
  }

  const bytes = new Uint8Array(buffer)
  let pos = 0
  const reader = new DataView(buffer)

  function readStr(): string {
    while (pos < len && bytes[pos] === 10) pos++ // Skip blank lines
    const startPos = pos
    while (pos < len && bytes[pos] !== 10) pos++
    pos++ // Skip newline
    return new TextDecoder().decode(buffer.slice(startPos, pos - 1)).trim()
  }

  let line = readStr()
  if (!line.startsWith('# vtk DataFile')) {
    throw new Error('Invalid VTK file')
  }
  readStr() // Ignore comment line
  line = readStr()

  if (line.startsWith('ASCII')) {
    throw new Error(`Invalid VTK file, expected ASCII or BINARY but got: ${line}`)
  } else if (!line.startsWith('BINARY')) {
    throw new Error(`Invalid VTK file, expected ASCII or BINARY but got: ${line}`)
  }

  // Read header
  line = readStr()
  if (!line.includes('POLYDATA')) {
    throw new Error('Only able to read VTK POLYDATA')
  }

  line = readStr()
  if (!line.startsWith('POINTS') || (!line.includes('double') && !line.includes('float'))) {
    throw new Error(`Only able to read VTK float or double POINTS: ${line}`)
  }

  // Determine point precision
  const isFloat64 = line.includes('double')
  const items = line.split(/\s+/)
  const nvert = parseInt(items[1])
  const nvert3 = nvert * 3
  const positions = new Float32Array(nvert3)

  // Ensure we have enough bytes in the buffer
  if (pos + (isFloat64 ? 8 : 4) * nvert3 > len) {
    throw new Error('See NiiVue for VTK ASCII support.')
  }

  for (let i = 0; i < nvert3; i++) {
    positions[i] = isFloat64 ? reader.getFloat64(pos, false) : reader.getFloat32(pos, false)
    pos += isFloat64 ? 8 : 4
  }

  // Read next dataset type
  line = readStr()
  if (!line.startsWith('LINES')) {
    throw new Error(`See NiiVue for VTK ${line} support (this library only reads LINES)`)
  }

  // Read LINES dataset
  const lineItems = line.split(/\s+/)
  const n_count = parseInt(lineItems[1])

  // Check if OFFSETS exist (e.g., VTK file format used by DiPy)
  const posOK = pos
  line = readStr()
  if (line.startsWith('OFFSETS')) {
    const isInt64 = line.includes('int64')
    const offsetPt0 = new Uint32Array(n_count)

    if (isInt64) {
      let isOverflowInt32 = false
      for (let c = 0; c < n_count; c++) {
        let idx = reader.getInt32(pos, false)
        if (idx !== 0) isOverflowInt32 = true
        pos += 4
        idx = reader.getInt32(pos, false)
        pos += 4
        offsetPt0[c] = idx
      }
      if (isOverflowInt32) {
        console.warn('int32 overflow: JavaScript does not support int64')
      }
    } else {
      for (let c = 0; c < n_count; c++) {
        offsetPt0[c] = reader.getInt32(pos, false)
        pos += 4
      }
    }

    return { pts: positions, offsetPt0 }
  }

  // Restore position for standard LINES format
  pos = posOK

  const offsetPt0 = new Uint32Array(n_count + 1)
  let pts: number[] = []
  let npt = 0

  offsetPt0[0] = 0
  for (let c = 0; c < n_count; c++) {
    if (pos + 4 > len) {
      throw new Error('Unexpected end of file when reading streamline count.')
    }

    const numPoints = reader.getInt32(pos, false)
    pos += 4
    npt += numPoints
    offsetPt0[c + 1] = npt

    for (let i = 0; i < numPoints; i++) {
      if (pos + 4 > len) {
        throw new Error('Unexpected end of file when reading streamline points.')
      }

      const idx = reader.getInt32(pos, false) * 3
      pos += 4

      if (idx + 2 >= nvert3) {
        throw new Error(`Index out of bounds: ${idx} (max ${nvert3})`)
      }

      pts.push(positions[idx], positions[idx + 1], positions[idx + 2])
    }
  }

  return { pts: new Float32Array(pts), offsetPt0 }
}
