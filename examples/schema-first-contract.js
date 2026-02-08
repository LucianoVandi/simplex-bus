import Ajv from 'ajv';

import { createCommandBus, createSchemaValidators } from '../index.js';

// This file models a shared contract package used by both Web and React Native.
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

const ajv = new Ajv({ allErrors: true });
const validators = createSchemaValidators({
  schemaMap,
  compile: (schema) => ajv.compile(schema)
});

const bus = createCommandBus({
  sendFn: (message) => {
    // Demo only: transport implementation omitted.
    console.log('SEND', message);
  },
  validators,
  maxIncomingMessageBytes: 64 * 1024,
  maxPendingRequests: 500
});

bus.on('auth/get-token', (payload, context) => {
  if (payload.sessionId === 'expired') {
    context.respondError({ code: 'AUTH_EXPIRED', message: 'Session expired' });
    return;
  }

  context.respond({ token: 'secure-token' });
});

export { bus, schemaMap };
