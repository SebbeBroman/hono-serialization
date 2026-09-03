import { Hono } from 'hono'
import { hc } from 'hono/client'
import type { InferResponseType } from 'hono/client'
import { stringify as superjsonStringify, parse as superjsonParse } from 'superjson'
import { serialize as serovalSerialize, deserialize as serovalDeserialize } from 'seroval';
import { stringify as devalueStringify, parse as devalueParse } from 'devalue'
import { encode as cborEncode, decode as cborDecode } from 'cbor-x';
import { describe, expectTypeOf, test } from 'vitest'
import { createClient } from '../src/client'
import { serialization, defineSerializer, type JsonApp } from '../src/index'

const superjson = defineSerializer({
  name: 'superjson',
  json: {
    serialize: superjsonStringify,
    parse: superjsonParse,
  },
})

const seroval = defineSerializer({
  name: 'seroval',
  json: {
    serialize: serovalSerialize,
    parse: serovalDeserialize,
  },
})

const devalue = defineSerializer({
  name: 'devalue',
  json: {
    serialize: devalueStringify,
    parse: devalueParse,
  },
})

const cbor = defineSerializer({
  name: 'cbor',
  json: {
    serialize: cborEncode,
    parse: cborDecode,
  },
})

const t = serialization([superjson, seroval, devalue, cbor])
const app = new Hono().get('/item', (c) => t.json(c, { createdAt: new Date() }))

describe('RPC types', () => {
  test('t.json preserves Date on the serializer client', () => {
    const superjsonClient = createClient<typeof app>('http://localhost', superjson)
    const serovalClient = createClient<typeof app>('http://localhost', seroval)
    const devalueClient = createClient<typeof app>('http://localhost', devalue)
    const cborClient = createClient<typeof app>('http://localhost', cbor)
    type SuperjsonData = InferResponseType<typeof superjsonClient.item.$get>
    type SerovalData = InferResponseType<typeof serovalClient.item.$get>
    type DevalueData = InferResponseType<typeof devalueClient.item.$get>
    type CborData = InferResponseType<typeof cborClient.item.$get>
    expectTypeOf<SuperjsonData>().toEqualTypeOf<{ createdAt: Date }>()
    expectTypeOf<SerovalData>().toEqualTypeOf<{ createdAt: Date }>()
    expectTypeOf<DevalueData>().toEqualTypeOf<{ createdAt: Date }>()
    expectTypeOf<CborData>().toEqualTypeOf<{ createdAt: Date }>()
  })

  test('JsonApp parses Date as string for a JSON client', () => {
    const jsonClient = hc<JsonApp<typeof app>>('http://localhost')
    type Data = InferResponseType<typeof jsonClient.item.$get>
    expectTypeOf<Data>().toEqualTypeOf<{ createdAt: string }>()
  })

  test('c.json stays JSONParsed even on the serializer client', async () => {
    const vanilla = new Hono().get('/item', (c) =>
      c.json({ createdAt: new Date() }),
    )
    const superjsonClient = createClient<typeof vanilla>('http://localhost', superjson)
    const serovalClient = createClient<typeof vanilla>('http://localhost', seroval)
    const devalueClient = createClient<typeof vanilla>('http://localhost', devalue)
    const cborClient = createClient<typeof vanilla>('http://localhost', cbor)
    type SuperjsonData = InferResponseType<typeof superjsonClient.item.$get>
    type SerovalData = InferResponseType<typeof serovalClient.item.$get>
    type DevalueData = InferResponseType<typeof devalueClient.item.$get>
    type CborData = InferResponseType<typeof cborClient.item.$get>
    expectTypeOf<SuperjsonData>().toEqualTypeOf<{ createdAt: string }>()
    expectTypeOf<SerovalData>().toEqualTypeOf<{ createdAt: string }>()
    expectTypeOf<DevalueData>().toEqualTypeOf<{ createdAt: string }>()
    expectTypeOf<CborData>().toEqualTypeOf<{ createdAt: string }>()
  })
})
