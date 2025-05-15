/**
 * A simple, agnostic message bus for cross-context communication (WebView, iframe, etc.).
 *
 * Features:
 * - Optional message type validation
 * - Optional payload validation
 * - Listening and handling incoming messages
 * - Sending structured messages
 * - Asynchronous request/response handling using correlated IDs
 *
 * @example
 * const bus = createCommandBus({
 *   sendFn: msg => webview.postMessage(msg),
 *   onReceive: handler => window.addEventListener('message', e => handler(e.data)),
 *   allowedTypes: ['auth-token', 'get-token'],
 *   validators: {
 *     'auth-token': payload => typeof payload === 'string'
 *   }
 * });
 *
 * bus.on('get-token', (payload, context) => {
 *   context.respond('abc123');
 * });
 *
 * const token = await bus.request('get-token');
 */

export function createCommandBus({ sendFn, onReceive, allowedTypes = [], validators = {} }) {
    const handlers = {};
    const pendingRequests = {};
    let requestCounter = 0;

    /**
     * Generates a unique ID to correlate request/response.
     * @returns {string}
     */
    const generateId = () => `cmd-${Date.now()}-${++requestCounter}`;

    /**
     * Checks if the message type is allowed.
     * If the whitelist is empty, all types are allowed.
     * @param {string} type
     * @returns {boolean}
     */
    const isAllowed = (type) => {
        return allowedTypes.length === 0 || allowedTypes.includes(type);
    };

    /**
     * Validates the payload based on a validator function (if provided).
     * @param {string} type
     * @param {*} payload
     * @returns {boolean}
     */
    const validatePayload = (type, payload) => {
        const validator = validators[type];
        return validator ? validator(payload) : true;
    };

    /**
     * Sends a message to the remote context.
     * @param {string} type - Message type
     * @param {*} [payload] - Optional data
     * @param {string} [id] - Optional ID for tracking
     */
    const send = (type, payload, id) => {
        if (!isAllowed(type)) {
            throw new Error(`Message type not allowed: "${type}"`);
        }
        if (!validatePayload(type, payload)) {
            throw new Error(`Invalid payload for type "${type}"`);
        }

        const message = { type, payload, id };
        sendFn(JSON.stringify(message));
    };

    /**
     * Sends a request and waits for the correlated response via ID.
     * @param {string} type
     * @param {*} [payload]
     * @param {number} [timeout=5000] - Timeout in ms
     * @returns {Promise<*>}
     */
    const request = (type, payload, timeout = 5000) => {
        return new Promise((resolve, reject) => {
            const id = generateId();
            const timer = setTimeout(() => {
                delete pendingRequests[id];
                reject(new Error(`Request timeout for type "${type}"`));
            }, timeout);

            pendingRequests[id] = (responsePayload) => {
                clearTimeout(timer);
                resolve(responsePayload);
            };

            send(type, payload, id);
        });
    };

    /**
     * Handles incoming messages (JSON).
     * @param {string|object} raw - Raw message (JSON string or object)
     */
    const receive = (raw) => {
        try {
            const msg = typeof raw === 'string' ? JSON.parse(raw) : raw;
            if (!isAllowed(msg.type)) return;

            // If the message is an awaited response
            if (msg.id && pendingRequests[msg.id]) {
                const resolver = pendingRequests[msg.id];
                delete pendingRequests[msg.id];
                resolver(msg.payload);
                return;
            }

            const handler = handlers[msg.type];
            if (handler) {
                const context = {
                    /**
                     * Sends a response back to the sender using the same ID.
                     * @param {*} responsePayload
                     */
                    respond: (responsePayload) => {
                        if (!msg.id) return;
                        send(`${msg.type}-response`, responsePayload, msg.id);
                    }
                };

                handler(msg.payload, context);
            }
        } catch (e) {
            console.error('[SimplexBus] Invalid incoming message:', e);
        }
    };

    /**
     * Registers a handler for a message type.
     * @param {string} type
     * @param {Function} handler - receives (payload, context)
     */
    const on = (type, handler) => {
        if (!isAllowed(type)) {
            throw new Error(`\`Handler registration failed: type "${type}" not allowed.`);
        }
        handlers[type] = handler;
    };

    // Attach the receiver, if provided
    if (onReceive) onReceive(receive);

    return {
        send,
        receive,
        on,
        request
    };
}
