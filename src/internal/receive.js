import { CommandBusRemoteError } from '../errors.js';
import { normalizeIncomingMessage } from './message.js';
import { getStringSizeInBytes } from './shared.js';

const isPromiseLike = (value) => value !== null && typeof value === 'object' && typeof value.then === 'function';

const toRemoteErrorPayload = (error) => ({
  message: error instanceof Error ? error.message : 'Unknown error'
});

export const createReceive = ({
  isDisposed,
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
}) => {
  const handleListenerFailure = (message, error) => {
    safeLogError(`[SimplexBus] Handler failed for type "${message.type}"`, error);

    if (!message.id) {
      return;
    }

    try {
      sendResponse({
        message,
        payload: toRemoteErrorPayload(error),
        isError: true
      });
    } catch (responseError) {
      safeLogError('[SimplexBus] Failed to send handler error response', responseError);
    }
  };

  return (raw) => {
    if (isDisposed()) {
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
      message = normalizeIncomingMessage(raw, parser);
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
        const result = listener(message.payload, context);
        if (isPromiseLike(result)) {
          result.catch((error) => {
            handleListenerFailure(message, error);
          });
        }
      } catch (error) {
        handleListenerFailure(message, error);
      }
    }
  };
};
