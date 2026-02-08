import { CommandBusValidationError } from '../errors.js';
import { serializeEnvelope } from './message.js';

export const createSendEnvelope = ({
  assertNotDisposed,
  isAllowedType,
  validatePayload,
  serializer,
  sendFn
}) => (message, { skipTypeGuard = false } = {}) => {
  assertNotDisposed();

  if (!skipTypeGuard && !isAllowedType(message.type)) {
    throw new CommandBusValidationError(`Message type not allowed: "${message.type}".`);
  }

  validatePayload(message.type, message.payload);

  const serialized = serializeEnvelope(serializer, message.type, message);
  sendFn(serialized);
};

export const createSendResponse = ({ getResponseType, sendEnvelope }) => ({ message, payload, isError }) => {
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
