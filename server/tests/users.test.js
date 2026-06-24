const { request, app, makeUser } = require('./helpers');

describe('Users — PII exposure (BLK-5)', () => {
  test('GET /api/users requires authentication', async () => {
    const res = await request(app).get('/api/users');
    expect(res.status).toBe(401);
  });

  test('GET /api/users never returns email for listed users', async () => {
    await makeUser({ role: 'host', name: 'Listed Host' });
    const viewer = await makeUser({ role: 'guest' });

    const res = await request(app)
      .get('/api/users?role=host')
      .set('Authorization', `Bearer ${viewer.token}`);

    expect(res.status).toBe(200);
    expect(res.body.users.length).toBeGreaterThan(0);
    for (const u of res.body.users) {
      expect(u.email).toBeUndefined();
      expect(u.password).toBeUndefined();
    }
  });

  test('GET /api/users/:id hides email of OTHER users', async () => {
    const target = await makeUser({ role: 'host' });
    const viewer = await makeUser({ role: 'guest' });

    const res = await request(app)
      .get(`/api/users/${target.user._id}`)
      .set('Authorization', `Bearer ${viewer.token}`);

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBeUndefined();
  });

  test('GET /api/users/:id shows OWN email', async () => {
    const me = await makeUser({ role: 'guest' });
    const res = await request(app)
      .get(`/api/users/${me.user._id}`)
      .set('Authorization', `Bearer ${me.token}`);

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(me.user.email);
  });
});
