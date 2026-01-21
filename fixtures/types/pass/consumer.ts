import {
  createCommandBus,
  createSchemaValidators,
  CommandBusLimitError,
  type CreateSchemaValidatorsConfig
} from '../../../index.js';

const bus = createCommandBus({
  sendFn: (_message: string) => {},
  maxIncomingMessageBytes: 1024,
  maxPendingRequests: 10
});

bus.send('ping', { ok: true });
void bus.request('ping', { id: '1' }, { timeout: 1000 });

const schemaConfig: CreateSchemaValidatorsConfig = {
  schemaMap: {
    ping: {
      request: { type: 'object' },
      response: { type: 'object' }
    }
  },
  compile: () => {
    const validator: ((payload: unknown) => boolean) & { errors?: unknown[] } = (_payload: unknown) =>
      true;
    validator.errors = [];
    return validator;
  },
  onValidationError: (details) => {
    const channel: 'request' | 'response' | 'error' = details.channel;
    void channel;
  }
};

const validators = createSchemaValidators(schemaConfig);
validators.ping({});
validators['ping-response']({});

const limitError = new CommandBusLimitError('limit reached');
limitError.message;
