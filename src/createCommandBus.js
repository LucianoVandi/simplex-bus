import { CommandBusDisposedError } from './errors.js';
import { validateCreateConfig } from './internal/config.js';
import { createDisposalController } from './internal/disposal.js';
import { createHandlerRegistry } from './internal/handlers.js';
import {
  createPayloadValidator
} from './internal/message.js';
import { createPendingRequestsStore } from './internal/pendingRequests.js';
import { createReceive } from './internal/receive.js';
import { createRequestIdGenerator } from './internal/requestId.js';
import { createRequest } from './internal/request.js';
import { createSendEnvelope, createSendResponse } from './internal/send.js';
import {
  DEFAULT_MAX_INCOMING_MESSAGE_BYTES,
  DEFAULT_MAX_PENDING_REQUESTS,
  DEFAULT_RESPONSE_SUFFIX,
  DEFAULT_RESPONSE_TRUST_MODE,
  NOOP_LOGGER,
  isNonEmptyString
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

  const pendingRequests = createPendingRequestsStore();
  const validatePayload = createPayloadValidator(validators);
  const generateId = createRequestIdGenerator();
  const allowAllTypes = allowedTypes.length === 0;
  const allowedTypeSet = new Set(allowedTypes);
  const isAllowedType = (type) => allowAllTypes || allowedTypeSet.has(type);
  const disposal = createDisposalController();
  const { handlers, on, once, off, clear: clearHandlers } = createHandlerRegistry({
    assertNotDisposed: disposal.assertNotDisposed,
    isAllowedType
  });
  let unsubscribeReceive;

  const getResponseType = (type) => `${type}${responseSuffix}`;

  const safeLogError = (...args) => {
    if (logger && typeof logger.error === 'function') {
      logger.error(...args);
    }
  };

  const sendEnvelope = createSendEnvelope({
    assertNotDisposed: disposal.assertNotDisposed,
    isAllowedType,
    validatePayload,
    serializer,
    sendFn
  });
  const sendResponse = createSendResponse({ getResponseType, sendEnvelope });

  const send = (type, payload) => {
    if (!isNonEmptyString(type)) {
      throw new TypeError('`type` must be a non-empty string.');
    }

    sendEnvelope({ type, payload });
  };

  const request = createRequest({
    assertNotDisposed: disposal.assertNotDisposed,
    pendingRequests,
    maxPendingRequests,
    getResponseType,
    generateId,
    sendEnvelope
  });

  const receive = createReceive({
    isDisposed: disposal.isDisposed,
    maxIncomingMessageBytes,
    parser,
    safeLogError,
    pendingRequests,
    isTrustedResponse,
    isStrictResponseTrust,
    validatePayload,
    isAllowedType,
    handlers,
    sendResponse
  });

  const dispose = () => {
    disposal.dispose(() => {
      pendingRequests.rejectAll(new CommandBusDisposedError('Bus disposed while awaiting response.'));
      clearHandlers();

      if (typeof unsubscribeReceive === 'function') {
        unsubscribeReceive();
      }

      unsubscribeReceive = undefined;
    });
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
