import { BINARY_CONTENT_TYPE } from './constants'
import type { FormatSerializer, WireBody, WireSerializer } from './types'

export type ResolvedSerializer = {
  serialize: WireSerializer['serialize']
  parse: WireSerializer['parse']
  binary: boolean
  contentType: string | undefined
}

export const isBinaryBody = (body: WireBody): body is ArrayBuffer | Uint8Array =>
  typeof body !== 'string'

export const isTextualContentType = (contentType: string): boolean => {
  const mime = contentType.split(';')[0]?.trim().toLowerCase() ?? ''
  return (
    mime.includes('json') ||
    mime.startsWith('text/') ||
    mime === 'application/javascript' ||
    mime === 'text/javascript'
  )
}

export const isHtmlContentType = (contentType: string): boolean => {
  const mime = contentType.split(';')[0]?.trim().toLowerCase() ?? ''
  return mime === 'text/html' || mime.endsWith('+html')
}

export const isJsonContentType = (contentType: string): boolean => {
  const mime = contentType.split(';')[0]?.trim().toLowerCase() ?? ''
  return mime === 'application/json' || mime.endsWith('+json')
}

const impliedBinary = (
  slot: Pick<WireSerializer, 'binary' | 'contentType'>,
): boolean =>
  slot.binary === true ||
  (slot.contentType != null &&
    /octet-stream|cbor|msgpack/i.test(slot.contentType))

export const resolveSerializer = (
  slot: WireSerializer,
  fallbackContentType: string | undefined,
): ResolvedSerializer => {
  const binary = impliedBinary(slot)
  return {
    serialize: slot.serialize,
    parse: slot.parse,
    binary,
    contentType:
      slot.contentType ?? (binary ? BINARY_CONTENT_TYPE : fallbackContentType),
  }
}

export const resolveInput = (
  slot: FormatSerializer | undefined,
): ResolvedSerializer | undefined => {
  if (slot?.input == null) {
    return undefined
  }
  return resolveSerializer(slot.input, slot.input.contentType)
}

export const toUint8Array = (body: ArrayBuffer | Uint8Array): Uint8Array =>
  body instanceof Uint8Array ? body : new Uint8Array(body)
