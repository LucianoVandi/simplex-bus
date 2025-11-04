import {
  CommandBusAbortedError,
  CommandBusDisposedError,
  CommandBusInvalidMessageError,
  CommandBusLimitError,
  CommandBusRemoteError,
  CommandBusSerializationError,
  CommandBusTimeoutError,
  CommandBusValidationError
} from './errors.js';

const NOOP_LOGGER = {
  error: () => {}
};

const DEFAULT_RESPONSE_SUFFIX = '-response';
const DEFAULT_MAX_INCOMING_MESSAGE_BYTES = 64 * 1024;
const DEFAULT_MAX_PENDING_REQUESTS = 500;
const TEXT_ENCODER = typeof TextEncoder !== 'undefined' ? new TextEncoder() : undefined;
const NOOP_RESPONSE_TRUST_GUARD = () => true;

const isNonEmptyString = (value) => typeof value === 'string' && value.length > 0;

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const getStringSizeInBytes = (value) => (TEXT_ENCODER ? TEXT_ENCODER.encode(value).length : value.length);

const getRandomHex = (sizeInBytes) => {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(sizeInBytes);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
  }

  let randomHex = '';
  for (let index = 0; index < sizeInBytes; index += 1) {
    randomHex += Math.floor(Math.random() * 256).toString(16).padStart(2, '0');
  }

  return randomHex;
};

const parseRequestOptions = (optionsOrTimeout) => {
  if (typeof optionsOrTimeout === 'number' || optionsOrTimeout === undefined) {
    return { timeout: optionsOrTimeout ?? 5000, signal: undefined };
  }

  if (!isObject(optionsOrTimeout)) {
    throw new TypeError('Request options must be a number or an object.');
  }

  const timeout = optionsOrTimeout.timeout ?? 5000;
  return {
    timeout,
    signal: optionsOrTimeout.signal
  };
};

/**
 * Creates a message bus for cross-context communication.
 *
 * @param {object} config
 * @param {(message: string) => void} config.sendFn
 * @param {(handler: (raw: string | object) => void) => (void | (() => void))} [config.onReceive]
 * @param {string[]} [config.allowedTypes]
 * @param {Record<string, (payload: unknown) => boolean>} [config.validators]
 * @param {(raw: string) => object} [config.parser]
 * @param {(message: object) => string} [config.serializer]
 * @param {{ error?: (...args: unknown[]) => void }} [config.logger]
 * @param {string} [config.responseSuffix]
 * @param {number} [config.maxIncomingMessageBytes]
 * @param {number} [config.maxPendingRequests]
 * @param {(info: { requestType: string, requestId: string, responseType: string, payload: unknown, isError: boolean, raw: string | object }) => boolean} [config.isTrustedResponse]
 */
export function createCommandBus({
  sendFn,
  onReceive,
  allowedTypes = [],
  validators = {},
  parser = JSON.parse,
  serializer = JSON.stringify,
  logger = NOOP_LOGGER,
  responseSuffix = DEFAULT_RESPONSE_SUFFIX,
  maxIncomingMessageBytes = DEFAULT_MAX_INCOMING_MESSAGE_BYTES,
  maxPendingRequests = DEFAULT_MAX_PENDING_REQUESTS,
  isTrustedResponse = NOOP_RESPONSE_TRUST_GUARD
}) {
  if (typeof sendFn !== 'function') {
    throw new TypeError('`sendFn` must be a function.');
  }

  if (onReceive !== undefined && typeof onReceive !== 'function') {
    throw new TypeError('`onReceive` must be a function when provided.');
  }

  if (!Array.isArray(allowedTypes)) {
    throw new TypeError('`allowedTypes` must be an array of strings.');
  }

  if (!isObject(validators)) {
    throw new TypeError('`validators` must be an object of functions.');
  }

  if (typeof parser !== 'function') {
    throw new TypeError('`parser` must be a function.');
  }

  if (typeof serializer !== 'function') {
    throw new TypeError('`serializer` must be a function.');
  }

  if (!isNonEmptyString(responseSuffix)) {
    throw new TypeError('`responseSuffix` must be a non-empty string.');
  }

  if (!Number.isFinite(maxIncomingMessageBytes) || maxIncomingMessageBytes <= 0) {
    throw new TypeError('`maxIncomingMessageBytes` must be a finite number greater than 0.');
  }

  if (!Number.isInteger(maxPendingRequests) || maxPendingRequests <= 0) {
    throw new TypeError('`maxPendingRequests` must be an integer greater than 0.');
  }

  if (typeof isTrustedResponse !== 'function') {
    throw new TypeError('`isTrustedResponse` must be a function when provided.');
  }

  const handlers = new Map();
  const pendingRequests = new Map();
  const allowAllTypes = allowedTypes.length === 0;
  const allowedTypeSet = new Set(allowedTypes);
  let requestCounter = 0;
  let disposed = false;
  let unsubscribeReceive;

  const assertNotDisposed = () => {
    if (disposed) {
      throw new CommandBusDisposedError('Bus is disposed.');
    }
  };

  const isAllowedType = (type) => allowAllTypes || allowedTypeSet.has(type);

  const getResponseType = (type) => `${type}${responseSuffix}`;

  const validatePayload = (type, payload) => {
    const validator = validators[type];
    if (!validator) {
      return true;
    }

    if (typeof validator !== 'function') {
      throw new CommandBusValidationError(`Validator for type "${type}" is not a function.`);
    }

    try {
      if (!validator(payload)) {
        throw new CommandBusValidationError(`Invalid payload for type "${type}".`);
      }
      return true;
    } catch (error) {
      if (error instanceof CommandBusValidationError) {
        throw error;
      }
      throw new CommandBusValidationError(`Validator failed for type "${type}".`, { cause: error });
    }
  };

  const generateId = () => {
    requestCounter += 1;

    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return `cmd-${crypto.randomUUID()}`;
    }

    return `cmd-${getRandomHex(16)}-${requestCounter}`;
  };

  const safeLogError = (...args) => {
    if (logger && typeof logger.error === 'function') {
      logger.error(...args);
    }
  };

  const normalizeMessage = (raw) => {
    const parsed = typeof raw === 'string' ? parser(raw) : raw;

    if (!isObject(parsed)) {
      throw new CommandBusInvalidMessageError('Incoming message must be an object.');
    }

    if (!isNonEmptyString(parsed.type)) {
      throw new CommandBusInvalidMessageError('Incoming message must include a non-empty string `type`.');
    }

    if (parsed.id !== undefined && !isNonEmptyString(parsed.id)) {
      throw new CommandBusInvalidMessageError('Incoming message `id` must be a non-empty string when provided.');
    }

    return parsed;
  };

  const sendEnvelope = (message, { skipTypeGuard = false } = {}) => {
    assertNotDisposed();

    if (!skipTypeGuard && !isAllowedType(message.type)) {
      throw new CommandBusValidationError(`Message type not allowed: "${message.type}".`);
    }

    validatePayload(message.type, message.payload);

    let serialized;
    try {
      serialized = serializer(message);
    } catch (error) {
      throw new CommandBusSerializationError(`Failed to serialize message type "${message.type}".`, {
        cause: error
      });
    }

    sendFn(serialized);
  };

  const clearPendingRequest = (id) => {
    const pending = pendingRequests.get(id);
    if (!pending) {
      return;
    }

    clearTimeout(pending.timer);

    if (pending.abortListener && pending.signal) {
      pending.signal.removeEventListener('abort', pending.abortListener);
    }

    pendingRequests.delete(id);
  };

  const rejectAllPending = (error) => {
    for (const [id, pending] of pendingRequests.entries()) {
      clearPendingRequest(id);
      pending.reject(error);
    }
  };

  const send = (type, payload) => {
    if (!isNonEmptyString(type)) {
      throw new TypeError('`type` must be a non-empty string.');
    }

    sendEnvelope({ type, payload });
  };

  const request = (type, payload, optionsOrTimeout) => {
    assertNotDisposed();

    if (!isNonEmptyString(type)) {
      throw new TypeError('`type` must be a non-empty string.');
    }

    const { timeout, signal } = parseRequestOptions(optionsOrTimeout);

    if (!Number.isFinite(timeout) || timeout < 0) {
      throw new TypeError('`timeout` must be a finite number greater than or equal to 0.');
    }

    if (signal !== undefined && !(signal instanceof AbortSignal)) {
      throw new TypeError('`signal` must be an instance of AbortSignal when provided.');
    }

    const id = generateId();
    const expectedResponseType = getResponseType(type);

    if (pendingRequests.size >= maxPendingRequests) {
      throw new CommandBusLimitError(
        `Pending request limit reached (${maxPendingRequests}). Resolve or abort requests before creating new ones.`
      );
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        clearPendingRequest(id);
        reject(new CommandBusTimeoutError(type, timeout));
      }, timeout);

      const pending = {
        type,
        expectedResponseType,
        timer,
        signal,
        abortListener: undefined,
        resolve,
        reject
      };

      if (signal) {
        if (signal.aborted) {
          clearTimeout(timer);
          reject(new CommandBusAbortedError(type));
          return;
        }

        pending.abortListener = () => {
          clearPendingRequest(id);
          reject(new CommandBusAbortedError(type));
        };

        signal.addEventListener('abort', pending.abortListener, { once: true });
      }

      pendingRequests.set(id, pending);

      try {
        sendEnvelope({ type, payload, id });
      } catch (error) {
        clearPendingRequest(id);
        reject(error);
      }
    });
  };

  const receive = (raw) => {
    if (disposed) {
      return;
    }

    if (typeof raw === 'string' && getStringSizeInBytes(raw) > maxIncomingMessageBytes) {
      safeLogError(
        `[SimplexBus] Incoming message exceeds maxIncomingMessageBytes (${maxIncomingMessageBytes}).`
      );
      return;
    }

    let message;
    try {
      message = normalizeMessage(raw);
    } catch (error) {
      safeLogError('[SimplexBus] Invalid incoming message', error);
      return;
    }

    const pending = message.id ? pendingRequests.get(message.id) : undefined;
    if (pending && message.type === pending.expectedResponseType) {
      let trustedResponse;
      try {
        trustedResponse = isTrustedResponse({
          requestType: pending.type,
          requestId: message.id,
          responseType: message.type,
          payload: message.payload,
          isError: message.isError === true,
          raw
        });
      } catch (error) {
        safeLogError('[SimplexBus] Trusted response guard failed', error);
        return;
      }

      if (!trustedResponse) {
        safeLogError('[SimplexBus] Dropped untrusted response', {
          requestType: pending.type,
          requestId: message.id,
          responseType: message.type
        });
        return;
      }

      try {
        validatePayload(message.type, message.payload);
      } catch (error) {
        clearPendingRequest(message.id);
        pending.reject(error);
        return;
      }

      clearPendingRequest(message.id);
      if (message.isError) {
        pending.reject(new CommandBusRemoteError(pending.type, message.payload));
      } else {
        pending.resolve(message.payload);
      }
      return;
    }

    if (!isAllowedType(message.type)) {
      return;
    }

    try {
      validatePayload(message.type, message.payload);
    } catch (error) {
      safeLogError('[SimplexBus] Invalid incoming payload', error);
      return;
    }

    const listeners = handlers.get(message.type);
    if (!listeners || listeners.size === 0) {
      return;
    }

    const context = {
      respond: (responsePayload) => {
        if (!message.id) {
          return false;
        }

        sendEnvelope(
          {
            type: getResponseType(message.type),
            payload: responsePayload,
            id: message.id,
            isError: false
          },
          { skipTypeGuard: true }
        );
        return true;
      },
      respondError: (responsePayload) => {
        if (!message.id) {
          return false;
        }

        sendEnvelope(
          {
            type: getResponseType(message.type),
            payload: responsePayload,
            id: message.id,
            isError: true
          },
          { skipTypeGuard: true }
        );
        return true;
      }
    };

    for (const listener of listeners) {
      try {
        listener(message.payload, context);
      } catch (error) {
        safeLogError(`[SimplexBus] Handler failed for type "${message.type}"`, error);

        if (message.id) {
          try {
            context.respondError({
              message: error instanceof Error ? error.message : 'Unknown error'
            });
          } catch (responseError) {
            safeLogError('[SimplexBus] Failed to send handler error response', responseError);
          }
        }
      }
    }
  };

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

  const dispose = () => {
    if (disposed) {
      return;
    }

    disposed = true;

    rejectAllPending(new CommandBusDisposedError('Bus disposed while awaiting response.'));
    handlers.clear();

    if (typeof unsubscribeReceive === 'function') {
      unsubscribeReceive();
    }

    unsubscribeReceive = undefined;
  };

  if (onReceive) {
    unsubscribeReceive = onReceive(receive);
  }

  return {
    send,
    request,
    receive,
    on,
    once,
    off,
    dispose
  };
}
