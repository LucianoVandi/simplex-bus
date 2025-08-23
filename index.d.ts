export class CommandBusError extends Error {}
export class CommandBusDisposedError extends CommandBusError {}
export class CommandBusValidationError extends CommandBusError {}
export class CommandBusSerializationError extends CommandBusError {}
export class CommandBusInvalidMessageError extends CommandBusError {}
export class CommandBusTimeoutError extends CommandBusError {
  type: string;
  timeout: number;
}
export class CommandBusAbortedError extends CommandBusError {
  type: string;
}
export class CommandBusRemoteError<TPayload = unknown> extends CommandBusError {
  type: string;
  payload: TPayload;
}

export interface RequestOptions {
  timeout?: number;
  signal?: AbortSignal;
}

export interface CommandContext<TResponse = unknown, TError = unknown> {
  respond(payload: TResponse): boolean;
  respondError(payload: TError): boolean;
}

export type CommandHandler<TPayload = unknown, TResponse = unknown, TError = unknown> = (
  payload: TPayload,
  context: CommandContext<TResponse, TError>
) => void;

export interface CreateCommandBusConfig {
  sendFn: (message: string) => void;
  onReceive?: (handler: (raw: string | Record<string, unknown>) => void) => void | (() => void);
  allowedTypes?: string[];
  validators?: Record<string, (payload: unknown) => boolean>;
  parser?: (raw: string) => Record<string, unknown>;
  serializer?: (message: Record<string, unknown>) => string;
  logger?: {
    error?: (...args: unknown[]) => void;
  };
  responseSuffix?: string;
}

export interface CommandBus {
  send(type: string, payload?: unknown): void;
  request(type: string, payload?: unknown, timeout?: number): Promise<unknown>;
  request(type: string, payload: unknown, options: RequestOptions): Promise<unknown>;
  receive(raw: string | Record<string, unknown>): void;
  on(type: string, handler: CommandHandler): () => boolean;
  once(type: string, handler: CommandHandler): () => boolean;
  off(type: string, handler?: CommandHandler): boolean;
  dispose(): void;
}

export function createCommandBus(config: CreateCommandBusConfig): CommandBus;
