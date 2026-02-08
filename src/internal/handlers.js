import { CommandBusValidationError } from '../errors.js';
import { isNonEmptyString } from './shared.js';

export const createHandlerRegistry = ({ assertNotDisposed, isAllowedType }) => {
  const handlers = new Map();

  const on = (type, handler) => {
    assertNotDisposed();

    if (!isNonEmptyString(type)) {
      throw new TypeError('`type` must be a non-empty string.');
    }

    if (typeof handler !== 'function') {
      throw new TypeError('`handler` must be a function.');
    }

    if (!isAllowedType(type)) {
      throw new CommandBusValidationError(`Handler registration failed: type "${type}" not allowed.`);
    }

    if (!handlers.has(type)) {
      handlers.set(type, new Set());
    }

    handlers.get(type).add(handler);
    return () => off(type, handler);
  };

  const once = (type, handler) => {
    if (typeof handler !== 'function') {
      throw new TypeError('`handler` must be a function.');
    }

    const wrapped = (payload, context) => {
      off(type, wrapped);
      handler(payload, context);
    };

    return on(type, wrapped);
  };

  const off = (type, handler) => {
    assertNotDisposed();

    if (!isNonEmptyString(type)) {
      throw new TypeError('`type` must be a non-empty string.');
    }

    const listeners = handlers.get(type);
    if (!listeners) {
      return false;
    }

    if (handler === undefined) {
      handlers.delete(type);
      return true;
    }

    const didDelete = listeners.delete(handler);
    if (listeners.size === 0) {
      handlers.delete(type);
    }

    return didDelete;
  };

  return {
    handlers,
    on,
    once,
    off,
    clear: () => handlers.clear()
  };
};
