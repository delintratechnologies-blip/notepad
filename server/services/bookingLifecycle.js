const { releaseEscrow } = require('./stripe');
const { notify }        = require('./notifications');

/** Normalise a populated doc or raw ObjectId to a string id. */
const idOf = (ref) =>
  (ref && ref._id ? ref._id : ref)?.toString();

/**
 * Transition a confirmed booking to `completed` (BLK-1).
 *
 * Shared by the manual "mark complete" endpoint and the Daily.co recording
 * webhook so the post-session loop (review -> rating -> badges) becomes
 * reachable. Idempotent: a booking already completed is returned untouched.
 *
 * Releases the escrow hold if one exists. Escrow failures are logged but do
 * not block completion — funds can be reconciled separately.
 *
 * `booking.host` should be populated with `stripeAccountId` before calling so
 * the escrow transfer destination is available.
 */
async function completeBooking(booking) {
  if (!booking || booking.status === 'completed') return booking;

  if (booking.paymentStatus === 'held' && booking.stripePaymentIntentId) {
    try {
      await releaseEscrow(booking.stripePaymentIntentId, booking.host?.stripeAccountId);
      booking.paymentStatus = 'released';
    } catch (err) {
      console.error(`Escrow release failed for booking ${booking._id}:`, err.message);
    }
  }

  booking.status         = 'completed';
  booking.recordingReady = true;
  await booking.save();

  const hostId  = idOf(booking.host);
  const guestId = idOf(booking.guest);

  await Promise.all([
    notify(hostId, {
      type:  'review',
      title: 'Session complete',
      body:  'Your session is complete — leave a review for your guest.',
      link:  `/bookings/${booking._id}`,
    }),
    notify(guestId, {
      type:  'review',
      title: 'Session complete',
      body:  'Your session is complete — leave a review for your host.',
      link:  `/bookings/${booking._id}`,
    }),
  ]);

  return booking;
}

module.exports = { completeBooking, idOf };
