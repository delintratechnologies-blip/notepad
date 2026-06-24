// Vercel serverless entry — wraps Express app without calling listen().
// Mongoose connection is cached across warm invocations.
require('dotenv').config();

const mongoose = require('mongoose');
const app = require('./app');

let connected = false;

async function ensureConnected() {
  if (connected || mongoose.connection.readyState === 1) {
    connected = true;
    return;
  }
  await mongoose.connect(process.env.MONGODB_URI);
  connected = true;
}

module.exports = async (req, res) => {
  await ensureConnected();
  return app(req, res);
};
