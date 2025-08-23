export class CommandBusError extends Error {
  constructor(message, options = {}) {
    super(message, options);
    this.name = this.constructor.name;
  }
}

export class CommandBusDisposedError extends CommandBusError {}

export class CommandBusValidationError extends CommandBusError {}

export class CommandBusSerializationError extends CommandBusError {}

export class CommandBusInvalidMessageError extends CommandBusError {}

export class CommandBusTimeoutError extends CommandBusError {
  constructor(type, timeout) {
    super(`Request timeout for type "${type}" after ${timeout}ms`);
    this.type = type;
    this.timeout = timeout;
  }
}

export class CommandBusAbortedError extends CommandBusError {
  constructor(type) {
    super(`Request aborted for type "${type}"`);
    this.type = type;
  }
}

export class CommandBusRemoteError extends CommandBusError {
  constructor(type, payload) {
    super(`Remote handler returned an error for type "${type}"`);
    this.type = type;
    this.payload = payload;
  }
}
