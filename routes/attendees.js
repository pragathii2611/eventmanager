/**
 * routes/attendees.js
 * Attendee-side routes: home page (event listing), event detail page, booking
 */

const express = require('express');
const router = express.Router();

// ============================================================================
// DYNAMIC PRICING HELPER
// ============================================================================

/**
 * calculateCurrentPrice(ticketTypeId, callback)
 * Calculates the current tiered price for a ticket type based on % sold
 * Tiers:
 *   0–49% sold: base price × 1.0
 *   50–79% sold: base price × 1.15
 *   80–99% sold: base price × 1.3
 *   100% sold: null (waitlist only)
 */
function calculateCurrentPrice(ticketTypeId, callback) {
    const query = `
        SELECT
            t.price as base_price,
            t.quantity_total,
            COALESCE(SUM(CASE WHEN b.status = 'active' THEN b.quantity ELSE 0 END), 0) as sold,
            t.quantity_total - COALESCE(SUM(CASE WHEN b.status = 'active' THEN b.quantity ELSE 0 END), 0) as remaining
        FROM ticket_types t
        LEFT JOIN bookings b ON t.ticket_type_id = b.ticket_type_id
        WHERE t.ticket_type_id = ?
        GROUP BY t.ticket_type_id
    `;

    global.db.get(query, [ticketTypeId], function(err, row) {
        if (err) {
            return callback(err, null);
        }

        if (!row) {
            return callback(null, null);
        }

        // If all sold, return null (waitlist only)
        if (row.remaining === 0) {
            return callback(null, null);
        }

        // Calculate percentage sold
        const percentSold = (row.sold / row.quantity_total) * 100;

        // Apply tiered pricing
        let multiplier = 1.0;
        if (percentSold >= 80) {
            multiplier = 1.3;
        } else if (percentSold >= 50) {
            multiplier = 1.15;
        }

        const tieredPrice = Math.round(row.base_price * multiplier * 100) / 100;
        callback(null, tieredPrice);
    });
}

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

            // Get flash message if it exists
            const flash = req.session.flash;
            delete req.session.flash;

            res.render('attendee/home', {
                site_name: settings.site_name,
                site_description: settings.site_description,
                events: events,
                flash: flash
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

            // Calculate current tiered price for each ticket type
            let pricesCalculated = 0;
            ticketTypes.forEach(ticket => {
                calculateCurrentPrice(ticket.ticket_type_id, function(err, tieredPrice) {
                    ticket.current_price = tieredPrice; // null if sold out, otherwise tiered price
                    pricesCalculated++;

                    // Once all prices calculated, render
                    if (pricesCalculated === ticketTypes.length) {
                        // Get flash message if it exists
                        const flash = req.session.flash;
                        delete req.session.flash;

                        res.render('attendee/event', {
                            event: event,
                            ticketTypes: ticketTypes,
                            flash: flash
                        });
                    }
                });
            });

            // Handle edge case: no ticket types
            if (ticketTypes.length === 0) {
                const flash = req.session.flash;
                delete req.session.flash;
                res.render('attendee/event', {
                    event: event,
                    ticketTypes: ticketTypes,
                    flash: flash
                });
            }
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
                // Validation failed; rollback transaction and return error
                global.db.run('ROLLBACK', function() {
                    res.status(400).send('Not enough tickets available: ' + validationErrors.join(', '));
                });
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

    // Create booking records (wrapped in transaction for safety)
    const createdBookings = [];
    const createBookings = (index) => {
        if (index >= bookings.length) {
            // All bookings created successfully; commit transaction
            global.db.run('COMMIT', function(err) {
                if (err) {
                    return next(err);
                }

                // Store confirmation data in session for flash display
                req.session.bookingConfirmation = {
                    attendeeName: attendeeName,
                    bookings: createdBookings,
                    eventId: eventId
                };
                res.redirect(`/attendee/booking-confirmation`);
            });
            return;
        }

        const booking = bookings[index];

        // Calculate current tiered price at booking time
        calculateCurrentPrice(booking.ticketTypeId, function(err, tieredPrice) {
            if (err) {
                // Rollback on error
                global.db.run('ROLLBACK', function() {
                    return next(err);
                });
                return;
            }

            // tieredPrice is null if sold out, but we already validated availability
            const pricePaid = tieredPrice || 0;

            const insertQuery = `
                INSERT INTO bookings (event_id, ticket_type_id, attendee_name, quantity, price_paid, booked_at)
                VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            `;

            global.db.run(insertQuery, [eventId, booking.ticketTypeId, attendeeName, booking.quantity, pricePaid], function(err) {
                if (err) {
                    // Rollback on error
                    global.db.run('ROLLBACK', function() {
                        return next(err);
                    });
                    return;
                }

                // Store created booking info for confirmation page
                createdBookings.push({
                    ticketTypeId: booking.ticketTypeId,
                    quantity: booking.quantity,
                    bookingId: this.lastID,
                    pricePaid: pricePaid
                });

                createBookings(index + 1);
            });
        });
    };

    // Start transaction before validation
    global.db.run('BEGIN TRANSACTION', function(err) {
        if (err) {
            return next(err);
        }
        checkAvailability(0);
    });
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
    const attendeeEmail = req.body.waitlist_email;

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

    if (!attendeeName || !attendeeEmail || waitlistEntries.length === 0) {
        return res.status(400).send('Please enter name, email, and select at least one ticket type');
    }

    // For each waitlist entry, get the next position and insert
    const addToWaitlist = (index) => {
        if (index >= waitlistEntries.length) {
            // All waitlist entries added successfully
            req.session.flash = { type: 'success', message: 'You\'ve been added to the waitlist! We\'ll notify you if tickets become available.' };
            res.redirect(`/attendee/event/${eventId}`);
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
                INSERT INTO waitlist (event_id, ticket_type_id, attendee_name, attendee_email, requested_quantity, position, joined_at)
                VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            `;

            global.db.run(insertQuery, [eventId, entry.ticketTypeId, attendeeName, attendeeEmail, entry.quantity, nextPosition], function(err) {
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

/**
 * GET /attendee/booking-confirmation
 * Display booking confirmation as a styled ticket stub
 * Retrieves confirmation data from session and renders confirmation view
 */
router.get('/booking-confirmation', (req, res, next) => {
    const confirmation = req.session.bookingConfirmation;

    if (!confirmation) {
        return res.redirect('/attendee');
    }

    const eventId = confirmation.eventId;

    // Get event and ticket details for confirmation display
    const eventQuery = `
        SELECT e.event_id, e.title, e.event_date, e.description
        FROM events e
        WHERE e.event_id = ?
    `;

    global.db.get(eventQuery, [eventId], function(err, event) {
        if (err) {
            return next(err);
        }

        if (!event) {
            return res.redirect('/attendee');
        }

        // Get ticket type details for each booking
        const ticketQuery = `
            SELECT ticket_type_id, type, price
            FROM ticket_types
            WHERE event_id = ?
        `;

        global.db.all(ticketQuery, [eventId], function(err, tickets) {
            if (err) {
                return next(err);
            }

            // Map ticket info to bookings (use price_paid, not current price)
            const bookingDetails = confirmation.bookings.map(booking => {
                const ticket = tickets.find(t => t.ticket_type_id === booking.ticketTypeId);
                const pricePaidPerTicket = booking.pricePaid; // Price paid at booking time
                return {
                    ...booking,
                    ticketType: ticket ? ticket.type : 'Unknown',
                    pricePaid: pricePaidPerTicket,
                    total: pricePaidPerTicket * booking.quantity
                };
            });

            // Clear session confirmation after displaying
            delete req.session.bookingConfirmation;

            res.render('attendee/booking-confirmation', {
                attendeeName: confirmation.attendeeName,
                event: event,
                bookings: bookingDetails,
                totalPrice: bookingDetails.reduce((sum, b) => sum + b.total, 0)
            });
        });
    });
});

module.exports = router;
