import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';

/**
 * useBooking — load and manage a single booking by ID.
 * Returns { booking, loading, error, confirm, cancel, refetch }
 */
export function useBooking(bookingId) {
  const { authFetch } = useAuth();
  const [booking, setBooking] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  const refetch = useCallback(async () => {
    if (!bookingId) return;
    setLoading(true);
    try {
      const res  = await authFetch(`/bookings/${bookingId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setBooking(data.booking);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [bookingId]);

  useEffect(() => { refetch(); }, [refetch]);

  const confirm = async () => {
    const res  = await authFetch(`/bookings/${bookingId}/confirm`, { method: 'PATCH' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    setBooking(data.booking);
    return data.booking;
  };

  const cancel = async () => {
    const res  = await authFetch(`/bookings/${bookingId}/cancel`, { method: 'PATCH' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    setBooking(data.booking);
    return data.booking;
  };

  const complete = async () => {
    const res  = await authFetch(`/bookings/${bookingId}/complete`, { method: 'PATCH' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    setBooking(data.booking);
    return data.booking;
  };

  const review = async ({ rating, comment }) => {
    const res  = await authFetch(`/bookings/${bookingId}/review`, {
      method: 'POST',
      body: JSON.stringify({ rating, comment }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    setBooking(data.booking);
    return data.booking;
  };

  return { booking, loading, error, confirm, cancel, complete, review, refetch };
}

/**
 * useBookings — load the list of my bookings.
 * Returns { bookings, loading, error, refetch }
 */
export function useBookings(statusFilter) {
  const { authFetch } = useAuth();
  const [bookings, setBookings] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');

  const refetch = useCallback(async () => {
    setLoading(true);
    try {
      const qs  = statusFilter ? `?status=${statusFilter}` : '';
      const res  = await authFetch(`/bookings${qs}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setBookings(data.bookings);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { refetch(); }, [refetch]);

  return { bookings, loading, error, refetch };
}
