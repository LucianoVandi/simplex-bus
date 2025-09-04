# Simplex Bus

A transport-agnostic command bus for safe cross-context messaging (`WebView`, `iframe`, embedded apps, native bridges).

`Simplex Bus` focuses on:
- Strict message contracts (`allowedTypes`, payload validators)
- Request/response correlation with timeout and abort support
- Clean lifecycle (`on`, `once`, `off`, `dispose`)
- Explicit runtime errors for predictable failure handling

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

## Quality Gates

```bash
npm run check
```

Includes:
- Syntax checks
- Full test suite
- Coverage thresholds (`line >= 90`, `branch >= 85`, `funcs >= 90`)

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
