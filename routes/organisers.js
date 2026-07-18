/**
 * routes/organisers.js
 * All the routes for the organiser side of the app: logging in, the
 * home page, site settings, creating/editing/publishing/deleting
 * events, managing the guest list, and the analytics dashboard.
 * Every route except /login and /logout needs the organiser to be
 * logged in first (checked by the authRequired function below).
 */

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { calculateCurrentPrice } = require('../lib/pricing');

/**
 * authRequired(req, res, next)
 * Middleware that checks if the organiser is logged in (by looking
 * for organiser_id in the session). If not logged in, sends them to
 * the login page instead of the page they asked for.
 */
function authRequired(req, res, next) {
    if (req.session.organiser_id) {
        next();
    } else {
        res.redirect('/organiser/login');
    }
}

/**
 * GET /organiser/login
 * Shows the login form.
 * Inputs: none
 * Outputs: renders organiser/login.ejs
 */
router.get('/login', (req, res) => {
    res.render('organiser/login', { error: null });
});

/**
 * POST /organiser/login
 * Checks the username and password and logs the organiser in if they
 * match. Passwords are stored hashed with bcrypt, never as plain text.
 * Inputs: req.body.username, req.body.password
 * Outputs: if correct, saves organiser_id in the session and redirects
 *          to /organiser; if wrong, shows the login form again with
 *          an error message
 */
router.post('/login', (req, res, next) => {
    const username = req.body.username;
    const password = req.body.password;

    if (!username || !password) {
        return res.render('organiser/login', { error: 'Please enter username and password' });
    }

    // Look up the organiser by username
    const query = "SELECT organiser_id, password_hash FROM organisers WHERE username = ?";
    global.db.get(query, [username], function(err, row) {
        if (err) {
            return next(err);
        }

        if (!row) {
            return res.render('organiser/login', { error: 'Invalid username or password' });
        }

        // Compare the typed password against the stored bcrypt hash
        if (bcrypt.compareSync(password, row.password_hash)) {
            req.session.organiser_id = row.organiser_id;
            res.redirect('/organiser');
        } else {
            return res.render('organiser/login', { error: 'Invalid username or password' });
        }
    });
});

/**
 * GET /organiser/logout
 * Logs the organiser out by destroying their session.
 * Inputs: none
 * Outputs: session destroyed, redirects to the main home page
 */
router.get('/logout', (req, res) => {
    req.session.destroy(function(err) {
        if (err) {
            return res.redirect('/organiser');
        }
        res.redirect('/');
    });
});

/**
 * GET /organiser
 * The organiser home page. Shows the site name/description, a button
 * to create a new event, and the lists of published and draft events.
 * Inputs: none (organiser_id comes from the session)
 * Outputs: renders organiser/home.ejs with the site info and both event lists
 */
router.get('/', authRequired, (req, res, next) => {
    // Get the site name and description first
    const settingsQuery = "SELECT site_name, site_description FROM site_settings WHERE settings_id = 1";

    global.db.get(settingsQuery, function(err, settings) {
        if (err) {
            return next(err);
        }

        // Get every published event, along with when it was created and
        // published, and a count of each ticket type using GROUP_CONCAT
        const publishedQuery = `
            SELECT
                e.event_id,
                e.title,
                e.event_date,
                e.created_at,
                e.published_at,
                GROUP_CONCAT(t.type || ':' || t.quantity_total, ', ') as ticket_info
            FROM events e
            LEFT JOIN ticket_types t ON e.event_id = t.event_id
            WHERE e.status = 'published'
            GROUP BY e.event_id
            ORDER BY e.event_date DESC
        `;

        global.db.all(publishedQuery, function(err, publishedEvents) {
            if (err) {
                return next(err);
            }

            // Same idea but for draft events (these don't have a published_at yet)
            const draftQuery = `
                SELECT
                    e.event_id,
                    e.title,
                    e.event_date,
                    e.created_at,
                    GROUP_CONCAT(t.type || ':' || t.quantity_total, ', ') as ticket_info
                FROM events e
                LEFT JOIN ticket_types t ON e.event_id = t.event_id
                WHERE e.status = 'draft'
                GROUP BY e.event_id
                ORDER BY e.event_date DESC
            `;

            global.db.all(draftQuery, function(err, draftEvents) {
                if (err) {
                    return next(err);
                }

                // Show a success/error message left over from the last action, if any
                const flash = req.session.flash;
                delete req.session.flash;

                res.render('organiser/home', {
                    site_name: settings.site_name,
                    site_description: settings.site_description,
                    publishedEvents: publishedEvents,
                    draftEvents: draftEvents,
                    flash: flash
                });
            });
        });
    });
});

/**
 * GET /organiser/settings
 * Shows the site settings form, pre-filled with the current values.
 * Inputs: none
 * Outputs: renders organiser/settings.ejs with the current site name/description
 */
router.get('/settings', authRequired, (req, res, next) => {
    const query = "SELECT site_name, site_description FROM site_settings WHERE settings_id = 1";

    global.db.get(query, function(err, row) {
        if (err) {
            return next(err);
        }

        res.render('organiser/settings', {
            site_name: row.site_name,
            site_description: row.site_description,
            error: null
        });
    });
});

/**
 * POST /organiser/settings
 * Saves the new site name and description.
 * Inputs: req.body.site_name, req.body.site_description
 * Outputs: if both fields are filled in, updates the database and
 *          redirects to /organiser; otherwise shows the form again
 *          with an error message
 */
router.post('/settings', authRequired, (req, res, next) => {
    const siteName = req.body.site_name;
    const siteDescription = req.body.site_description;

    // Both fields are required
    if (!siteName || !siteDescription) {
        return res.render('organiser/settings', {
            site_name: siteName,
            site_description: siteDescription,
            error: 'Both name and description are required'
        });
    }

    const query = "UPDATE site_settings SET site_name = ?, site_description = ? WHERE settings_id = 1";
    global.db.run(query, [siteName, siteDescription], function(err) {
        if (err) {
            return next(err);
        }

        req.session.flash = { type: 'success', message: 'Site settings saved successfully!' };
        res.redirect('/organiser');
    });
});

/**
 * GET /organiser/event/new
 * Creates a new blank draft event and sends the organiser straight to
 * its edit page so they can fill in the details.
 * Inputs: none
 * Outputs: a new draft event is created (with a default date of
 *          tomorrow at 18:00) and the organiser is redirected to its edit page
 */
router.get('/event/new', authRequired, (req, res, next) => {
    // Default date for a brand new event: tomorrow at 6pm
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(18, 0, 0, 0);
    const defaultEventDate = tomorrow.toISOString().replace('T', ' ').slice(0, 19);

    // Create the event as a draft with a placeholder title
    const query = "INSERT INTO events (title, event_date, status) VALUES ('Untitled Event', ?, 'draft')";

    global.db.run(query, [defaultEventDate], function(err) {
        if (err) {
            return next(err);
        }

        const eventId = this.lastID;

        // Every event needs a full-price and a concession ticket type, so
        // create both here with 0 price/quantity until the organiser sets them
        const createFullQuery = "INSERT INTO ticket_types (event_id, type, price, quantity_total) VALUES (?, 'full', 0, 0)";
        const createConcessionQuery = "INSERT INTO ticket_types (event_id, type, price, quantity_total) VALUES (?, 'concession', 0, 0)";

        global.db.run(createFullQuery, [eventId], function(err1) {
            if (err1) {
                return next(err1);
            }

            global.db.run(createConcessionQuery, [eventId], function(err2) {
                if (err2) {
                    return next(err2);
                }

                res.redirect(`/organiser/event/${eventId}`);
            });
        });
    });
});

/**
 * GET /organiser/event/:id
 * Shows the edit form for one event, pre-filled with its current
 * details and ticket type info.
 * Inputs: event_id from the URL
 * Outputs: renders organiser/edit-event.ejs with the event and ticket type data
 */
router.get('/event/:id', authRequired, (req, res, next) => {
    const eventId = req.params.id;

    const eventQuery = "SELECT * FROM events WHERE event_id = ?";

    global.db.get(eventQuery, [eventId], function(err, event) {
        if (err) {
            return next(err);
        }

        if (!event) {
            return res.status(404).send('Event not found');
        }

        const ticketsQuery = "SELECT * FROM ticket_types WHERE event_id = ? ORDER BY type";

        global.db.all(ticketsQuery, [eventId], function(err, ticketTypes) {
            if (err) {
                return next(err);
            }

            res.render('organiser/edit-event', {
                event: event,
                ticketTypes: ticketTypes
            });
        });
    });
});

/**
 * POST /organiser/event/:id
 * Saves changes made on the edit event form: title, description,
 * date, and both ticket types' prices/quantities.
 * Inputs: event_id from the URL, req.body with title, description,
 *         event_date, full_price, full_qty, concession_price, concession_qty
 * Outputs: if everything is valid, updates the database (including
 *          last_modified_at) and redirects to /organiser; otherwise
 *          sends back a 400 error explaining what's wrong
 */
router.post('/event/:id', authRequired, (req, res, next) => {
    const eventId = req.params.id;
    const { title, description, event_date, full_price, full_qty, concession_price, concession_qty } = req.body;

    if (!title || !event_date) {
        return res.status(400).send('Title and date are required');
    }

    // Make sure the date is actually a real date. The form's browser-side
    // "required" attribute won't stop someone sending bad data directly
    // (e.g. with curl), so we double check on the server too.
    const eventDateTime = new Date(event_date);
    if (isNaN(eventDateTime.getTime())) {
        return res.status(400).send('Invalid event date');
    }

    // Same idea for the ticket prices/quantities: check they're real,
    // non-negative numbers rather than trusting the form completely
    const parsedFullPrice = parseFloat(full_price);
    const parsedFullQty = parseInt(full_qty, 10);
    const parsedConcessionPrice = parseFloat(concession_price);
    const parsedConcessionQty = parseInt(concession_qty, 10);

    const ticketFields = [parsedFullPrice, parsedFullQty, parsedConcessionPrice, parsedConcessionQty];
    if (ticketFields.some(n => isNaN(n) || n < 0)) {
        return res.status(400).send('Ticket prices and quantities must be non-negative numbers');
    }

    // Convert the date into the format SQLite expects
    const sqlEventDate = eventDateTime.toISOString().replace('T', ' ').slice(0, 19);

    // Update the main event details first
    const updateEventQuery = `
        UPDATE events
        SET title = ?, description = ?, event_date = ?, last_modified_at = CURRENT_TIMESTAMP
        WHERE event_id = ?
    `;

    global.db.run(updateEventQuery, [title, description, sqlEventDate, eventId], function(err) {
        if (err) {
            return next(err);
        }

        // Easiest way to update the ticket types is to delete the old
        // ones and insert fresh rows with the new prices/quantities
        const deleteTicketsQuery = "DELETE FROM ticket_types WHERE event_id = ?";

        global.db.run(deleteTicketsQuery, [eventId], function(err) {
            if (err) {
                return next(err);
            }

            const insertFullQuery = `
                INSERT INTO ticket_types (event_id, type, price, quantity_total)
                VALUES (?, 'full', ?, ?)
            `;

            global.db.run(insertFullQuery, [eventId, parsedFullPrice, parsedFullQty], function(err) {
                if (err) {
                    return next(err);
                }

                const insertConcessionQuery = `
                    INSERT INTO ticket_types (event_id, type, price, quantity_total)
                    VALUES (?, 'concession', ?, ?)
                `;

                global.db.run(insertConcessionQuery, [eventId, parsedConcessionPrice, parsedConcessionQty], function(err) {
                    if (err) {
                        return next(err);
                    }

                    req.session.flash = { type: 'success', message: 'Event saved successfully!' };
                    res.redirect('/organiser');
                });
            });
        });
    });
});

/**
 * POST /organiser/event/:id/publish
 * Changes a draft event to published, so attendees can see and book it.
 * Inputs: event_id from the URL
 * Outputs: updates the event's status and published_at, redirects to /organiser
 */
router.post('/event/:id/publish', authRequired, (req, res, next) => {
    const eventId = req.params.id;

    const query = `
        UPDATE events
        SET status = 'published', published_at = CURRENT_TIMESTAMP
        WHERE event_id = ?
    `;

    global.db.run(query, [eventId], function(err) {
        if (err) {
            return next(err);
        }

        req.session.flash = { type: 'success', message: 'Event published successfully!' };
        res.redirect('/organiser');
    });
});

/**
 * POST /organiser/event/:id/delete
 * Deletes an event completely. Because the database schema uses
 * ON DELETE CASCADE, this also removes its ticket types, bookings,
 * and waitlist entries automatically.
 * Inputs: event_id from the URL
 * Outputs: deletes the event from the database, redirects to /organiser
 */
router.post('/event/:id/delete', authRequired, (req, res, next) => {
    const eventId = req.params.id;

    // Check the event actually exists before trying to delete it
    const checkQuery = "SELECT event_id FROM events WHERE event_id = ?";

    global.db.get(checkQuery, [eventId], function(err, event) {
        if (err) {
            return next(err);
        }

        if (!event) {
            return res.status(404).send('Event not found');
        }

        const deleteQuery = "DELETE FROM events WHERE event_id = ?";

        global.db.run(deleteQuery, [eventId], function(err) {
            if (err) {
                return next(err);
            }

            req.session.flash = { type: 'success', message: 'Event deleted successfully.' };
            res.redirect('/organiser');
        });
    });
});

/**
 * GET /organiser/event/:id/guests
 * Shows the guest list for one event: everyone who has booked, split
 * into active and cancelled bookings, with a cancel button for each
 * active booking.
 * Inputs: event_id from the URL
 * Outputs: renders organiser/guests.ejs with the active and cancelled bookings
 */
router.get('/event/:id/guests', authRequired, (req, res, next) => {
    const eventId = req.params.id;

    const eventQuery = "SELECT title FROM events WHERE event_id = ?";

    global.db.get(eventQuery, [eventId], function(err, event) {
        if (err) {
            return next(err);
        }

        if (!event) {
            return res.status(404).send('Event not found');
        }

        // Get every booking for this event, newest first within each ticket type
        const bookingsQuery = `
            SELECT
                b.booking_id,
                b.attendee_name,
                b.quantity,
                b.booked_at,
                b.status,
                t.type as ticket_type,
                b.price_paid
            FROM bookings b
            JOIN ticket_types t ON b.ticket_type_id = t.ticket_type_id
            WHERE b.event_id = ?
            ORDER BY t.type, b.booked_at DESC
        `;

        global.db.all(bookingsQuery, [eventId], function(err, bookings) {
            if (err) {
                return next(err);
            }

            // Split into two lists so the view can show them separately
            const activeBookings = bookings.filter(b => b.status === 'active');
            const cancelledBookings = bookings.filter(b => b.status === 'cancelled');

            res.render('organiser/guests', {
                event: event,
                event_id: eventId,
                activeBookings: activeBookings,
                cancelledBookings: cancelledBookings
            });
        });
    });
});

/**
 * POST /organiser/booking/:id/cancel
 * Cancels a booking. The booking isn't deleted, just marked as
 * cancelled so there's a record of it. Afterwards, checks if anyone
 * on the waitlist can now be promoted into the newly freed-up spot.
 * Inputs: booking_id from the URL
 * Outputs: marks the booking as cancelled, tries to promote the
 *          waitlist, then redirects back to the guest list
 */
router.post('/booking/:id/cancel', authRequired, (req, res, next) => {
    const bookingId = req.params.id;

    // Need the event/ticket type first so we know who to check on the waitlist
    const getBookingQuery = "SELECT event_id, ticket_type_id FROM bookings WHERE booking_id = ?";

    global.db.get(getBookingQuery, [bookingId], function(err, booking) {
        if (err) {
            return next(err);
        }

        if (!booking) {
            return res.status(404).send('Booking not found');
        }

        const cancelQuery = "UPDATE bookings SET status = 'cancelled' WHERE booking_id = ?";

        global.db.run(cancelQuery, [bookingId], function(err) {
            if (err) {
                return next(err);
            }

            // Now that a spot might be free, see if anyone on the waitlist can be promoted
            promoteWaitlistForTicketType(booking.ticket_type_id, function(promoteErr) {
                if (promoteErr) {
                    console.error('Error promoting waitlist:', promoteErr);
                    // Log it, but still redirect - the cancellation itself worked fine
                }

                res.redirect(`/organiser/event/${booking.event_id}/guests`);
            });
        });
    });
});

/**
 * promoteWaitlistForTicketType(ticketTypeId, callback)
 * Checks the waitlist for a ticket type and promotes the next person
 * in the queue into a real booking, if there's now enough space for them.
 *
 * How it works:
 * 1. Look up the next person in the queue (lowest position number)
 * 2. Work out how many tickets are currently free
 * 3. If there's enough room for what they asked for, book it for them
 *    and mark their waitlist entry as promoted
 * 4. Call itself again to see if the next person can also be promoted
 * 5. Stop once nobody left in the queue can be promoted
 *
 * Note: if the person at the front of the queue wants more tickets
 * than are currently free, they stay at the front and block anyone
 * behind them, even if those people would fit. This is deliberate -
 * it keeps the queue fair and first-come-first-served.
 *
 * Inputs: ticketTypeId, callback(err) function to run once finished
 * Outputs: may create new bookings and update waitlist entries; calls
 *          callback when there's nothing left to do
 */
function promoteWaitlistForTicketType(ticketTypeId, callback) {
    const ticketQuery = "SELECT event_id, quantity_total FROM ticket_types WHERE ticket_type_id = ?";

    global.db.get(ticketQuery, [ticketTypeId], function(err, ticket) {
        if (err) {
            return callback(err);
        }

        if (!ticket) {
            return callback(null); // ticket type doesn't exist, nothing to do
        }

        // Work out how many tickets are currently booked
        const bookedQuery = `
            SELECT COALESCE(SUM(quantity), 0) as total_booked
            FROM bookings
            WHERE ticket_type_id = ? AND status = 'active'
        `;

        global.db.get(bookedQuery, [ticketTypeId], function(err, bookedRow) {
            if (err) {
                return callback(err);
            }

            const remaining = ticket.quantity_total - bookedRow.total_booked;

            // Find whoever is next in the queue for this ticket type
            const nextWaitlistQuery = `
                SELECT waitlist_id, event_id, attendee_name, requested_quantity
                FROM waitlist
                WHERE ticket_type_id = ? AND status = 'waiting'
                ORDER BY position ASC
                LIMIT 1
            `;

            global.db.get(nextWaitlistQuery, [ticketTypeId], function(err, waitlistEntry) {
                if (err) {
                    return callback(err);
                }

                if (!waitlistEntry) {
                    return callback(null); // nobody waiting, nothing to do
                }

                if (remaining >= waitlistEntry.requested_quantity) {
                    // There's enough room, so book it for them at today's price
                    calculateCurrentPrice(ticketTypeId, function(priceErr, tieredPrice) {
                        if (priceErr) {
                            return callback(priceErr);
                        }

                        const pricePaid = tieredPrice || 0;

                        const createBookingQuery = `
                            INSERT INTO bookings (event_id, ticket_type_id, attendee_name, quantity, price_paid, booked_at, status)
                            VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, 'active')
                        `;

                        global.db.run(
                            createBookingQuery,
                            [waitlistEntry.event_id, ticketTypeId, waitlistEntry.attendee_name, waitlistEntry.requested_quantity, pricePaid],
                            function(promoteErr) {
                                if (promoteErr) {
                                    return callback(promoteErr);
                                }

                                // Mark them as promoted rather than deleting the row,
                                // so we keep a record for the waitlist conversion stats
                                const updateWaitlistQuery = "UPDATE waitlist SET status = 'promoted' WHERE waitlist_id = ?";

                                global.db.run(updateWaitlistQuery, [waitlistEntry.waitlist_id], function(updateErr) {
                                    if (updateErr) {
                                        return callback(updateErr);
                                    }

                                    // See if the next person in line can also be promoted now
                                    promoteWaitlistForTicketType(ticketTypeId, callback);
                                });
                            }
                        );
                    });
                } else {
                    // Not enough room for this person yet, so stop here.
                    // They'll get another chance next time someone cancels.
                    callback(null);
                }
            });
        });
    });
}

/**
 * GET /organiser/analytics
 * Shows the analytics dashboard: total revenue, tickets sold, revenue
 * per event, tickets sold by type, waitlist conversion rate, and the
 * most popular event. Everything is worked out with SQL queries
 * rather than being calculated in JavaScript.
 * Inputs: none
 * Outputs: renders organiser/analytics.ejs with all the stats above
 */
router.get('/analytics', authRequired, (req, res, next) => {
    // Total revenue and tickets sold across every event
    const totalRevenueQuery = `
        SELECT
            COALESCE(SUM(CASE WHEN b.status = 'active' THEN b.quantity * b.price_paid ELSE 0 END), 0) as total_revenue,
            COALESCE(SUM(CASE WHEN b.status = 'active' THEN b.quantity ELSE 0 END), 0) as total_tickets_sold
        FROM bookings b
    `;

    global.db.get(totalRevenueQuery, function(err, totalData) {
        if (err) {
            return next(err);
        }

        // Same thing but broken down per event, for the chart and table
        const revenuePerEventQuery = `
            SELECT
                e.event_id,
                e.title,
                COALESCE(SUM(CASE WHEN b.status = 'active' THEN b.quantity * b.price_paid ELSE 0 END), 0) as event_revenue,
                COALESCE(SUM(CASE WHEN b.status = 'active' THEN b.quantity ELSE 0 END), 0) as tickets_sold
            FROM events e
            LEFT JOIN bookings b ON e.event_id = b.event_id
            GROUP BY e.event_id
            ORDER BY event_revenue DESC
        `;

        global.db.all(revenuePerEventQuery, function(err, eventRevenues) {
            if (err) {
                return next(err);
            }

            // How many of each ticket type have sold, per event
            const ticketsPerTypeQuery = `
                SELECT
                    e.event_id,
                    e.title,
                    t.type as ticket_type,
                    COALESCE(SUM(CASE WHEN b.status = 'active' THEN b.quantity ELSE 0 END), 0) as sold,
                    t.quantity_total as total_available
                FROM events e
                LEFT JOIN ticket_types t ON e.event_id = t.event_id
                LEFT JOIN bookings b ON t.ticket_type_id = b.ticket_type_id AND b.status = 'active'
                WHERE t.ticket_type_id IS NOT NULL
                GROUP BY e.event_id, t.ticket_type_id
                ORDER BY e.event_id, t.type
            `;

            global.db.all(ticketsPerTypeQuery, function(err, ticketsSold) {
                if (err) {
                    return next(err);
                }

                // What percentage of waitlist sign-ups have turned into bookings
                const waitlistQuery = `
                    SELECT
                        COALESCE(SUM(CASE WHEN status = 'promoted' THEN 1 ELSE 0 END), 0) as promoted_count,
                        COUNT(*) as total_waitlist_entries
                    FROM waitlist
                `;

                global.db.get(waitlistQuery, function(err, waitlistData) {
                    if (err) {
                        return next(err);
                    }

                    const conversionRate = waitlistData.total_waitlist_entries > 0
                        ? ((waitlistData.promoted_count / waitlistData.total_waitlist_entries) * 100).toFixed(1)
                        : 0;

                    // Whichever event has sold the most tickets overall
                    const mostPopularQuery = `
                        SELECT
                            e.event_id,
                            e.title,
                            COALESCE(SUM(CASE WHEN b.status = 'active' THEN b.quantity ELSE 0 END), 0) as tickets_sold
                        FROM events e
                        LEFT JOIN bookings b ON e.event_id = b.event_id
                        GROUP BY e.event_id
                        ORDER BY tickets_sold DESC
                        LIMIT 1
                    `;

                    global.db.get(mostPopularQuery, function(err, mostPopular) {
                        if (err) {
                            return next(err);
                        }

                        // Build the data the revenue chart needs
                        const chartData = {
                            labels: eventRevenues.map(e => e.title),
                            revenues: eventRevenues.map(e => e.event_revenue),
                            ticketsSold: eventRevenues.map(e => e.tickets_sold)
                        };

                        // Turn the chart data into a JSON string here, on the server,
                        // rather than in the view. Event titles are typed by the
                        // organiser, and if one contained the text "</script>" it
                        // could break out of the chart's <script> tag once embedded
                        // in the page, so we escape "<" here to stop that happening.
                        const chartDataJSON = JSON.stringify(chartData).replace(/</g, '\\u003c');

                        res.render('organiser/analytics', {
                            totalRevenue: totalData.total_revenue.toFixed(2),
                            totalTicketsSold: totalData.total_tickets_sold,
                            eventRevenues: eventRevenues,
                            ticketsSold: ticketsSold,
                            waitlistPromoted: waitlistData.promoted_count,
                            waitlistTotal: waitlistData.total_waitlist_entries,
                            conversionRate: conversionRate,
                            mostPopular: mostPopular,
                            chartDataJSON: chartDataJSON
                        });
                    });
                });
            });
        });
    });
});

module.exports = router;
