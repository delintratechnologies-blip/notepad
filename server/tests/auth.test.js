const jwt = require('jsonwebtoken');
const { request, app, makeUser } = require('./helpers');

describe('Auth', () => {
  test('register returns a token and user, omits password', async () => {
    const res = await request(app).post('/api/auth/register').send({
      email: 'reg@test.com', password: 'password123', name: 'Reg User', role: 'guest',
    });
    expect(res.status).toBe(201);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.email).toBe('reg@test.com');
    expect(res.body.user.password).toBeUndefined();
    expect(res.body.user.refreshToken).toBeUndefined();
  });

  test('access token carries the user role (BLK-3)', async () => {
    const { token, user } = await makeUser({ role: 'host' });
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    expect(decoded.role).toBe('host');
    expect(decoded.id).toBe(user._id);
  });

  test('duplicate email is rejected', async () => {
    await makeUser({ email: 'dup@test.com' });
    const res = await request(app).post('/api/auth/register').send({
      email: 'dup@test.com', password: 'password123', name: 'Dup', role: 'guest',
    });
    expect(res.status).toBe(409);
  });

  test('login with wrong password is 401', async () => {
    await makeUser({ email: 'login@test.com', password: 'password123' });
    const res = await request(app).post('/api/auth/login').send({
      email: 'login@test.com', password: 'wrongpass',
    });
    expect(res.status).toBe(401);
  });

  test('weak password fails validation (422)', async () => {
    const res = await request(app).post('/api/auth/register').send({
      email: 'weak@test.com', password: 'short', name: 'Weak', role: 'guest',
    });
    expect(res.status).toBe(422);
  });
});
