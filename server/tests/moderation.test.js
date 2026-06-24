const { request, app, makeUser, makeAdmin } = require('./helpers');
const Report = require('../models/Report');

describe('Moderation — admin gate (BLK-3)', () => {
  test('non-admin cannot block a user', async () => {
    const actor  = await makeUser({ role: 'guest' });
    const target = await makeUser({ role: 'host' });

    const res = await request(app)
      .post(`/api/moderation/block/${target.user._id}`)
      .set('Authorization', `Bearer ${actor.token}`);

    expect(res.status).toBe(403);
  });

  test('admin can block and unblock a user', async () => {
    const admin  = await makeAdmin();
    const target = await makeUser({ role: 'host' });

    const blocked = await request(app)
      .post(`/api/moderation/block/${target.user._id}`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(blocked.status).toBe(200);
    expect(blocked.body.user.isBlocked).toBe(true);
    // SEC-5: email must not appear in the response
    expect(blocked.body.user.email).toBeUndefined();

    const unblocked = await request(app)
      .post(`/api/moderation/unblock/${target.user._id}`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(unblocked.status).toBe(200);
    expect(unblocked.body.user.isBlocked).toBe(false);
  });

  test('blocked user cannot log in', async () => {
    const admin  = await makeAdmin();
    const victim = await makeUser({ email: 'victim@test.com', role: 'guest' });

    await request(app)
      .post(`/api/moderation/block/${victim.user._id}`)
      .set('Authorization', `Bearer ${admin.token}`);

    const res = await request(app).post('/api/auth/login').send({
      email: 'victim@test.com', password: victim.password,
    });
    expect(res.status).toBe(403);
  });
});

describe('Moderation — report persistence (BUG-5)', () => {
  test('report is persisted to the database', async () => {
    const reporter = await makeUser({ role: 'guest' });
    const reported = await makeUser({ role: 'host' });

    const res = await request(app)
      .post('/api/moderation/report')
      .set('Authorization', `Bearer ${reporter.token}`)
      .send({ reportedId: reported.user._id, reason: 'Suspicious behaviour in the session.' });

    expect(res.status).toBe(200);
    expect(res.body.reportId).toBeTruthy();

    const doc = await Report.findById(res.body.reportId);
    expect(doc).not.toBeNull();
    expect(doc.reason).toBe('Suspicious behaviour in the session.');
  });

  test('report requires authentication', async () => {
    const reported = await makeUser({ role: 'host' });
    const res = await request(app)
      .post('/api/moderation/report')
      .send({ reportedId: reported.user._id, reason: 'Some reason here for length.' });
    expect(res.status).toBe(401);
  });

  test('report reason must be at least 10 characters', async () => {
    const reporter = await makeUser({ role: 'guest' });
    const reported = await makeUser({ role: 'host' });

    const res = await request(app)
      .post('/api/moderation/report')
      .set('Authorization', `Bearer ${reporter.token}`)
      .send({ reportedId: reported.user._id, reason: 'short' });
    expect(res.status).toBe(422);
  });

  test('cannot report an invalid user ID', async () => {
    const reporter = await makeUser({ role: 'guest' });

    const res = await request(app)
      .post('/api/moderation/report')
      .set('Authorization', `Bearer ${reporter.token}`)
      .send({ reportedId: 'not-a-valid-id', reason: 'Some valid reason here.' });
    expect(res.status).toBe(422);
  });

  test('admin can list open reports', async () => {
    const admin    = await makeAdmin();
    const reporter = await makeUser({ role: 'guest' });
    const reported = await makeUser({ role: 'host' });

    await Report.create({
      reporter: reporter.user._id,
      reported: reported.user._id,
      reason:   'Test report for admin list.',
    });

    const res = await request(app)
      .get('/api/moderation/reports')
      .set('Authorization', `Bearer ${admin.token}`);
    expect(res.status).toBe(200);
    expect(res.body.reports.length).toBeGreaterThan(0);
    expect(res.body.pagination).toBeDefined();
  });

  test('non-admin cannot list reports', async () => {
    const user = await makeUser({ role: 'guest' });
    const res = await request(app)
      .get('/api/moderation/reports')
      .set('Authorization', `Bearer ${user.token}`);
    expect(res.status).toBe(403);
  });
});
