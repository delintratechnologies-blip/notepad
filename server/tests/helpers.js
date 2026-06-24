const request = require('supertest');
const app  = require('../app');
const User = require('../models/User');

/** Register a user through the API and return { token, user, password }. */
async function makeUser(overrides = {}) {
  const fields = {
    email:    `u${Date.now()}${Math.random().toString(36).slice(2, 7)}@test.com`,
    password: 'password123',
    name:     'Test User',
    role:     'guest',
    ...overrides,
  };
  const res = await request(app).post('/api/auth/register').send(fields);
  if (res.status !== 201) {
    throw new Error(`makeUser failed (${res.status}): ${JSON.stringify(res.body)}`);
  }
  return { token: res.body.token, user: res.body.user, password: fields.password };
}

/** Create an admin directly (no self-serve route) and log in for a token. */
async function makeAdmin() {
  const email = `admin${Date.now()}@test.com`;
  await User.create({ email, password: 'password123', name: 'Admin', role: 'admin' });
  const res = await request(app).post('/api/auth/login').send({ email, password: 'password123' });
  return { token: res.body.token, user: res.body.user };
}

/** Set the bearer token on a supertest request. */
const auth = (token) => (req) => req.set('Authorization', `Bearer ${token}`);

/** Convenience: a host whose sessions are free unless a rate is given. */
async function makeHost(rateCents = 0) {
  return makeUser({ role: 'host', name: 'Host', ...(rateCents ? {} : {}) }).then(async (h) => {
    if (rateCents) {
      await User.findByIdAndUpdate(h.user._id, { sessionRateCents: rateCents });
    }
    return h;
  });
}

module.exports = { app, request, makeUser, makeAdmin, makeHost, auth };
