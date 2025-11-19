# Simplex Bus

A transport-agnostic command bus for safe cross-context messaging (`WebView`, `iframe`, embedded apps, native bridges).

`Simplex Bus` focuses on:
- Strict message contracts (`allowedTypes`, payload validators)
- Request/response correlation with timeout and abort support
- Clean lifecycle (`on`, `once`, `off`, `dispose`)
- Explicit runtime errors for predictable failure handling
- Runtime safety guardrails (`maxIncomingMessageBytes`, `maxPendingRequests`)

## Installation

```bash
npm install @lucianovandi/simplex-bus
```

## Quick Start

```js
import { createCommandBus } from '@lucianovandi/simplex-bus';

const bus = createCommandBus({
  sendFn: (message) => webview.postMessage(message),
  onReceive: (handler) => {
    const listener = (event) => handler(event.data);
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  },
  allowedTypes: ['get-token'],
  validators: {
    'get-token': () => true,
    'get-token-response': (payload) => typeof payload === 'string'
  }
});

bus.on('get-token', (_, context) => {
  context.respond('abc123');
});

const token = await bus.request('get-token');
```

## API

### `createCommandBus(config)`

Config:
- `sendFn(message: string): void` required transport sender
- `onReceive(handler): (() => void) | void` optional transport listener registration
- `allowedTypes: string[]` optional whitelist (`[]` means allow all)
- `validators: Record<string, (payload) => boolean>` optional payload validators
- `parser(raw: string): object` optional input parser (default `JSON.parse`)
- `serializer(message: object): string` optional output serializer (default `JSON.stringify`)
- `logger.error(...args)` optional logger hook
- `responseSuffix: string` optional response suffix (default `-response`)
- `maxIncomingMessageBytes: number` optional incoming raw string size limit in UTF-8 bytes (default `65536`)
- `maxPendingRequests: number` optional pending request cap to prevent unbounded growth (default `500`)
- `responseTrustMode: 'auto' | 'strict' | 'permissive'` response trust policy (`auto` defaults to strict checks when `onReceive` is provided)
- `isTrustedResponse(info): boolean` optional guard to accept/reject candidate responses before request resolution

Bus methods:
- `send(type, payload?)`
- `request(type, payload?, timeoutOrOptions?)`
- `receive(raw)`
- `on(type, handler)` returns `unsubscribe`
- `once(type, handler)` returns `unsubscribe`
- `off(type, handler?)`
- `dispose()`

Handler context:
- `respond(payload)`
- `respondError(payload)`

## Errors

Exports:
- `CommandBusError`
- `CommandBusDisposedError`
- `CommandBusValidationError`
- `CommandBusSerializationError`
- `CommandBusInvalidMessageError`
- `CommandBusTimeoutError`
- `CommandBusAbortedError`
- `CommandBusRemoteError`
- `CommandBusLimitError`

## JSON Schema Integration

For cross-boundary messaging (`React Native` <-> `WebView` <-> `web app`), prefer schema-first contracts.

`Simplex Bus` exports `createSchemaValidators(...)` to compile JSON Schemas into `validators` accepted by `createCommandBus`.

```js
import Ajv from 'ajv';
import { createCommandBus, createSchemaValidators } from '@lucianovandi/simplex-bus';

const schemaMap = {
  'auth/get-token': {
    request: { type: 'object', required: ['sessionId'], properties: { sessionId: { type: 'string' } } },
    response: { type: 'object', required: ['token'], properties: { token: { type: 'string' } } },
    error: { type: 'object', required: ['code', 'message'], properties: { code: { type: 'string' }, message: { type: 'string' } } }
  }
};

const ajv = new Ajv({ allErrors: true });
const validators = createSchemaValidators({
  schemaMap,
  compile: (schema) => ajv.compile(schema),
  onValidationError: (details) => {
    console.error('Schema validation diagnostics', details);
  }
});

const bus = createCommandBus({ sendFn, validators });
```

`createSchemaValidators` maps each command type to:
- request validator on `<type>`
- response validator on `<type>-response` (accepting success and error payload shapes when both are provided)

When a schema validation fails, validators throw `CommandBusValidationError` with diagnostic details on `error.details`.

## Trusted Response Example

Use `isTrustedResponse` to bind responses to a trusted channel/origin before request resolution.

```js
const bus = createCommandBus({
  sendFn: (message) => targetWindow.postMessage(message, 'https://app.example.com'),
  onReceive: (handler) => {
    const listener = (event) => {
      handler({
        ...JSON.parse(event.data),
        _origin: event.origin,
        _source: event.source
      });
    };
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  },
  responseTrustMode: 'strict',
  isTrustedResponse: ({ raw, requestNonce, responseNonce }) => {
    if (!raw || typeof raw !== 'object') {
      return false;
    }

    const messageEvent = raw;
    return (
      messageEvent._origin === 'https://app.example.com' &&
      messageEvent._source === targetWindow &&
      requestNonce === responseNonce
    );
  }
});
```

## Quality Gates

```bash
npm run check
```

Includes:
- Syntax checks
- Full test suite
- Coverage thresholds (`line >= 90`, `branch >= 85`, `funcs >= 90`)
- Public API contract tests (exports and method surface stability)
- Type declaration contract checks (`npm run typecheck`, via `typescript`)

Run local bridge demo:

```bash
npm run demo:e2e
```

Run Ajv-powered local bridge demo:

```bash
npm run demo:e2e:ajv
```
If Ajv is not installed locally, run `npm install --save-dev ajv` first.

## Repository Standards

This repository includes:
- CI pipeline (`.github/workflows/ci.yml`)
- Contribution guide (`CONTRIBUTING.md`)
- Security policy (`SECURITY.md`)
- Code of Conduct (`CODE_OF_CONDUCT.md`)
- Changelog (`CHANGELOG.md`)

## Examples

- WebView bridge example: `examples/webview-bridge.js`
- iframe bridge example: `examples/iframe-bridge.js`
- JSON Schema contract example: `examples/schema-first-contract.js`
- End-to-end local bridge demo: `examples/e2e/local-bridge-demo.mjs`
- End-to-end Ajv demo: `examples/e2e/local-bridge-demo-ajv.mjs`

Note on the E2E demo:
- `examples/e2e/local-bridge-demo.mjs` uses a lightweight JSON Schema subset compiler for offline/local execution.
- For production-grade validation, use Ajv as shown in `examples/schema-first-contract.js`.

## Architecture Notes

### Core Principles

- Transport-agnostic by design: transport is provided through `sendFn` and `onReceive`.
- Request/response correlation based on generated IDs and deterministic response type suffix.
- Failures are explicit through typed error classes.
- Lifecycle is explicit and reversible (`on`, `once`, `off`, `dispose`).

### Message Model

Envelope fields:
- `type` required command/event name
- `payload` optional data
- `id` optional correlation ID used by requests
- `isError` optional response flag for remote failures

### Safety Model

- Input shape validation at receive boundary.
- Payload validation per message type.
- Pending requests are cleaned up on timeout, abort, or dispose.
- Parser/serializer failures are wrapped in domain errors.
- Response correlation IDs are random UUID-based when available (with random fallback).
- Strict response trust is automatic when `onReceive` is configured (`responseTrustMode: 'auto'`).
- Optional `isTrustedResponse` guard can enforce provenance/channel checks in untrusted transports.

### Tradeoffs

- Runtime validation is intentionally lightweight and dependency-free.
- Response type convention (`<type>-response`) is simple and predictable.
- Handlers are sync-first for simplicity; async usage is supported at transport level.

## Release Checklist

### Before Release

- Run `npm run check` and ensure all gates pass.
- Verify `CHANGELOG.md` has an entry for the release.
- Verify README examples still match the public API.
- Verify package contents with `npm run pack:check`.

### Versioning

- Bump version in `package.json`.
- Tag release with `v<version>`.

### Publish

- Publish package from clean `main` branch.
- Create GitHub release notes from changelog.

### After Release

- Smoke test install from a fresh project.
- Open follow-up issues for deferred improvements.

## License

MIT.
