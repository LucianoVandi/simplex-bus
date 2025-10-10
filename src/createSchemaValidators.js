import { CommandBusValidationError } from './errors.js';

const DEFAULT_RESPONSE_SUFFIX = '-response';

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Builds validator handlers for createCommandBus.validators from JSON Schemas.
 *
 * @param {object} config
 * @param {Record<string, { request?: object, response?: object, error?: object }>} config.schemaMap
 * @param {(schema: object) => (((payload: unknown) => boolean) & { errors?: unknown[] })} config.compile
 * @param {string} [config.responseSuffix]
 * @param {(details: { type: string, channel: 'request' | 'response' | 'error', payload: unknown, errors: unknown[] }) => void} [config.onValidationError]
 * @returns {Record<string, (payload: unknown) => boolean>}
 */
export function createSchemaValidators({
  schemaMap,
  compile,
  responseSuffix = DEFAULT_RESPONSE_SUFFIX,
  onValidationError
}) {
  if (!isObject(schemaMap)) {
    throw new TypeError('`schemaMap` must be an object.');
  }

  if (typeof compile !== 'function') {
    throw new TypeError('`compile` must be a function.');
  }

  if (onValidationError !== undefined && typeof onValidationError !== 'function') {
    throw new TypeError('`onValidationError` must be a function when provided.');
  }

  if (typeof responseSuffix !== 'string' || responseSuffix.length === 0) {
    throw new TypeError('`responseSuffix` must be a non-empty string.');
  }

  const toValidationError = (type, channel, payload, validator) => {
    const validationError = new CommandBusValidationError(
      `Schema validation failed for type "${type}" on ${channel}.`
    );

    const details = {
      type,
      channel,
      payload,
      errors: Array.isArray(validator.errors) ? validator.errors : []
    };

    if (onValidationError) {
      onValidationError(details);
    }

    validationError.details = details;
    return validationError;
  };

  const compileWithDiagnostics = (type, channel, schema) => {
    const validator = compile(schema);
    if (typeof validator !== 'function') {
      throw new CommandBusValidationError(
        `Compiled validator for type "${type}" on ${channel} must be a function.`
      );
    }

    return (payload) => {
      const isValid = validator(payload);
      if (!isValid) {
        throw toValidationError(type, channel, payload, validator);
      }
      return true;
    };
  };

  const validators = {};

  for (const [type, schemas] of Object.entries(schemaMap)) {
    if (!isObject(schemas)) {
      throw new CommandBusValidationError(`Schema entry for type "${type}" must be an object.`);
    }

    if (schemas.request) {
      validators[type] = compileWithDiagnostics(type, 'request', schemas.request);
    }

    const responseValidator = schemas.response
      ? compileWithDiagnostics(type, 'response', schemas.response)
      : undefined;
    const errorValidator = schemas.error ? compileWithDiagnostics(type, 'error', schemas.error) : undefined;
    if (responseValidator || errorValidator) {
      validators[`${type}${responseSuffix}`] = (payload) => {
        let responseFailure;
        let errorFailure;

        if (responseValidator) {
          try {
            if (responseValidator(payload)) {
              return true;
            }
          } catch (error) {
            responseFailure = error;
          }
        }

        if (errorValidator) {
          try {
            if (errorValidator(payload)) {
              return true;
            }
          } catch (error) {
            errorFailure = error;
          }
        }

        throw errorFailure || responseFailure || new CommandBusValidationError(
          `Schema validation failed for type "${type}" on response.`
        );
      };
    }
  }

  return validators;
}
