import { createCommandBus } from '../index.js';

/**
 * Example bridge for iframe parent <-> child messaging.
 * SECURITY: pass an explicit `targetOrigin` in production; "*" is demo-friendly only.
 */
export function createIframeBus({ targetWindow, targetOrigin = '*' }) {
  if (targetOrigin === '*') {
    console.warn('[SimplexBus demo] targetOrigin="*" is unsafe for production. Use an explicit origin.');
  }

  return createCommandBus({
    sendFn: (message) => targetWindow.postMessage(message, targetOrigin),
    onReceive: (handler) => {
      const listener = (event) => handler(event.data);
      window.addEventListener('message', listener);
      return () => window.removeEventListener('message', listener);
    },
    allowedTypes: ['ping'],
    validators: {
      ping: (payload) => payload && payload.value === 'ping',
      'ping-response': (payload) => payload && payload.value === 'pong'
    }
  });
}
