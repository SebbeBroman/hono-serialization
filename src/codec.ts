/** Shared codec definitions: no Hono runtime or server middleware. */
import type { Serializer } from './types'
import { validateSerializer } from './validation'

export function defineSerializer<const T extends Serializer>(serializer: T): T {
  validateSerializer(serializer)
  return serializer
}

export type {
  Serializer,
  FormatSerializer,
  WireSerializer,
  WireBody,
  OutputMode,
} from './types'
