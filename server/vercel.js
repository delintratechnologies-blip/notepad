// Vercel serverless entry — wraps Express app without calling listen().
// Mongoose connection is cached across warm invocations.

const mongoose = require('mongoose');

let app = null;
let connected = false;
let connectError = null;

function getApp() {
  if (!app) app = require('./app');
  return app;
}

async function ensureConnected() {
  if (connected || mongoose.connection.readyState === 1) {
    connected = true;
    return;
  }
  if (!process.env.MONGODB_URI) {
    throw new Error('MONGODB_URI environment variable is not set');
  }
  await mongoose.connect(process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 5000,
    connectTimeoutMS: 5000,
  });
  connected = true;
  connectError = null;
}

module.exports = async (req, res) => {
  // Health check — skip DB, always respond immediately
  if (req.url === '/health' || req.url === '/api/health') {
    return res.writeHead(200, { 'Content-Type': 'application/json' }).end(
      JSON.stringify({
        status: 'ok',
        db: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
        mongoUriSet: !!process.env.MONGODB_URI,
        env: process.env.NODE_ENV || 'unknown',
        lastError: connectError,
      })
    );
  }

  try {
    await ensureConnected();
    return getApp()(req, res);
  } catch (err) {
    connectError = err.message;
    console.error('[vercel.js] fatal:', err.message);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: err.message,
        mongoUriSet: !!process.env.MONGODB_URI,
        dbState: mongoose.connection.readyState,
        hint: err.message.includes('ECONNREFUSED') || err.message.includes('timed out')
          ? 'MongoDB Atlas IP whitelist may be blocking Vercel. Add 0.0.0.0/0 in Atlas Network Access.'
          : err.message.includes('not set')
          ? 'Set MONGODB_URI in Vercel Environment Variables.'
          : 'Check Vercel logs for details.',
      }));
    }
  }
};
