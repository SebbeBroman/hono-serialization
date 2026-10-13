import type { Serializer, WireBody, WireSerializer } from './types'

export const DEFAULT_HEADER = 'x-hono-serialization'
export const DEFAULT_JSON_CONTENT_TYPE = 'application/json; charset=UTF-8'
export const BINARY_CONTENT_TYPE = 'application/octet-stream'
export const outputHeader = (header: string) => `${header}-output`
export type Resolved = {
  serialize: (value: never) => WireBody
  parse: (data: never) => unknown
  binary: boolean
  contentType: string | undefined
}
export const resolve = (
  slot: WireSerializer<never>,
  fallback: string | undefined,
): Resolved => ({
  serialize: slot.serialize,
  parse: slot.parse,
  binary: slot.binary === true,
  contentType:
    slot.contentType ?? (slot.binary ? BINARY_CONTENT_TYPE : fallback),
})
export const resolveInput = (slot: Serializer['json']): Resolved | undefined =>
  slot?.input == null
    ? undefined
    : resolve(slot.input, DEFAULT_JSON_CONTENT_TYPE)

export function encode(slot: Resolved, value: unknown): WireBody {
  const body: unknown = slot.serialize(value as never)
  if (slot.binary) {
    if (!(body instanceof Uint8Array) && !(body instanceof ArrayBuffer)) {
      throw new TypeError(
        'binary serializer serialize() must return Uint8Array or ArrayBuffer',
      )
    }
  } else if (typeof body !== 'string') {
    throw new TypeError(
      'json serializer serialize() must return a string; use binary: true for bytes',
    )
  }
  return body as WireBody
}

export function validateHeader(header: string): void {
  new Headers({
    [header]: 'test',
    [outputHeader(header)]: 'preserve',
  })
  if (
    [
      'content-type',
      'content-length',
      'vary',
      'access-control-expose-headers',
    ].includes(header.toLowerCase())
  ) {
    throw new TypeError(
      'serialization header conflicts with an HTTP protocol header',
    )
  }
}
