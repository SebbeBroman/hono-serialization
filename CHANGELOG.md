# Changelog

## 0.0.1

Initial release.

- Opt-in JSON serialization for [Hono](https://hono.dev) RPC with bring-your-own codecs: SuperJSON, devalue, Seroval, CBOR, or any `serialize`/`parse` pair.
- Header-based negotiation (`x-hono-serialization`) with ordinary JSON for unnegotiated requests.
- Explicit codec contracts: `preserve`, `json`, or `unknown` output, and optional request-body decoding via `json.input`.
- Strict RPC types: `s.json` marks negotiated endpoints, `createClient` maps them by codec contract, and mismatched serializers are rejected at compile time.
- ESM-only package with `/codec` (shared definitions, no Hono runtime) and `/client` entry points.
