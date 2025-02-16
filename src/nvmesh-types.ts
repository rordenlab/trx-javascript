export type ValuesArray = Array<{
  id: string
  vals: Float32Array
  global_min?: number
  global_max?: number
  cal_min?: number
  cal_max?: number
}>

export type AnyNumberArray =
  | number[]
  | Float64Array
  | Float32Array
  | Uint32Array
  | Uint16Array
  | Uint8Array
  | Int32Array
  | Int16Array
  | Int8Array

export type TT = {
  pts: Float32Array
  offsetPt0: Uint32Array
}

export type TRX = {
  pts: Float32Array
  offsetPt0: Uint32Array
  dpg: ValuesArray
  dps: ValuesArray
  dpv: ValuesArray
  header: unknown
}

export type TRK = {
  pts: Float32Array
  offsetPt0: Uint32Array
  dps: ValuesArray
  dpv: ValuesArray
}

export type TCK = {
  pts: Float32Array
  offsetPt0: Uint32Array
}
