import { CommandBusValidationError } from './errors.js';

const DEFAULT_RESPONSE_SUFFIX = '-response';

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Builds validator handlers for createCommandBus.validators from JSON Schemas.
 *
 * @param {object} config
 * @param {Record<string, { request?: object, response?: object, error?: object }>} config.schemaMap
 * @param {(schema: object) => ((payload: unknown) => boolean)} config.compile
 * @param {string} [config.responseSuffix]
 * @returns {Record<string, (payload: unknown) => boolean>}
 */
export function createSchemaValidators({
  schemaMap,
  compile,
  responseSuffix = DEFAULT_RESPONSE_SUFFIX
}) {
  if (!isObject(schemaMap)) {
    throw new TypeError('`schemaMap` must be an object.');
  }

  if (typeof compile !== 'function') {
    throw new TypeError('`compile` must be a function.');
  }

  if (typeof responseSuffix !== 'string' || responseSuffix.length === 0) {
    throw new TypeError('`responseSuffix` must be a non-empty string.');
  }

  const validators = {};

  for (const [type, schemas] of Object.entries(schemaMap)) {
    if (!isObject(schemas)) {
      throw new CommandBusValidationError(`Schema entry for type "${type}" must be an object.`);
    }

    if (schemas.request) {
      validators[type] = compile(schemas.request);
    }

    const responseValidator = schemas.response ? compile(schemas.response) : undefined;
    const errorValidator = schemas.error ? compile(schemas.error) : undefined;
    if (responseValidator || errorValidator) {
      validators[`${type}${responseSuffix}`] = (payload) => {
        if (responseValidator && responseValidator(payload)) {
          return true;
        }
        if (errorValidator && errorValidator(payload)) {
          return true;
        }
        return false;
      };
    }
  }

  return validators;
}
