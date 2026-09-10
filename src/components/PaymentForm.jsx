import { useMemo, useState } from 'react';
import { CardElement, useStripe, useElements } from '@stripe/react-stripe-js';

// CardElement renders in a cross-origin iframe and cannot resolve the page's
// CSS custom properties, so read their computed values and pass concrete colors.
function cardOptions() {
  const root = typeof window !== 'undefined'
    ? getComputedStyle(document.documentElement)
    : null;
  const readVar = (name, fallback) =>
    (root?.getPropertyValue(name) || '').trim() || fallback;

  return {
    style: {
      base: {
        fontSize: '14px',
        color: readVar('--color-text-primary', '#0f172a'),
        fontFamily: 'inherit',
        '::placeholder': { color: readVar('--color-text-secondary', '#64748b') },
      },
      invalid: { color: readVar('--color-text-danger', '#b91c1c') },
    },
  };
}

/**
 * Guest card-collection + confirmation for a confirmed, paid booking.
 * Fetches a manual-capture PaymentIntent from POST /payments/intent, then
 * confirms the card client-side. A successful confirm leaves the intent in
 * `requires_capture` — the escrow hold — which the Stripe webhook turns into
 * paymentStatus: 'held'. Must be rendered inside <Elements>.
 */
export default function PaymentForm({ amountLabel, createPaymentIntent, onPaid }) {
  const stripe   = useStripe();
  const elements = useElements();
  const cardStyle = useMemo(cardOptions, []);

  const [submitting, setSubmitting] = useState(false);
  const [succeeded,  setSucceeded]  = useState(false);
  const [error,      setError]      = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!stripe || !elements || submitting) return;

    setSubmitting(true);
    setError('');

    try {
      const clientSecret = await createPaymentIntent();
      const result = await stripe.confirmCardPayment(clientSecret, {
        payment_method: { card: elements.getElement(CardElement) },
      });

      if (result.error) {
        setError(result.error.message || 'Card was declined.');
        return;
      }

      const status = result.paymentIntent?.status;
      if (status === 'requires_capture' || status === 'succeeded') {
        setSucceeded(true);
        onPaid?.();
      } else {
        setError(`Payment could not be completed (status: ${status}).`);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (succeeded) {
    return (
      <div style={{ fontSize: 13, color: 'var(--color-text-success)' }}>
        Payment authorized. The hold is being finalized — this page will update shortly.
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      <div
        style={{
          padding: '11px 12px',
          borderRadius: 8,
          border: '1.5px solid var(--color-border-tertiary)',
          background: 'var(--color-background-secondary)',
          marginBottom: 12,
        }}
      >
        <CardElement options={cardStyle} />
      </div>

      {error && (
        <div
          style={{
            marginBottom: 12,
            padding: '9px 12px',
            borderRadius: 8,
            background: 'var(--color-background-danger)',
            color: 'var(--color-text-danger)',
            fontSize: 12,
          }}
        >
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={!stripe || submitting}
        style={{
          width: '100%',
          padding: '9px 18px',
          border: 'none',
          borderRadius: 8,
          background: 'var(--color-accent)',
          color: '#fff',
          fontSize: 13,
          fontWeight: 600,
          cursor: submitting ? 'default' : 'pointer',
          opacity: !stripe || submitting ? 0.7 : 1,
        }}
      >
        {submitting ? 'Processing…' : `Pay ${amountLabel}`}
      </button>
    </form>
  );
}
