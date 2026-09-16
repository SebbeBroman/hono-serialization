import type { Context } from 'hono'
import type { ContentfulStatusCode, StatusCode } from 'hono/utils/http-status'
import type { FormatSerializer, Serializer, WireSerializer } from './types'

export const DEFAULT_HEADER = 'x-hono-serialization'
export const DEFAULT_JSON_CONTENT_TYPE = 'application/json; charset=UTF-8'
export const DEFAULT_TEXT_CONTENT_TYPE = 'text/plain; charset=UTF-8'
export const DEFAULT_HTML_CONTENT_TYPE = 'text/html; charset=UTF-8'
export const BINARY_CONTENT_TYPE = 'application/octet-stream'

const CONTEXT_KEY = 'hono-serialization'

export type Active = { serializer: Serializer; header: string }

export const getActive = (c: Context): Active | undefined =>
  c.get(CONTEXT_KEY) as Active | undefined

export const setActive = (c: Context, active: Active): void => {
  c.set(CONTEXT_KEY, active)
}

export type Resolved = {
  serialize: WireSerializer['serialize']
  parse: WireSerializer['parse']
  binary: boolean
  contentType: string | undefined
}

const isBinarySlot = (slot: Pick<WireSerializer, 'binary' | 'contentType'>): boolean =>
  slot.binary === true ||
  (slot.contentType != null && /octet-stream|cbor|msgpack/i.test(slot.contentType))

export const resolve = (
  slot: WireSerializer,
  fallback: string | undefined,
): Resolved => ({
  serialize: slot.serialize,
  parse: slot.parse,
  binary: isBinarySlot(slot),
  contentType: slot.contentType ?? (isBinarySlot(slot) ? BINARY_CONTENT_TYPE : fallback),
})

export const resolveInput = (slot: FormatSerializer | undefined): Resolved | undefined =>
  slot?.input == null ? undefined : resolve(slot.input, slot.input.contentType)

const mimeOf = (contentType: string): string =>
  contentType.split(';')[0]?.trim().toLowerCase() ?? ''

export const isJsonCt = (ct: string): boolean => {
  const m = mimeOf(ct)
  return m === 'application/json' || m.endsWith('+json')
}

export const isHtmlCt = (ct: string): boolean => {
  const m = mimeOf(ct)
  return m === 'text/html' || m.endsWith('+html')
}

export const toBytes = (body: ArrayBuffer | Uint8Array): Uint8Array =>
  body instanceof Uint8Array ? body : new Uint8Array(body)

export const lookup = (
  serializers: Serializer | readonly Serializer[],
): Map<string, Serializer> => {
  const list = Array.isArray(serializers) ? [...serializers] : [serializers]
  if (list.length === 0) throw new TypeError('serialization: at least one serializer is required')
  const byName = new Map<string, Serializer>()
  for (const s of list) {
    if (byName.has(s.name)) throw new TypeError(`serialization: duplicate name "${s.name}"`)
    byName.set(s.name, s)
  }
  return byName
}

export type HeaderRecord = Record<string, string | string[]>

export const sendEncoded = (
  c: Context,
  value: unknown,
  arg: StatusCode | ResponseInit | undefined,
  headers: HeaderRecord | undefined,
  slot: Resolved,
  header: string,
  name: string,
): Response => {
  const body = slot.serialize(value)
  const binary = slot.binary || typeof body !== 'string'
  if (!binary && typeof body !== 'string') {
    throw new TypeError('serializer serialize() must return a string')
  }
  if (binary && typeof body === 'string') {
    throw new TypeError('binary serializer serialize() must return Uint8Array or ArrayBuffer')
  }
  c.header(header, name)
  c.header('Access-Control-Expose-Headers', header, { append: true })
  const payload = typeof body === 'string' || body instanceof ArrayBuffer ? body : new Uint8Array(body)
  return c.body(payload, arg as ContentfulStatusCode, {
    ...(slot.contentType != null ? { 'Content-Type': slot.contentType } : {}),
    ...headers,
  })
}
