import type { Serializer } from './types'

export function validateSerializer(s: Serializer): void {
  if (
    typeof s.name !== 'string' ||
    !s.name ||
    s.name.trim() !== s.name ||
    /[^\x21-\x7e]/.test(s.name)
  ) {
    throw new TypeError(
      'defineSerializer: name must be a non-empty printable header value without surrounding whitespace',
    )
  }
  if (!s.json) {
    throw new TypeError('defineSerializer: json codec is required')
  }
  for (const key of Object.keys(s)) {
    if (key !== 'name' && key !== 'json') {
      throw new TypeError(`defineSerializer: unsupported field "${key}"`)
    }
  }
  for (const codec of [s.json, s.json.input]) {
    if (!codec) continue
    if (
      typeof codec.serialize !== 'function' ||
      typeof codec.parse !== 'function'
    ) {
      throw new TypeError('codecs require serialize and parse functions')
    }
    if (codec.binary !== undefined && typeof codec.binary !== 'boolean')
      throw new TypeError('binary must be boolean')
    if (codec.contentType !== undefined)
      new Headers({ 'content-type': codec.contentType })
  }
  if (
    s.json.input &&
    !['preserve', 'json-parsed'].includes(s.json.input.types ?? 'preserve')
  ) {
    throw new TypeError('json.input.types must be preserve or json-parsed')
  }
  if (
    s.json.types !== undefined &&
    !['preserve', 'json-parsed', 'unknown'].includes(s.json.types)
  ) {
    throw new TypeError('json.types must be preserve, json-parsed, or unknown')
  }
}
