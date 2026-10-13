# Changelog

## 0.0.1

The project is named **hono-serialization**. This release focuses on Hono.

### Fixes

- Add a runtime-independent `/codec` entry and separate client dependencies from server middleware in ESM and CommonJS output.
- Encode via Hono's unpatched response constructor; body codecs no longer recurse or re-encode another slot's wire output.
- Add `Vary` for negotiation on both encoded and ordinary responses.
- Declare response format explicitly, including custom MIME types; expose all protocol headers through CORS.
- Preserve decoding for cloned responses and per-call fetch overrides.
- Reject invalid serializer output rather than silently coercing it to empty bytes.
- Cache decoded request JSON and protect outgoing negotiation headers.
- Use safe Seroval JSON-mode request decoding in the examples and tests.
- Update dependencies and the lockfile; the tested development toolchain uses TypeScript 6 because tsup's declaration generation requires the TypeScript JavaScript API.

### Compatibility notes

- Add `json.output: 'preserve'` to lossless codecs, or `'json'` to ordinary JSON codecs. Omitted contracts expose `unknown` output.
- Input codecs require `input.output: 'preserve' | 'json'`.
- Binary codecs require `binary: true`; a binary MIME type no longer selects the parser input type.
- Use `createClient` for negotiated app types. Use `hc<JsonApp<typeof app>>` for ordinary JSON clients.
- Serializer clients reject unnegotiated JSON responses instead of silently falling back. Mount middleware on their JSON endpoints and JSON error handlers.
- Patched `c.json` now normalizes values to ordinary JSON before encoding; use `s.json` for rich values.
- Helpers default explicitly to status 200. Supply non-200 statuses directly instead of relying on `c.status`.
- Standalone context helpers are replaced by helpers on the middleware instance, so their RPC types carry the registered codec definitions.
- Minimum supported Hono version is 4.13.13.
