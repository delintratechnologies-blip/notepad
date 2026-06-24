/**
 * EVENTS — typed event name constants for the CastReach domain.
 *
 * Convention for payloads — IDs only, no full documents:
 *
 *   USER_REGISTERED    { userId, role }
 *   BOOKING_CREATED    { bookingId, hostId, guestId, amountCents }
 *   BOOKING_CONFIRMED  { bookingId, hostId, guestId }
 *   BOOKING_CANCELLED  { bookingId, hostId, guestId, refunded }
 *   BOOKING_COMPLETED  { bookingId, hostId, guestId }
 *   BOOKING_REVIEWED   { bookingId, reviewerId, reviewedId, rating }
 *   REPORT_FILED       { reportId, reporterId, reportedId }
 *   USER_BLOCKED       { userId, actorId }
 *   USER_UNBLOCKED     { userId, actorId }
 *   DISPUTE_RAISED     { disputeId, bookingId, raisedById, againstId }
 *   DISPUTE_RESOLVED   { disputeId, bookingId, resolverId }
 *   DISPUTE_DISMISSED  { disputeId, bookingId, actorId }
 *
 * Add new event names here as features are built. Never use raw strings in
 * route handlers — always import from this file so typos are caught at startup.
 */

const EVENTS = Object.freeze({
  USER_REGISTERED:   'user.registered',
  BOOKING_CREATED:   'booking.created',
  BOOKING_CONFIRMED: 'booking.confirmed',
  BOOKING_CANCELLED: 'booking.cancelled',
  BOOKING_COMPLETED: 'booking.completed',
  BOOKING_REVIEWED:  'booking.reviewed',
  REPORT_FILED:      'report.filed',
  USER_BLOCKED:      'user.blocked',
  USER_UNBLOCKED:    'user.unblocked',
  DISPUTE_RAISED:    'dispute.raised',
  DISPUTE_RESOLVED:  'dispute.resolved',
  DISPUTE_DISMISSED: 'dispute.dismissed',
});

module.exports = EVENTS;
