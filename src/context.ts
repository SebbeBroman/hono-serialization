import type { Context } from 'hono'
import { CONTEXT_KEY } from './constants'
import type { Serializer } from './types'

export type ActiveSerializer = {
  serializer: Serializer
  header: string
}

export const getActive = (c: Context): ActiveSerializer | undefined => {
  return c.get(CONTEXT_KEY) as ActiveSerializer | undefined
}

export const setActive = (c: Context, active: ActiveSerializer): void => {
  c.set(CONTEXT_KEY, active)
}
