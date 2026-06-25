// Vercel serverless entry — wraps Express app without calling listen().
// Mongoose connection is cached across warm invocations.

const mongoose = require('mongoose');

let app = null;
let connected = false;

function getApp() {
  if (!app) app = require('./app');
  return app;
}

async function ensureConnected() {
  if (connected || mongoose.connection.readyState === 1) {
    connected = true;
    return;
  }
  await mongoose.connect(process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 5000,
    connectTimeoutMS: 5000,
  });
  connected = true;
}

module.exports = async (req, res) => {
  try {
    await ensureConnected();
    return getApp()(req, res);
  } catch (err) {
    console.error('[vercel.js] fatal:', err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    }
  }
};
