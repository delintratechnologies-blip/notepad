const DAILY_API = 'https://api.daily.co/v1';

async function dailyFetch(path, method = 'GET', body) {
  const res = await fetch(`${DAILY_API}${path}`, {
    method,
    headers: {
      Authorization:  `Bearer ${process.env.DAILY_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Daily.co error: ${res.status}`);
  return res.json();
}

/**
 * Create a Daily.co room for a booking.
 * Returns { roomUrl }
 */
async function createDailyRoom(bookingId, expiryDate) {
  const room = await dailyFetch('/rooms', 'POST', {
    name:       `castreach-${bookingId}`,
    properties: {
      enable_recording: 'cloud',
      exp:              expiryDate
        ? Math.floor(new Date(expiryDate).getTime() / 1000) + 600
        : Math.floor(Date.now() / 1000) + 3 * 60 * 60,  // default 3 hours
    },
  });
  return { roomUrl: room.url };
}

module.exports = { createDailyRoom };
