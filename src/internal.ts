import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { Serializer } from './types'
import { encode, outputHeader, type Resolved } from './wire'
import { validateSerializer } from './validation'
export * from './wire'

const CONTEXT_KEY = 'hono-serialization'
export type Active = { serializer: Serializer; header: string }
export const getActive = (c: Context): Active | undefined =>
  c.get(CONTEXT_KEY) as Active | undefined
export const setActive = (c: Context, active: Active): void => {
  c.set(CONTEXT_KEY, active)
}

export function lookup(
  serializers: Serializer | readonly Serializer[],
): Map<string, Serializer> {
  const list: readonly Serializer[] = Array.isArray(serializers)
    ? serializers
    : [serializers as Serializer]
  if (!list.length)
    throw new TypeError('serialization: at least one serializer is required')
  const byName = new Map<string, Serializer>()
  for (const s of list) {
    validateSerializer(s)
    if (byName.has(s.name))
      throw new TypeError(`serialization: duplicate name "${s.name}"`)
    byName.set(s.name, s)
  }
  return byName
}
export type HeaderRecord = Record<string, string | string[]>
export type ResponseOptions<
  U extends ContentfulStatusCode = ContentfulStatusCode,
> = Omit<ResponseInit, 'status'> & { status?: U }
export function appendHeader(
  headers: Headers,
  key: string,
  value: string,
): void {
  const parts = (headers.get(key) ?? '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
  if (
    !parts.some((p) => p.toLowerCase() === value.toLowerCase()) &&
    !(key.toLowerCase() === 'vary' && parts.includes('*'))
  )
    parts.push(value)
  headers.set(key, parts.join(', '))
}
export const sendEncoded = (
  c: Context,
  value: unknown,
  arg: ContentfulStatusCode | ResponseOptions | undefined,
  headers: HeaderRecord | undefined,
  slot: Resolved,
  header: string,
  serializer: Serializer,
): Response => {
  const body = encode(slot, value)
  const payload = body instanceof Uint8Array ? new Uint8Array(body) : body
  const res =
    typeof arg === 'object'
      ? c.newResponse(payload, arg)
      : c.newResponse(payload, arg, headers)
  if (typeof arg === 'object' && headers) {
    for (const [key, value] of Object.entries(headers)) {
      res.headers.delete(key)
      for (const item of typeof value === 'string' ? [value] : value)
        res.headers.append(key, item)
    }
  }
  if (slot.contentType) res.headers.set('Content-Type', slot.contentType)
  res.headers.set(header, serializer.name)
  res.headers.set(outputHeader(header), serializer.json.output ?? 'unknown')
  appendHeader(res.headers, 'Access-Control-Expose-Headers', header)
  appendHeader(
    res.headers,
    'Access-Control-Expose-Headers',
    outputHeader(header),
  )
  return res
}
