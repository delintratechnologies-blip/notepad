import { loadStripe } from '@stripe/stripe-js';

const publishableKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;

// loadStripe must be called once at module scope, never inside a render.
// Resolves to null when the key is absent so the UI can show a clear
// "payments not configured" message instead of a broken Elements mount.
export const stripePromise = publishableKey
  ? loadStripe(publishableKey)
  : Promise.resolve(null);

export const stripeConfigured = Boolean(publishableKey);
