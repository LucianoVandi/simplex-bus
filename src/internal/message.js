import {
  CommandBusInvalidMessageError,
  CommandBusSerializationError,
  CommandBusValidationError
} from '../errors.js';
import { isNonEmptyString, isObject } from './shared.js';

export const createPayloadValidator = (validators) => (type, payload) => {
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

export const normalizeIncomingMessage = (raw, parser) => {
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

export const serializeEnvelope = (serializer, type, message) => {
  try {
    return serializer(message);
  } catch (error) {
    throw new CommandBusSerializationError(`Failed to serialize message type "${type}".`, {
      cause: error
    });
  }
};
