import { Hono } from 'hono'
import { hc } from 'hono/client'
import { validator } from 'hono/validator'
import type { InferRequestType, InferResponseType } from 'hono/client'
import {
  stringify as superjsonStringify,
  parse as superjsonParse,
} from 'superjson'
import {
  serialize as serovalSerialize,
  deserialize as serovalDeserialize,
} from 'seroval'
import { stringify as devalueStringify, parse as devalueParse } from 'devalue'
import { encode as cborEncode, decode as cborDecode } from 'cbor-x'
import { describe, expectTypeOf, test } from 'vitest'
import { createClient } from '../src/client'
import { serialization, defineSerializer, type JsonApp } from '../src/index'

const superjson = defineSerializer({
  name: 'superjson',
  json: {
    types: 'preserve',
    serialize: superjsonStringify,
    parse: superjsonParse,
  },
})

const seroval = defineSerializer({
  name: 'seroval',
  json: {
    types: 'preserve',
    serialize: serovalSerialize,
    parse: serovalDeserialize,
  },
})

const devalue = defineSerializer({
  name: 'devalue',
  json: {
    types: 'preserve',
    serialize: devalueStringify,
    parse: devalueParse,
  },
})

const cbor = defineSerializer({
  name: 'cbor',
  json: {
    types: 'preserve',
    binary: true,
    serialize: cborEncode,
    parse: cborDecode,
  },
})

const t = serialization([superjson, seroval, devalue, cbor])
const app = new Hono()
  .use(t)
  .get('/item', (c) => t.json(c, { createdAt: new Date() }))

describe('RPC types', () => {
  test('t.json preserves Date on the serializer client', () => {
    const superjsonClient = createClient<typeof app>(
      'http://localhost',
      superjson,
    )
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
    const superjsonClient = createClient<typeof vanilla>(
      'http://localhost',
      superjson,
    )
    const serovalClient = createClient<typeof vanilla>(
      'http://localhost',
      seroval,
    )
    const devalueClient = createClient<typeof vanilla>(
      'http://localhost',
      devalue,
    )
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

const jsonCodec = defineSerializer({
  name: 'json',
  json: { types: 'json-parsed', serialize: JSON.stringify, parse: JSON.parse },
})
const unknownCodec = defineSerializer({
  name: 'custom',
  json: {
    types: 'unknown',
    serialize: JSON.stringify,
    parse: JSON.parse,
  },
})
const implicitCodec = defineSerializer({
  name: 'implicit',
  json: { serialize: superjsonStringify, parse: superjsonParse },
})
const mixed = serialization([
  superjson,
  implicitCodec,
  jsonCodec,
  unknownCodec,
])
const mixedApp = new Hono()
  .use(mixed)
  .get('/default', (c) => mixed.json(c, { date: new Date() }))
  .get('/created', (c) => mixed.json(c, { date: new Date() }, 201))
  .get('/accepted', (c) => mixed.json(c, { date: new Date() }, { status: 202 }))
  .get('/init', (c) =>
    mixed.json(c, { date: new Date() }, { headers: { 'X-Test': 'yes' } }),
  )
  .get('/error', (c) => mixed.json(c, { error: 'bad' }, 400))

describe('strict RPC contracts', () => {
  test('lossless, implicit, JSON, and unknown codecs have distinct response types', () => {
    const richClient = createClient<typeof mixedApp>(
      'http://localhost',
      superjson,
    )
    const implicitClient = createClient<typeof mixedApp>(
      'http://localhost',
      implicitCodec,
    )
    const jsonClient = createClient<typeof mixedApp>(
      'http://localhost',
      jsonCodec,
    )
    const unknownClient = createClient<typeof mixedApp>(
      'http://localhost',
      unknownCodec,
    )
    type Rich = InferResponseType<typeof richClient.default.$get>
    type Implicit = InferResponseType<typeof implicitClient.default.$get>
    type Json = InferResponseType<typeof jsonClient.default.$get>
    type Unknown = InferResponseType<typeof unknownClient.default.$get>
    expectTypeOf<Rich>().toEqualTypeOf<{ date: Date }>()
    // An omitted contract defaults to preserve.
    expectTypeOf<Implicit>().toEqualTypeOf<{ date: Date }>()
    expectTypeOf<Json>().toEqualTypeOf<{ date: string }>()
    expectTypeOf<Unknown>().toEqualTypeOf<unknown>()
    type Default = Awaited<ReturnType<typeof richClient.default.$get>>
    type Created = Awaited<ReturnType<typeof richClient.created.$get>>
    type Accepted = Awaited<ReturnType<typeof richClient.accepted.$get>>
    type Init = Awaited<ReturnType<typeof richClient.init.$get>>
    type Error = Awaited<ReturnType<typeof richClient.error.$get>>
    expectTypeOf<Default['status']>().toEqualTypeOf<200>()
    expectTypeOf<Default['ok']>().toEqualTypeOf<true>()
    expectTypeOf<Created['status']>().toEqualTypeOf<201>()
    expectTypeOf<Accepted['status']>().toEqualTypeOf<202>()
    expectTypeOf<Init['status']>().toEqualTypeOf<200>()
    expectTypeOf<Error['status']>().toEqualTypeOf<400>()
    expectTypeOf<Error['ok']>().toEqualTypeOf<false>()
  })

  test('stock hc cannot assume the negotiated output is a Date', () => {
    const stock = hc<typeof mixedApp>('http://localhost')
    type Raw = InferResponseType<typeof stock.default.$get>
    // @ts-expect-error An opaque negotiated output must be mapped through a client adapter.
    type DateValue = Raw['date']
    expectTypeOf<DateValue>()
    const plain = hc<JsonApp<typeof mixedApp>>('http://localhost')
    expectTypeOf<InferResponseType<typeof plain.default.$get>>().toEqualTypeOf<{
      date: string
    }>()
  })

  test('unregistered serializers are rejected at compile time', () => {
    const unrelated = defineSerializer({
      name: 'unregistered',
      json: {
        types: 'preserve',
        serialize: JSON.stringify,
        parse: JSON.parse,
      },
    })
    // @ts-expect-error This serializer does not belong to this app's negotiated endpoints.
    createClient<typeof mixedApp>('http://localhost', unrelated)
  })

  test('binary codecs must explicitly declare bytes and accept bytes in parse', () => {
    const invalidTypes = () => {
      defineSerializer({
        name: 'bad',
        // @ts-expect-error Bytes without binary: true violate the wire contract.
        json: {
          serialize: () => new Uint8Array([1]),
          parse: (bytes: Uint8Array) => bytes,
        },
      })
      defineSerializer({
        name: 'bad',
        // @ts-expect-error A binary parser receives Uint8Array, not string.
        json: { binary: true, serialize: cborEncode, parse: JSON.parse },
      })
      // @ts-expect-error Contentless statuses cannot be used for a body-producing helper.
      mixed.json({} as Parameters<typeof mixed.json>[0], {}, 204)
      // @ts-expect-error ResponseInit cannot bypass the contentful-status restriction.
      mixed.json({} as Parameters<typeof mixed.json>[0], {}, { status: 304 })
    }
    void invalidTypes
  })
})

const inputCodec = defineSerializer({
  name: 'input',
  json: {
    types: 'preserve',
    serialize: superjsonStringify,
    parse: superjsonParse,
    input: {
      types: 'preserve',
      serialize: superjsonStringify,
      parse: superjsonParse,
    },
  },
})
const inputT = serialization(inputCodec)
const inputApp = new Hono().use(inputT).post(
  '/echo',
  validator('json', (value: { date: Date }) => value),
  (c) => inputT.json(c, c.req.valid('json')),
)
const noInputT = serialization(superjson)
const noInputApp = new Hono().use(noInputT).post(
  '/echo',
  validator('json', (value: { date: Date }) => value),
  (c) => noInputT.json(c, c.req.valid('json')),
)
test('JSON request types follow the input codec contract', () => {
  const rich = createClient<typeof inputApp>('http://localhost', inputCodec)
  const plain = createClient<typeof noInputApp>('http://localhost', superjson)
  const stock = hc<JsonApp<typeof inputApp>>('http://localhost')
  expectTypeOf<
    InferRequestType<typeof rich.echo.$post>['json']
  >().toEqualTypeOf<{ date: Date }>()
  expectTypeOf<
    InferRequestType<typeof plain.echo.$post>['json']
  >().toEqualTypeOf<{ date: string }>()
  expectTypeOf<
    InferRequestType<typeof stock.echo.$post>['json']
  >().toEqualTypeOf<{ date: string }>()
})
