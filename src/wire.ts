import type { JsonSerializer, WireBody, WireSerializer } from './types'

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
export const resolve = (codec: WireSerializer<never>): Resolved => ({
  serialize: codec.serialize,
  parse: codec.parse,
  binary: codec.binary === true,
  contentType:
    codec.contentType ??
    (codec.binary ? BINARY_CONTENT_TYPE : DEFAULT_JSON_CONTENT_TYPE),
})
export const resolveInput = (codec: JsonSerializer): Resolved | undefined =>
  codec.input == null ? undefined : resolve(codec.input)

export function encode(codec: Resolved, value: unknown): WireBody {
  const body: unknown = codec.serialize(value as never)
  if (codec.binary) {
    if (!(body instanceof Uint8Array) && !(body instanceof ArrayBuffer)) {
      throw new TypeError(
        'binary codec serialize() must return Uint8Array or ArrayBuffer',
      )
    }
  } else if (typeof body !== 'string') {
    throw new TypeError(
      'codec serialize() must return a string; use binary: true for bytes',
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
