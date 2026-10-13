/** Shared codec definitions: no Hono runtime or server middleware. */
import type { Serializer } from './types'
import { validateSerializer } from './validation'

export function defineSerializer<const T extends Serializer>(
  serializer: T & Record<Exclude<keyof T, keyof Serializer>, never>,
): T {
  validateSerializer(serializer)
  return serializer
}

export type {
  Serializer,
  JsonSerializer,
  WireSerializer,
  WireBody,
  OutputMode,
} from './types'
