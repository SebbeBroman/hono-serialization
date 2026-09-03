import type { Context } from 'hono'
import type { ContentfulStatusCode, StatusCode } from 'hono/utils/http-status'
import { isBinaryBody, type ResolvedSerializer } from './wire'

export type JsonArg = ContentfulStatusCode | ResponseInit
export type HeaderRecord = Record<string, string | string[]>

export const requestedSerializer = (
  c: Context,
  header: string,
): string | undefined => {
  const value = c.req.header(header)
  if (value == null || value === '') {
    return undefined
  }
  return value.trim()
}

const exposeHeader = (c: Context, name: string): void => {
  c.header('Access-Control-Expose-Headers', name, { append: true })
}

export const sendEncoded = (
  c: Context,
  value: unknown,
  arg: StatusCode | ResponseInit | undefined,
  headers: HeaderRecord | undefined,
  slot: ResolvedSerializer,
  header: string,
  name: string,
): Response => {
  const body = slot.serialize(value as never)
  const binary = slot.binary || isBinaryBody(body)
  if (!binary && typeof body !== 'string') {
    throw new TypeError('serializer serialize() must return a string')
  }
  if (binary && typeof body === 'string') {
    throw new TypeError(
      'binary serializer serialize() must return Uint8Array or ArrayBuffer',
    )
  }
  c.header(header, name)
  exposeHeader(c, header)
  const payload =
    typeof body === 'string' || body instanceof ArrayBuffer
      ? body
      : new Uint8Array(body)
  return c.body(payload, arg as ContentfulStatusCode, {
    ...(slot.contentType != null ? { 'Content-Type': slot.contentType } : {}),
    ...headers,
  })
}
