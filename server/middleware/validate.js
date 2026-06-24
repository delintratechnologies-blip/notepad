const { z } = require('zod');

/**
 * Factory — returns Express middleware that validates req.body against schema.
 * Usage: router.post('/route', validate(MySchema), handler)
 */
const validate = (schema) => (req, res, next) => {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    return res.status(422).json({
      error: 'Validation failed',
      details: result.error.flatten().fieldErrors,
    });
  }
  req.body = result.data;   // replace with sanitised/coerced values
  next();
};

// ── Shared schemas ────────────────────────────────────────────────────────────

const RegisterSchema = z.object({
  email:    z.string().email(),
  password: z.string().min(8).max(128),
  name:     z.string().min(2).max(80),
  role:     z.enum(['host', 'guest']),
});

const LoginSchema = z.object({
  email:    z.string().email(),
  password: z.string().min(1),
});

const BookingSchema = z.object({
  hostId:    z.string().min(1),
  slotStart: z.string().datetime(),
  slotEnd:   z.string().datetime(),
  topics:    z.array(z.string()).optional(),
  message:   z.string().max(500).optional(),
});

const MessageSchema = z.object({
  bookingId: z.string().min(1),
  content:   z.string().min(1).max(2000),
});

const AvailabilitySchema = z.object({
  slots: z.array(
    z.object({
      start: z.string().datetime(),
      end:   z.string().datetime(),
    })
  ).min(1),
});

const ReviewSchema = z.object({
  rating:  z.number().int().min(1).max(5),
  comment: z.string().max(500).optional(),
});

const OBJECT_ID = /^[a-f\d]{24}$/i;

const ReportSchema = z.object({
  reportedId: z.string().regex(OBJECT_ID, 'Invalid user ID'),
  reason:     z.string().min(10).max(1000),
});

module.exports = {
  validate,
  RegisterSchema,
  LoginSchema,
  BookingSchema,
  MessageSchema,
  AvailabilitySchema,
  ReviewSchema,
  ReportSchema,
};
