import { CommandBusRemoteError, createCommandBus, createSchemaValidators } from '../../index.js';

async function loadAjv() {
  try {
    const module = await import('ajv');
    return module.default;
  } catch (error) {
    console.error('[E2E:AJV] Ajv is not installed.');
    console.error('[E2E:AJV] Install it locally with: npm install --save-dev ajv');
    throw error;
  }
}

async function main() {
  const Ajv = await loadAjv();
  const ajv = new Ajv({ allErrors: true, strict: false });

  const schemaMap = {
    'auth/get-token': {
      request: {
        type: 'object',
        additionalProperties: false,
        required: ['sessionId'],
        properties: {
          sessionId: { type: 'string', minLength: 1 }
        }
      },
      response: {
        type: 'object',
        additionalProperties: false,
        required: ['token'],
        properties: {
          token: { type: 'string', minLength: 1 }
        }
      },
      error: {
        type: 'object',
        additionalProperties: false,
        required: ['code', 'message'],
        properties: {
          code: { type: 'string' },
          message: { type: 'string' }
        }
      }
    }
  };

  const validators = createSchemaValidators({
    schemaMap,
    compile: (schema) => ajv.compile(schema),
    onValidationError: (details) => {
      console.error('[E2E:AJV] Schema validation error', details);
    }
  });

  const webBus = createCommandBus({
    sendFn: (message) => {
      setTimeout(() => nativeBus.receive(message), 0);
    },
    validators
  });

  const nativeBus = createCommandBus({
    sendFn: (message) => {
      setTimeout(() => webBus.receive(message), 0);
    },
    validators
  });

  nativeBus.on('auth/get-token', (payload, context) => {
    if (payload.sessionId === 'expired') {
      context.respondError({ code: 'AUTH_EXPIRED', message: 'Session expired' });
      return;
    }

    context.respond({ token: 'token-ajv-123' });
  });

  const ok = await webBus.request('auth/get-token', { sessionId: 'active' });
  console.log('[E2E:AJV] success response:', ok);

  try {
    await webBus.request('auth/get-token', { sessionId: 'expired' });
  } catch (error) {
    if (error instanceof CommandBusRemoteError) {
      console.log('[E2E:AJV] remote error response:', error.payload);
    } else {
      throw error;
    }
  }

  try {
    await webBus.request('auth/get-token', { sessionId: '' });
  } catch (error) {
    console.log('[E2E:AJV] invalid request rejected:', error.name);
  }

  webBus.dispose();
  nativeBus.dispose();
}

main().catch((error) => {
  console.error('[E2E:AJV] demo failed', error);
  process.exitCode = 1;
});
