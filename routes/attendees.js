/**
 * All the routes for the attendee side of the app: browsing events,
 * viewing a single event, booking tickets, joining the waitlist, and
 * showing the booking confirmation page.
 */

const express = require('express');
const router = express.Router();
const { calculateCurrentPrice } = require('../lib/pricing');

/**
 * Calendar files (.ics) use commas, semicolons and newlines as special
 * characters, so if an event title or description contains one of these
 * it needs to be escaped first or it will break the file.
 */
function escapeICSText(text) {
    return String(text)
        .replace(/\\/g, '\\\\')
        .replace(/;/g, '\\;')
        .replace(/,/g, '\\,')
        .replace(/\n/g, '\\n');
}

/**
 * Turns a date from the database (e.g. "2026-07-15 09:00:00") into the
 * date format that .ics calendar files expect (e.g. "20260715T090000").
 * Can also add extra hours on, which is used to work out the end time
 * of the event since we only store a start time in the database.
 */
function formatICSDateTime(sqliteDateStr, addHours) {
    const [datePart, timePart] = sqliteDateStr.split(' ');
    const [year, month, day] = datePart.split('-').map(Number);
    const [hour, minute, second] = timePart.split(':').map(Number);

    const dt = new Date(Date.UTC(year, month - 1, day, hour, minute, second || 0));
    if (addHours) {
        dt.setUTCHours(dt.getUTCHours() + addHours);
    }

    const pad = (n) => String(n).padStart(2, '0');
    return `${dt.getUTCFullYear()}${pad(dt.getUTCMonth() + 1)}${pad(dt.getUTCDate())}T${pad(dt.getUTCHours())}${pad(dt.getUTCMinutes())}${pad(dt.getUTCSeconds())}`;
}

/**
 * Lets an attendee download the event as a calendar file so they can
 * add it to Google Calendar, Outlook, Apple Calendar, etc.
 * Since we don't store an end time in the database, the event is
 * assumed to last 1 hour.
 * Inputs: event_id from the URL
 * Outputs: a downloadable .ics file, or 404 if the event doesn't exist
 */
router.get('/event/:id/calendar.ics', (req, res, next) => {
    const eventId = req.params.id;

    // Only published events can be downloaded, same as everywhere else
    const eventQuery = "SELECT event_id, title, description, event_date FROM events WHERE event_id = ? AND status = 'published'";

    global.db.get(eventQuery, [eventId], function(err, event) {
        if (err) {
            return next(err);
        }

        if (!event) {
            return res.status(404).send('Event not found');
        }

        const dtStart = formatICSDateTime(event.event_date, 0);
        const dtEnd = formatICSDateTime(event.event_date, 1);
        const dtStamp = formatICSDateTime(new Date().toISOString().slice(0, 19).replace('T', ' '), 0);

        const icsContent = [
            'BEGIN:VCALENDAR',
            'VERSION:2.0',
            'PRODID:-//Event Manager//Booking//EN',
            'CALSCALE:GREGORIAN',
            'BEGIN:VEVENT',
            `UID:event-${event.event_id}@eventmanager.local`,
            `DTSTAMP:${dtStamp}Z`,
            `DTSTART:${dtStart}`,
            `DTEND:${dtEnd}`,
            `SUMMARY:${escapeICSText(event.title)}`,
            `DESCRIPTION:${escapeICSText(event.description || '')}`,
            'END:VEVENT',
            'END:VCALENDAR'
        ].join('\r\n');

        res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${event.title.replace(/[^a-z0-9]/gi, '-')}.ics"`);
        res.send(icsContent);
    });
});

/**
 * The attendee home page. Shows the site name/description and a list
 * of all published events, soonest first.
 * Inputs: none
 * Outputs: renders attendee/home.ejs with the site info and event list
 */
router.get('/', (req, res, next) => {
    // First get the site name and description to show at the top of the page
    const settingsQuery = "SELECT site_name, site_description FROM site_settings WHERE settings_id = 1";

    global.db.get(settingsQuery, function(err, settings) {
        if (err) {
            return next(err);
        }

        // Then get every published event, soonest event first
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

            // Show a success/error message left over from the last action, if any
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

/**
 * Shows the details for one event, including its ticket types and
 * current prices, plus the booking form.
 * Inputs: event_id from the URL
 * Outputs: renders attendee/event.ejs with the event and ticket type info
 */
router.get('/event/:id', (req, res, next) => {
    const eventId = req.params.id;

    // Get the event itself (must be published, not a draft)
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

        // Get each ticket type for this event, working out how many are
        // left by subtracting active bookings from the total quantity
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

            // Work out the current dynamic price for each ticket type before
            // rendering the page (waits until all of them are done)
            let pricesCalculated = 0;
            ticketTypes.forEach(ticket => {
                calculateCurrentPrice(ticket.ticket_type_id, function(err, tieredPrice) {
                    ticket.current_price = tieredPrice; // null means sold out
                    pricesCalculated++;

                    if (pricesCalculated === ticketTypes.length) {
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

            // If there are no ticket types at all, just render straight away
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
 * Books tickets for an attendee. Checks there's enough availability
 * before creating the booking rows, all wrapped in a database
 * transaction so two people booking at the same time can't oversell.
 * Inputs: event_id from the URL, req.body with attendee_name and a
 *         quantity field for each ticket type (e.g. qty_1, qty_2)
 * Outputs: creates the booking(s) and redirects to the confirmation
 *          page, or sends an error if there aren't enough tickets
 */
router.post('/event/:id/book', (req, res, next) => {
    const eventId = req.params.id;
    const attendeeName = req.body.attendee_name;

    // Pull out every "qty_X" field from the form into a simple list
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

    let validationPassed = true;
    let validationErrors = [];

    // Goes through each requested ticket type one at a time and checks
    // there are actually enough tickets left before booking anything
    const checkAvailability = (index) => {
        if (index >= bookings.length) {
            if (validationPassed) {
                createBookings(0);
            } else {
                // Not enough tickets somewhere, so undo the transaction
                global.db.run('ROLLBACK', function() {
                    res.status(400).send('Not enough tickets available: ' + validationErrors.join(', '));
                });
            }
            return;
        }

        const booking = bookings[index];

        // Check how many tickets are actually still available right now
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

    // Once availability has been confirmed, actually create the bookings
    const createdBookings = [];
    const createBookings = (index) => {
        if (index >= bookings.length) {
            // All bookings created OK, so save the transaction
            global.db.run('COMMIT', function(err) {
                if (err) {
                    return next(err);
                }

                // Save the details in the session so the confirmation
                // page can show them after the redirect
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

        // Work out today's price for this ticket type before saving it
        calculateCurrentPrice(booking.ticketTypeId, function(err, tieredPrice) {
            if (err) {
                global.db.run('ROLLBACK', function() {
                    return next(err);
                });
                return;
            }

            const pricePaid = tieredPrice || 0;

            // Save the price paid on the booking itself, so it never
            // changes later even if the ticket price goes up afterwards
            const insertQuery = `
                INSERT INTO bookings (event_id, ticket_type_id, attendee_name, quantity, price_paid, booked_at)
                VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            `;

            global.db.run(insertQuery, [eventId, booking.ticketTypeId, attendeeName, booking.quantity, pricePaid], function(err) {
                if (err) {
                    global.db.run('ROLLBACK', function() {
                        return next(err);
                    });
                    return;
                }

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

    // Everything above happens inside one transaction, so if two people
    // book at the same time they can't both grab the last ticket
    global.db.run('BEGIN TRANSACTION', function(err) {
        if (err) {
            return next(err);
        }
        checkAvailability(0);
    });
});

/**
 * Adds an attendee to the waitlist for one or more sold-out ticket types.
 * Inputs: event_id from the URL, req.body with attendee_name,
 *         attendee_email, and a quantity field per ticket type
 *         (e.g. waitlist_qty_1)
 * Outputs: creates the waitlist entries and redirects back to the event page
 */
router.post('/event/:id/waitlist', (req, res, next) => {
    const eventId = req.params.id;
    const attendeeName = req.body.waitlist_name;
    const attendeeEmail = req.body.waitlist_email;

    // Pull out every "waitlist_qty_X" field from the form
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

    // Add each waitlist entry one at a time, giving each one the next
    // free queue position for that ticket type
    const addToWaitlist = (index) => {
        if (index >= waitlistEntries.length) {
            req.session.flash = { type: 'success', message: 'You\'ve been added to the waitlist! We\'ll notify you if tickets become available.' };
            res.redirect(`/attendee/event/${eventId}`);
            return;
        }

        const entry = waitlistEntries[index];

        // Work out the next queue position for this ticket type
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

            // Add the attendee to the waitlist at that position
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

    addToWaitlist(0);
});

/**
 * Shows the confirmation page after a booking, with a QR code and
 * booking reference. Reads the booking info that was saved into the
 * session by the /book route just before redirecting here.
 * Inputs: none (uses req.session.bookingConfirmation)
 * Outputs: renders attendee/booking-confirmation.ejs, or redirects to
 *          the attendee home page if there's nothing to show
 */
router.get('/booking-confirmation', (req, res, next) => {
    const confirmation = req.session.bookingConfirmation;

    if (!confirmation) {
        return res.redirect('/attendee');
    }

    const eventId = confirmation.eventId;

    // Get the event details to show on the confirmation page
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

        // Get the ticket type names to match up against each booking
        const ticketQuery = `
            SELECT ticket_type_id, type, price
            FROM ticket_types
            WHERE event_id = ?
        `;

        global.db.all(ticketQuery, [eventId], function(err, tickets) {
            if (err) {
                return next(err);
            }

            // Combine the ticket type name with each booking, using the
            // price the attendee actually paid rather than today's price
            const bookingDetails = confirmation.bookings.map(booking => {
                const ticket = tickets.find(t => t.ticket_type_id === booking.ticketTypeId);
                const pricePaidPerTicket = booking.pricePaid;
                return {
                    ...booking,
                    ticketType: ticket ? ticket.type : 'Unknown',
                    pricePaid: pricePaidPerTicket,
                    total: pricePaidPerTicket * booking.quantity
                };
            });

            // The confirmation data is only needed once, so clear it now
            delete req.session.bookingConfirmation;

            // Make up a simple booking reference from the first booking's
            // ID, so it stays the same if the page is refreshed
            const reference = `EVT${eventId}-${String(bookingDetails[0].bookingId).padStart(6, '0')}`;

            res.render('attendee/booking-confirmation', {
                attendeeName: confirmation.attendeeName,
                event: event,
                bookings: bookingDetails,
                totalPrice: bookingDetails.reduce((sum, b) => sum + b.total, 0),
                reference: reference
            });
        });
    });
});

module.exports = router;
