import type { Serializer } from './types'

export const toSerializerList = (
  serializers: Serializer | readonly Serializer[],
): Serializer[] =>
  Array.isArray(serializers)
    ? [...(serializers as readonly Serializer[])]
    : [serializers as Serializer]

export const serializerMap = (
  serializers: Serializer | readonly Serializer[],
): { list: Serializer[]; byName: Map<string, Serializer> } => {
  const list = toSerializerList(serializers)
  if (list.length === 0) {
    throw new TypeError('serialization: at least one serializer is required')
  }
  const byName = new Map<string, Serializer>()
  for (const item of list) {
    if (byName.has(item.name)) {
      throw new TypeError(`serialization: duplicate name "${item.name}"`)
    }
    byName.set(item.name, item)
  }
  return { list, byName }
}
