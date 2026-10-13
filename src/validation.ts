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
  for (const slot of [s.json, s.json.input]) {
    if (!slot) continue
    if (
      typeof slot.serialize !== 'function' ||
      typeof slot.parse !== 'function'
    ) {
      throw new TypeError(
        'serializer slots require serialize and parse functions',
      )
    }
    if (slot.binary !== undefined && typeof slot.binary !== 'boolean')
      throw new TypeError('binary must be boolean')
    if (slot.contentType !== undefined)
      new Headers({ 'content-type': slot.contentType })
  }
  if (s.json?.input && !['preserve', 'json'].includes(s.json.input.output)) {
    throw new TypeError('json.input.output must be preserve or json')
  }
  if (
    s.json?.output !== undefined &&
    !['preserve', 'json', 'unknown'].includes(s.json.output)
  ) {
    throw new TypeError('json.output must be preserve, json, or unknown')
  }
}
