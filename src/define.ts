import type { Serializer } from './types'

export function defineSerializer<const T extends Serializer>(serializer: T): T {
  if (serializer.name == null || serializer.name === '') {
    throw new TypeError('defineSerializer: name is required')
  }
  if (
    serializer.json == null &&
    serializer.text == null &&
    serializer.html == null &&
    serializer.body == null
  ) {
    throw new TypeError(
      'defineSerializer: at least one of json, text, html, body is required',
    )
  }
  return serializer
}
