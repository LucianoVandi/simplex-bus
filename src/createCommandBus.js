import {
  CommandBusAbortedError,
  CommandBusDisposedError,
  CommandBusInvalidMessageError,
  CommandBusLimitError,
  CommandBusRemoteError,
  CommandBusSerializationError,
  CommandBusValidationError,
  CommandBusTimeoutError
} from './errors.js';
import { parseRequestOptions, validateCreateConfig } from './internal/config.js';
import { createPendingRequestsStore } from './internal/pendingRequests.js';
import {
  DEFAULT_MAX_INCOMING_MESSAGE_BYTES,
  DEFAULT_MAX_PENDING_REQUESTS,
  DEFAULT_RESPONSE_SUFFIX,
  DEFAULT_RESPONSE_TRUST_MODE,
  NOOP_LOGGER,
  getRandomHex,
  getStringSizeInBytes,
  isNonEmptyString,
  isObject
} from './internal/shared.js';

const NOOP_RESPONSE_TRUST_GUARD = () => true;

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
 * @param {'auto' | 'strict' | 'permissive'} [config.responseTrustMode]
 * @param {(info: { requestType: string, requestId: string, responseType: string, requestNonce: string, responseNonce?: string, payload: unknown, isError: boolean, raw: string | object }) => boolean} [config.isTrustedResponse]
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
  responseTrustMode = DEFAULT_RESPONSE_TRUST_MODE,
  isTrustedResponse = NOOP_RESPONSE_TRUST_GUARD
}) {
  validateCreateConfig({
    sendFn,
    onReceive,
    allowedTypes,
    validators,
    parser,
    serializer,
    responseSuffix,
    maxIncomingMessageBytes,
    maxPendingRequests,
    responseTrustMode,
    isTrustedResponse
  });

  const isStrictResponseTrust =
    responseTrustMode === 'strict' || (responseTrustMode === 'auto' && typeof onReceive === 'function');

  const handlers = new Map();
  const pendingRequests = createPendingRequestsStore();
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

    if (parsed.nonce !== undefined && !isNonEmptyString(parsed.nonce)) {
      throw new CommandBusInvalidMessageError('Incoming message `nonce` must be a non-empty string when provided.');
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

  const sendResponse = ({ message, payload, isError }) => {
    if (!message.id) {
      return false;
    }

    sendEnvelope(
      {
        type: getResponseType(message.type),
        payload,
        id: message.id,
        nonce: message.nonce,
        isError
      },
      { skipTypeGuard: true }
    );

    return true;
  };

  const rejectAllPending = (error) => {
    pendingRequests.rejectAll(error);
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
    const nonce = getRandomHex(16);
    const expectedResponseType = getResponseType(type);

    if (pendingRequests.size() >= maxPendingRequests) {
      throw new CommandBusLimitError(
        `Pending request limit reached (${maxPendingRequests}). Resolve or abort requests before creating new ones.`
      );
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingRequests.clear(id);
        reject(new CommandBusTimeoutError(type, timeout));
      }, timeout);

      const pending = {
        type,
        expectedResponseType,
        nonce,
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
          pendingRequests.clear(id);
          reject(new CommandBusAbortedError(type));
        };

        signal.addEventListener('abort', pending.abortListener, { once: true });
      }

      pendingRequests.set(id, pending);

      try {
        sendEnvelope({ type, payload, id, nonce });
      } catch (error) {
        pendingRequests.clear(id);
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
          requestNonce: pending.nonce,
          responseNonce: message.nonce,
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

      if (isStrictResponseTrust && message.nonce !== pending.nonce) {
        safeLogError('[SimplexBus] Dropped response with invalid nonce', {
          requestType: pending.type,
          requestId: message.id,
          responseType: message.type
        });
        return;
      }

      try {
        validatePayload(message.type, message.payload);
      } catch (error) {
        pendingRequests.clear(message.id);
        pending.reject(error);
        return;
      }

      pendingRequests.clear(message.id);
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
      respond: (responsePayload) => sendResponse({ message, payload: responsePayload, isError: false }),
      respondError: (responsePayload) => sendResponse({ message, payload: responsePayload, isError: true })
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
