import { CommandBusRemoteError, createCommandBus, createSchemaValidators } from '../../index.js';

function compileJsonSchemaLite(schema) {
  return (payload) => {
    if (!schema || typeof schema !== 'object') {
      return false;
    }

    if (schema.type === 'object') {
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return false;
      }

      if (Array.isArray(schema.required)) {
        for (const requiredKey of schema.required) {
          if (!(requiredKey in payload)) {
            return false;
          }
        }
      }

      if (schema.additionalProperties === false && schema.properties) {
        const allowed = new Set(Object.keys(schema.properties));
        for (const key of Object.keys(payload)) {
          if (!allowed.has(key)) {
            return false;
          }
        }
      }

      if (schema.properties) {
        for (const [key, rule] of Object.entries(schema.properties)) {
          const value = payload[key];
          if (value === undefined) {
            continue;
          }

          if (rule.type === 'string') {
            if (typeof value !== 'string') {
              return false;
            }
            if (typeof rule.minLength === 'number' && value.length < rule.minLength) {
              return false;
            }
          }
        }
      }
      return true;
    }

    if (schema.type === 'string') {
      if (typeof payload !== 'string') {
        return false;
      }
      if (typeof schema.minLength === 'number' && payload.length < schema.minLength) {
        return false;
      }
      return true;
    }

    return false;
  };
}

async function main() {
  const validators = createSchemaValidators({
    // Demo-only lightweight JSON Schema compiler.
    compile: compileJsonSchemaLite,
    schemaMap: {
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
      },
      'profile/get': {
        request: {
          type: 'object',
          additionalProperties: false,
          required: ['id'],
          properties: {
            id: { type: 'string', minLength: 1 }
          }
        },
        response: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'name'],
          properties: {
            id: { type: 'string', minLength: 1 },
            name: { type: 'string', minLength: 1 }
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
    }
  });

  const web = createCommandBus({
    sendFn: (message) => {
      setTimeout(() => native.receive(message), 0);
    },
    validators
  });

  const native = createCommandBus({
    sendFn: (message) => {
      setTimeout(() => web.receive(message), 0);
    },
    validators
  });

  native.on('auth/get-token', (payload, context) => {
    if (payload.sessionId === 'expired') {
      context.respondError({ code: 'AUTH_EXPIRED', message: 'Session expired' });
      return;
    }

    context.respond({ token: 'token-123' });
  });

  native.on('profile/get', (payload, context) => {
    context.respond({ id: payload.id, name: 'Demo User' });
  });

  const token = await web.request('auth/get-token', { sessionId: 'active' });
  console.log('[E2E] web -> native auth/get-token:', token);

  const profile = await web.request('profile/get', { id: 'u-1' });
  console.log('[E2E] web -> native profile/get:', profile);

  try {
    await web.request('auth/get-token', { sessionId: 'expired' });
  } catch (error) {
    if (error instanceof CommandBusRemoteError) {
      console.log('[E2E] remote error received as expected:', error.payload);
    } else {
      throw error;
    }
  }

  web.dispose();
  native.dispose();
}

main().catch((error) => {
  console.error('[E2E] demo failed', error);
  process.exitCode = 1;
});
