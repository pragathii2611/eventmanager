/**
 * routes/attendees.js
 * Attendee-side routes: home page (event listing), event detail page, booking
 */

const express = require('express');
const router = express.Router();

// ============================================================================
// ATTENDEE HOME PAGE
// ============================================================================

/**
 * GET /attendee
 * Attendee home page: list of published events ordered by date (soonest first)
 * Inputs: none
 * Outputs: rendered attendee/home.ejs with site info and event list
 */
router.get('/', (req, res, next) => {
    // Query 1: Get site settings
    const settingsQuery = "SELECT site_name, site_description FROM site_settings WHERE settings_id = 1";

    global.db.get(settingsQuery, function(err, settings) {
        if (err) {
            return next(err);
        }

        // Query 2: Get all published events ordered by event_date ASC (soonest first)
        const eventsQuery = `
            SELECT event_id, title, event_date
            FROM events
            WHERE status = 'published'
            ORDER BY event_date ASC
        `;

        global.db.all(eventsQuery, function(err, events) {
            if (err) {
                return next(err);
            }

            res.render('attendee/home', {
                site_name: settings.site_name,
                site_description: settings.site_description,
                events: events
            });
        });
    });
});

// ============================================================================
// ATTENDEE EVENT PAGE & BOOKING
// ============================================================================

/**
 * GET /attendee/event/:id
 * Event detail page: show event info, ticket types/prices, booking form
 * Inputs: event_id from URL
 * Outputs: rendered attendee/event.ejs with event and ticket type info
 */
router.get('/event/:id', (req, res, next) => {
    const eventId = req.params.id;

    // Query 1: Get event details
    const eventQuery = `
        SELECT * FROM events
        WHERE event_id = ? AND status = 'published'
    `;

    global.db.get(eventQuery, [eventId], function(err, event) {
        if (err) {
            return next(err);
        }

        if (!event) {
            return res.status(404).send('Event not found');
        }

        // Query 2: Get ticket types for this event with remaining availability
        // remaining = quantity_total - SUM(active bookings)
        const ticketsQuery = `
            SELECT
                t.ticket_type_id,
                t.type,
                t.price,
                t.quantity_total,
                COALESCE(SUM(CASE WHEN b.status = 'active' THEN b.quantity ELSE 0 END), 0) as booked,
                t.quantity_total - COALESCE(SUM(CASE WHEN b.status = 'active' THEN b.quantity ELSE 0 END), 0) as remaining
            FROM ticket_types t
            LEFT JOIN bookings b ON t.ticket_type_id = b.ticket_type_id
            WHERE t.event_id = ?
            GROUP BY t.ticket_type_id, t.type, t.price, t.quantity_total
        `;

        global.db.all(ticketsQuery, [eventId], function(err, ticketTypes) {
            if (err) {
                return next(err);
            }

            res.render('attendee/event', {
                event: event,
                ticketTypes: ticketTypes
            });
        });
    });
});

/**
 * POST /attendee/event/:id/book
 * Process ticket booking: create booking records, decrement available tickets
 * Inputs: event_id from URL, req.body with attendee_name and quantity per ticket type
 * Outputs: if validation passes, create bookings and redirect to confirmation
 *          if validation fails (not enough tickets), re-render with error
 */
router.post('/event/:id/book', (req, res, next) => {
    const eventId = req.params.id;
    const attendeeName = req.body.attendee_name;

    // Collect booking data: {ticket_type_id_X: quantity, ...}
    // Parse from form data
    const bookings = [];
    for (const [key, value] of Object.entries(req.body)) {
        if (key.startsWith('qty_')) {
            const ticketTypeId = parseInt(key.replace('qty_', ''));
            const quantity = parseInt(value);
            if (quantity > 0) {
                bookings.push({ ticketTypeId, quantity });
            }
        }
    }

    if (!attendeeName || bookings.length === 0) {
        return res.status(400).send('Please enter name and select at least one ticket');
    }

    // Validate availability for each ticket type
    // This is a simplified check; in production, use transactions
    let validationPassed = true;
    let validationErrors = [];

    // For each booking, check availability
    const checkAvailability = (index) => {
        if (index >= bookings.length) {
            if (validationPassed) {
                // All validations passed; create bookings
                createBookings(0);
            } else {
                // Validation failed; re-render with errors
                res.status(400).send('Not enough tickets available: ' + validationErrors.join(', '));
            }
            return;
        }

        const booking = bookings[index];
        const availQuery = `
            SELECT
                t.quantity_total,
                COALESCE(SUM(CASE WHEN b.status = 'active' THEN b.quantity ELSE 0 END), 0) as booked,
                t.quantity_total - COALESCE(SUM(CASE WHEN b.status = 'active' THEN b.quantity ELSE 0 END), 0) as remaining
            FROM ticket_types t
            LEFT JOIN bookings b ON t.ticket_type_id = b.ticket_type_id
            WHERE t.ticket_type_id = ?
            GROUP BY t.ticket_type_id
        `;

        global.db.get(availQuery, [booking.ticketTypeId], function(err, row) {
            if (err) {
                return next(err);
            }

            if (!row || row.remaining < booking.quantity) {
                validationPassed = false;
                validationErrors.push(`Ticket type ${booking.ticketTypeId}: only ${row ? row.remaining : 0} available`);
            }

            checkAvailability(index + 1);
        });
    };

    // Start validation chain
    checkAvailability(0);

    // Create booking records
    const createBookings = (index) => {
        if (index >= bookings.length) {
            // All bookings created successfully
            res.redirect(`/attendee/event/${eventId}?booked=1`);
            return;
        }

        const booking = bookings[index];
        const insertQuery = `
            INSERT INTO bookings (event_id, ticket_type_id, attendee_name, quantity, booked_at)
            VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
        `;

        global.db.run(insertQuery, [eventId, booking.ticketTypeId, attendeeName, booking.quantity], function(err) {
            if (err) {
                return next(err);
            }

            createBookings(index + 1);
        });
    };
});

/**
 * POST /attendee/event/:id/waitlist
 * Join the waitlist for sold-out ticket types
 * Inputs: event_id from URL, req.body with attendee_name and waitlist_qty_X for each ticket type
 * Outputs: create waitlist entries, redirect to event page with confirmation
 */
router.post('/event/:id/waitlist', (req, res, next) => {
    const eventId = req.params.id;
    const attendeeName = req.body.waitlist_name;

    // Collect waitlist data: {ticket_type_id_X: quantity, ...}
    const waitlistEntries = [];
    for (const [key, value] of Object.entries(req.body)) {
        if (key.startsWith('waitlist_qty_')) {
            const ticketTypeId = parseInt(key.replace('waitlist_qty_', ''));
            const quantity = parseInt(value);
            if (quantity > 0) {
                waitlistEntries.push({ ticketTypeId, quantity });
            }
        }
    }

    if (!attendeeName || waitlistEntries.length === 0) {
        return res.status(400).send('Please enter name and select at least one ticket type');
    }

    // For each waitlist entry, get the next position and insert
    const addToWaitlist = (index) => {
        if (index >= waitlistEntries.length) {
            // All waitlist entries added successfully
            res.redirect(`/attendee/event/${eventId}?waitlisted=1`);
            return;
        }

        const entry = waitlistEntries[index];

        // Query 1: Get the next position for this ticket type
        const maxPosQuery = `
            SELECT COALESCE(MAX(position), 0) + 1 as next_position
            FROM waitlist
            WHERE ticket_type_id = ?
        `;

        global.db.get(maxPosQuery, [entry.ticketTypeId], function(err, posRow) {
            if (err) {
                return next(err);
            }

            const nextPosition = posRow.next_position;

            // Query 2: Insert into waitlist
            const insertQuery = `
                INSERT INTO waitlist (event_id, ticket_type_id, attendee_name, requested_quantity, position, joined_at)
                VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            `;

            global.db.run(insertQuery, [eventId, entry.ticketTypeId, attendeeName, entry.quantity, nextPosition], function(err) {
                if (err) {
                    return next(err);
                }

                addToWaitlist(index + 1);
            });
        });
    };

    // Start adding waitlist entries
    addToWaitlist(0);
});

module.exports = router;
