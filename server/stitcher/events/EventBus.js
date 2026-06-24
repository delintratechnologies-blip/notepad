/**
 * EventBus — lightweight in-process pub/sub for domain events.
 *
 * Design rules:
 *   1. In-process only. No external broker (Redis/RabbitMQ) — swap EventBus
 *      for a driver-backed implementation later without touching route handlers.
 *   2. Fire-and-forget emit(). Route handlers never await an event.
 *   3. Error isolation. One subscriber throwing must not block the others.
 *      Sync throws are caught per-handler. Async rejections are caught via
 *      the returned promise's .catch().
 *   4. ID-only payloads. Payloads carry IDs, not full Mongoose documents.
 *      This keeps payloads serializable and prevents accidental PII leaks.
 *   5. Unsubscribe function. on() returns a function that calls off() for
 *      clean test teardown and short-lived subscriptions.
 *
 * Usage:
 *   const unsubscribe = stitcher.events.on(EVENTS.BOOKING_CREATED, handler);
 *   stitcher.events.emit(EVENTS.BOOKING_CREATED, { bookingId, hostId, guestId });
 *   unsubscribe();  // cleanup
 */

class EventBus {
  constructor() {
    this._handlers   = new Map();  // eventName → Set<handler>
    this._emitCount  = 0;
    this._errorCount = 0;
  }

  /**
   * Register a subscriber for an event.
   *
   * @param {string}   event    - Event name from EVENTS constants.
   * @param {Function} handler  - Called with (payload, eventName). May be async.
   * @returns {Function} Unsubscribe — call to remove this subscription.
   */
  on(event, handler) {
    if (typeof event !== 'string' || !event) {
      throw new Error('[EventBus] event name must be a non-empty string');
    }
    if (typeof handler !== 'function') {
      throw new Error('[EventBus] handler must be a function');
    }

    if (!this._handlers.has(event)) {
      this._handlers.set(event, new Set());
    }
    this._handlers.get(event).add(handler);

    return () => this.off(event, handler);
  }

  /**
   * Remove a previously registered subscriber.
   */
  off(event, handler) {
    this._handlers.get(event)?.delete(handler);
    return this;
  }

  /**
   * Emit an event — synchronous dispatch with per-handler error isolation.
   *
   * Payloads MUST contain IDs (strings / ObjectIds), not full Mongoose
   * documents. This is enforced by convention, not runtime validation,
   * to keep the hot path allocation-free.
   *
   * @param {string} event   - Event name.
   * @param {object} payload - ID-only payload. No full documents.
   */
  emit(event, payload = {}) {
    if (typeof event !== 'string' || !event) {
      throw new Error('[EventBus] event name must be a non-empty string');
    }

    this._emitCount++;

    const handlers = this._handlers.get(event);
    if (!handlers || handlers.size === 0) return;

    for (const handler of handlers) {
      try {
        const result = handler(payload, event);
        // Async handlers: catch rejections so they don't become unhandled.
        if (result !== null && typeof result === 'object' && typeof result.catch === 'function') {
          result.catch((err) => {
            this._errorCount++;
            console.error(`[EventBus] Async handler error on '${event}':`, err.message);
          });
        }
      } catch (err) {
        this._errorCount++;
        console.error(`[EventBus] Sync handler error on '${event}':`, err.message);
      }
    }
  }

  /**
   * Number of subscribers registered for a given event.
   */
  listenerCount(event) {
    return this._handlers.get(event)?.size ?? 0;
  }

  /**
   * All registered event names that have at least one subscriber.
   */
  registeredEvents() {
    return [...this._handlers.entries()]
      .filter(([, handlers]) => handlers.size > 0)
      .map(([name]) => name);
  }

  /**
   * Operational stats — safe to expose in health endpoint.
   */
  stats() {
    const events = [...this._handlers.entries()]
      .filter(([, handlers]) => handlers.size > 0)
      .map(([name, handlers]) => ({ name, listenerCount: handlers.size }));

    return {
      emitCount:  this._emitCount,
      errorCount: this._errorCount,
      events,
    };
  }
}

module.exports = EventBus;
