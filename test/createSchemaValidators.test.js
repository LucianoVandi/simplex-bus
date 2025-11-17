import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CommandBusValidationError,
  createSchemaValidators
} from '../index.js';

test('createSchemaValidators builds request and response validators', () => {
  const compile = (schema) => {
    if (schema.type === 'string') {
      return (payload) => typeof payload === 'string';
    }

    if (schema.type === 'object' && schema.required?.includes('token')) {
      return (payload) => payload && typeof payload === 'object' && typeof payload.token === 'string';
    }

    if (schema.type === 'object' && schema.required?.includes('message')) {
      return (payload) => payload && typeof payload === 'object' && typeof payload.message === 'string';
    }

    return () => false;
  };

  const validators = createSchemaValidators({
    compile,
    schemaMap: {
      'auth/get-token': {
        request: { type: 'string' },
        response: { type: 'object', required: ['token'] },
        error: { type: 'object', required: ['message'] }
      }
    }
  });

  assert.equal(validators['auth/get-token']('x'), true);
  assert.equal(validators['auth/get-token-response']({ token: 'abc' }), true);
  assert.equal(validators['auth/get-token-response']({ message: 'oops' }), true);
  assert.throws(
    () => validators['auth/get-token-response']({ invalid: true }),
    CommandBusValidationError
  );
});

test('createSchemaValidators validates config', () => {
  assert.throws(() => createSchemaValidators({ compile: () => () => true }), /schemaMap/);
  assert.throws(() => createSchemaValidators({ schemaMap: {}, compile: 1 }), /compile/);
  assert.throws(
    () => createSchemaValidators({ schemaMap: {}, compile: () => () => true, onValidationError: 1 }),
    /onValidationError/
  );
});

test('createSchemaValidators surfaces validation diagnostics', () => {
  const diagnostics = [];
  const compile = () => {
    const fn = () => false;
    fn.errors = [{ path: '/token', message: 'required' }];
    return fn;
  };

  const validators = createSchemaValidators({
    compile,
    onValidationError: (details) => diagnostics.push(details),
    schemaMap: {
      'auth/get-token': {
        response: { type: 'object', required: ['token'] }
      }
    }
  });

  assert.throws(
    () => validators['auth/get-token-response']({}),
    (error) =>
      error instanceof CommandBusValidationError &&
      error.details &&
      error.details.type === 'auth/get-token' &&
      error.details.channel === 'response'
  );
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].channel, 'response');
});
