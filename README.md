# CastReach — Full-Stack Implementation

Podcast booking platform connecting hosts and guests.

## Stack

| Layer     | Technology                        |
|-----------|-----------------------------------|
| Frontend  | React 19 + Vite                   |
| Backend   | Node.js + Express                 |
| Database  | MongoDB + Mongoose                |
| Auth      | JWT (access) + httpOnly cookie (refresh) |
| Payments  | Stripe Connect + Escrow           |
| Recording | Daily.co                          |
| AI        | Anthropic Claude API              |

## Project structure

```
castreach/
├── src/                        ← React frontend
│   ├── context/AuthContext.jsx ← JWT auth (UPDATED)
│   ├── pages/
│   │   ├── Onboarding.jsx      ← NEW
│   │   ├── RecordingRoom.jsx   ← NEW
│   │   └── Insights.jsx        ← NEW
│   ├── components/
│   │   ├── AvailabilityPicker.jsx  ← NEW
│   │   ├── AIAssistPanel.jsx       ← NEW
│   │   ├── BadgeDisplay.jsx        ← NEW
│   │   ├── BookingChatThread.jsx   ← NEW
│   │   ├── BookingWorkspace.jsx    ← NEW
│   │   └── RecommendedGuests.jsx   ← NEW
│   └── hooks/
│       ├── useBooking.js           ← NEW
│       └── useRealtimeMessages.js  ← NEW
│
└── server/                     ← Node.js API (NEW)
    ├── index.js
    ├── middleware/
    │   ├── verifyToken.js
    │   ├── validate.js         ← Zod schemas
    │   ├── rateLimit.js
    │   └── upload.js
    ├── models/                 ← Mongoose schemas
    │   ├── User.js
    │   ├── Booking.js
    │   ├── Message.js
    │   ├── Availability.js
    │   └── Notification.js
    ├── routes/
    │   ├── auth.js
    │   ├── users.js
    │   ├── bookings.js
    │   ├── messages.js
    │   ├── payments.js
    │   ├── availability.js
    │   ├── ai.js
    │   ├── moderation.js
    │   ├── recordings.js
    │   ├── analytics.js
    │   └── webhooks.js
    └── services/
        ├── stripe.js
        ├── matchmaking.js
        ├── badges.js
        ├── notifications.js
        └── daily.js
```

## Quick start

### Backend
```bash
cd server
cp .env.example .env        # fill in all keys
npm install
npm run dev                 # starts on :3001
```

### Frontend
```bash
# project root
cp .env.example .env.local  # set VITE_API_URL=http://localhost:3001/api
npm install
npm run dev                 # starts on :5173
```

## Environment variables

See `server/.env.example` for all required keys:
- `MONGODB_URI` — MongoDB Atlas connection string
- `JWT_SECRET` / `JWT_REFRESH_SECRET` — 64-char random strings
- `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` — from Stripe dashboard
- `DAILY_API_KEY` — from Daily.co dashboard
- `ANTHROPIC_API_KEY` — from console.anthropic.com

## API endpoints

| Method | Path                          | Auth | Description                  |
|--------|-------------------------------|------|------------------------------|
| POST   | /api/auth/register            | -    | Register new user            |
| POST   | /api/auth/login               | -    | Login, returns JWT           |
| POST   | /api/auth/refresh             | -    | Refresh access token         |
| POST   | /api/auth/logout              | JWT  | Logout, clears cookie        |
| GET    | /api/auth/me                  | JWT  | Get current user             |
| GET    | /api/users                    | -    | List/search users            |
| PATCH  | /api/users/me                 | JWT  | Update own profile           |
| GET    | /api/bookings                 | JWT  | List my bookings             |
| POST   | /api/bookings                 | JWT  | Create booking request       |
| PATCH  | /api/bookings/:id/confirm     | JWT  | Host confirms booking        |
| PATCH  | /api/bookings/:id/cancel      | JWT  | Cancel booking               |
| POST   | /api/bookings/:id/review      | JWT  | Submit review                |
| GET    | /api/messages/:bookingId      | JWT  | Get messages for booking     |
| POST   | /api/messages                 | JWT  | Send message                 |
| POST   | /api/payments/intent          | JWT  | Create Stripe escrow hold    |
| POST   | /api/payments/connect         | JWT  | Stripe Connect onboarding    |
| GET    | /api/availability/:userId     | -    | Get user's open slots        |
| POST   | /api/availability             | JWT  | Set my availability          |
| POST   | /api/ai/suggest               | JWT  | AI topic/question generation |
| POST   | /api/ai/bio-polish            | JWT  | AI bio improvement           |
| GET    | /api/analytics/me             | JWT  | Personal insights data       |
| POST   | /api/recordings/room          | JWT  | Create Daily.co room         |
| POST   | /api/webhooks/stripe          | -    | Stripe webhook handler       |

## Security checklist

- [x] Helmet.js HTTP headers
- [x] Rate limiting (global + auth-specific)
- [x] JWT access tokens (15 min) + httpOnly refresh cookie (7 days)
- [x] Zod input validation on all endpoints
- [x] bcryptjs password hashing (cost 12)
- [x] CORS restricted to CLIENT_URL
- [x] MIME-byte file upload verification
- [x] Stripe webhook signature verification
- [x] MongoDB parameterised queries via Mongoose (no SQL injection)
- [x] No secrets in client bundle (VITE_ prefix only)
