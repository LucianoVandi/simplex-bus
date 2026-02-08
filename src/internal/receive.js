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
  const getPendingFromMessage = (message) => (message.id ? pendingRequests.get(message.id) : undefined);

  const tryNormalizeMessage = (raw) => {
    try {
      return normalizeIncomingMessage(raw, parser);
    } catch (error) {
      safeLogError('[SimplexBus] Invalid incoming message', error);
      return undefined;
    }
  };

  const isOversizedIncomingString = (raw) =>
    typeof raw === 'string' && getStringSizeInBytes(raw) > maxIncomingMessageBytes;

  const isTrustedPendingResponse = ({ message, pending, raw }) => {
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
      return false;
    }

    if (!trustedResponse) {
      safeLogError('[SimplexBus] Dropped untrusted response', {
        requestType: pending.type,
        requestId: message.id,
        responseType: message.type
      });
      return false;
    }

    if (isStrictResponseTrust && message.nonce !== pending.nonce) {
      safeLogError('[SimplexBus] Dropped response with invalid nonce', {
        requestType: pending.type,
        requestId: message.id,
        responseType: message.type
      });
      return false;
    }

    return true;
  };

  const settlePendingResponse = ({ message, pending }) => {
    try {
      validatePayload(message.type, message.payload);
    } catch (error) {
      pendingRequests.clear(message.id);
      pending.reject(error);
      return true;
    }

    pendingRequests.clear(message.id);
    if (message.isError) {
      pending.reject(new CommandBusRemoteError(pending.type, message.payload));
    } else {
      pending.resolve(message.payload);
    }

    return true;
  };

  const validateIncomingCommandPayload = (message) => {
    try {
      validatePayload(message.type, message.payload);
      return true;
    } catch (error) {
      safeLogError('[SimplexBus] Invalid incoming payload', error);
      return false;
    }
  };

  const createListenerContext = (message) => ({
    respond: (responsePayload) => sendResponse({ message, payload: responsePayload, isError: false }),
    respondError: (responsePayload) => sendResponse({ message, payload: responsePayload, isError: true })
  });

  const runListener = ({ listener, message, context }) => {
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
  };

  const dispatchToListeners = (message, listeners) => {
    const context = createListenerContext(message);
    for (const listener of listeners) {
      runListener({ listener, message, context });
    }
  };

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

    if (isOversizedIncomingString(raw)) {
      safeLogError(
        `[SimplexBus] Incoming message exceeds maxIncomingMessageBytes (${maxIncomingMessageBytes}).`
      );
      return;
    }

    const message = tryNormalizeMessage(raw);
    if (!message) {
      return;
    }

    const pending = getPendingFromMessage(message);
    if (pending && message.type === pending.expectedResponseType) {
      if (!isTrustedPendingResponse({ message, pending, raw })) {
        return;
      }
      settlePendingResponse({ message, pending });
      return;
    }

    if (!isAllowedType(message.type)) {
      return;
    }

    if (!validateIncomingCommandPayload(message)) {
      return;
    }

    const listeners = handlers.get(message.type);
    if (!listeners || listeners.size === 0) {
      return;
    }

    dispatchToListeners(message, listeners);
  };
};
