/**
 * routes/organisers.js
 * Organiser-side routes: login, home page, settings, event management
 *
 * All routes except /login require authentication middleware
 */

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');

// ============================================================================
// AUTHENTICATION MIDDLEWARE
// ============================================================================

/**
 * @desc Middleware to check if user is authenticated
 * If not, redirects to /organiser/login
 * If yes, passes control to next route handler
 */
function authRequired(req, res, next) {
    if (req.session.organiser_id) {
        next();
    } else {
        res.redirect('/organiser/login');
    }
}

// ============================================================================
// AUTHENTICATION ROUTES
// ============================================================================

/**
 * GET /organiser/login
 * Display organiser login form
 * Inputs: none
 * Outputs: rendered login.ejs view
 */
router.get('/login', (req, res) => {
    res.render('organiser/login', { error: null });
});

/**
 * POST /organiser/login
 * Authenticate organiser credentials and create session
 * Inputs: req.body.username, req.body.password
 * Outputs: if successful, set session and redirect to /organiser
 *          if failed, re-render login form with error message
 */
router.post('/login', (req, res, next) => {
    const username = req.body.username;
    const password = req.body.password;

    // Validate inputs
    if (!username || !password) {
        return res.render('organiser/login', { error: 'Please enter username and password' });
    }

    // Query database for user
    const query = "SELECT organiser_id, password_hash FROM organisers WHERE username = ?";
    global.db.get(query, [username], function(err, row) {
        if (err) {
            return next(err);
        }

        if (!row) {
            // User not found
            return res.render('organiser/login', { error: 'Invalid username or password' });
        }

        // Check password
        if (bcrypt.compareSync(password, row.password_hash)) {
            // Password correct; create session
            req.session.organiser_id = row.organiser_id;
            res.redirect('/organiser');
        } else {
            // Password incorrect
            return res.render('organiser/login', { error: 'Invalid username or password' });
        }
    });
});

/**
 * GET /organiser/logout
 * Destroy session and redirect to main page
 * Inputs: none
 * Outputs: session destroyed, redirect to /
 */
router.get('/logout', (req, res) => {
    req.session.destroy(function(err) {
        if (err) {
            return res.redirect('/organiser');
        }
        res.redirect('/');
    });
});

// ============================================================================
// ORGANISER HOME PAGE
// ============================================================================

/**
 * GET /organiser
 * Organiser home page: displays site settings link, create event button,
 * and lists of published and draft events
 * Inputs: none (organiser_id from session)
 * Outputs: rendered organiser/home.ejs with site name, events lists
 */
router.get('/', authRequired, (req, res, next) => {
    // Query 1: Get site settings
    const settingsQuery = "SELECT site_name, site_description FROM site_settings WHERE settings_id = 1";

    global.db.get(settingsQuery, function(err, settings) {
        if (err) {
            return next(err);
        }

        // Query 2: Get published events with ticket counts
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

            // Query 3: Get draft events with ticket counts
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

                // Get flash message if it exists
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

// ============================================================================
// SITE SETTINGS PAGE
// ============================================================================

/**
 * GET /organiser/settings
 * Display site settings form (name, description)
 * Inputs: none
 * Outputs: rendered organiser/settings.ejs with current settings
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
 * Update site settings (name, description)
 * Inputs: req.body.site_name, req.body.site_description
 * Outputs: if validation passes, update DB and redirect to /organiser
 *          if validation fails, re-render with error
 */
router.post('/settings', authRequired, (req, res, next) => {
    const siteName = req.body.site_name;
    const siteDescription = req.body.site_description;

    // Validation: both fields required
    if (!siteName || !siteDescription) {
        return res.render('organiser/settings', {
            site_name: siteName,
            site_description: siteDescription,
            error: 'Both name and description are required'
        });
    }

    // Update database
    const query = "UPDATE site_settings SET site_name = ?, site_description = ? WHERE settings_id = 1";
    global.db.run(query, [siteName, siteDescription], function(err) {
        if (err) {
            return next(err);
        }

        req.session.flash = { type: 'success', message: '✓ Site settings saved successfully!' };
        res.redirect('/organiser');
    });
});

// ============================================================================
// EVENT MANAGEMENT (STUBS FOR NOW)
// ============================================================================

/**
 * GET /organiser/event/new
 * Create a new draft event and redirect to edit page
 * Inputs: none
 * Outputs: new event created with status='draft' and default event_date (tomorrow 18:00), redirect to edit page
 */
router.get('/event/new', authRequired, (req, res, next) => {
    // Default event date: tomorrow at 18:00
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(18, 0, 0, 0);
    const defaultEventDate = tomorrow.toISOString().replace('T', ' ').slice(0, 19);

    const query = "INSERT INTO events (title, event_date, status) VALUES ('Untitled Event', ?, 'draft')";

    global.db.run(query, [defaultEventDate], function(err) {
        if (err) {
            return next(err);
        }

        const eventId = this.lastID;

        // Create default ticket types (full and concession) with 0 quantity/price
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
 * Edit event page: form for title, description, ticket types/quantities/prices
 * Inputs: event_id from URL param
 * Outputs: rendered organiser/edit-event.ejs with event and ticket type data
 */
router.get('/event/:id', authRequired, (req, res, next) => {
    const eventId = req.params.id;

    // Query 1: Get event details
    const eventQuery = "SELECT * FROM events WHERE event_id = ?";

    global.db.get(eventQuery, [eventId], function(err, event) {
        if (err) {
            return next(err);
        }

        if (!event) {
            return res.status(404).send('Event not found');
        }

        // Query 2: Get ticket types for this event
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
 * Update event details and ticket types
 * Inputs: event_id from URL, req.body with title, description, event_date, and ticket data
 * Outputs: update DB, set last_modified_at, redirect to /organiser
 */
router.post('/event/:id', authRequired, (req, res, next) => {
    const eventId = req.params.id;
    const { title, description, event_date, full_price, full_qty, concession_price, concession_qty } = req.body;

    // Validate required fields
    if (!title || !event_date) {
        return res.status(400).send('Title and date are required');
    }

    // Convert datetime-local to ISO format SQLite expects (YYYY-MM-DD HH:MM:SS)
    const eventDateTime = new Date(event_date);
    const sqlEventDate = eventDateTime.toISOString().replace('T', ' ').slice(0, 19);

    // Update event details and last_modified_at
    const updateEventQuery = `
        UPDATE events
        SET title = ?, description = ?, event_date = ?, last_modified_at = CURRENT_TIMESTAMP
        WHERE event_id = ?
    `;

    global.db.run(updateEventQuery, [title, description, sqlEventDate, eventId], function(err) {
        if (err) {
            return next(err);
        }

        // Update or insert ticket types
        // For simplicity, delete existing and re-insert (transaction in real scenario)
        const deleteTicketsQuery = "DELETE FROM ticket_types WHERE event_id = ?";

        global.db.run(deleteTicketsQuery, [eventId], function(err) {
            if (err) {
                return next(err);
            }

            // Insert full-price tickets
            const insertFullQuery = `
                INSERT INTO ticket_types (event_id, type, price, quantity_total)
                VALUES (?, 'full', ?, ?)
            `;

            global.db.run(insertFullQuery, [eventId, full_price, full_qty], function(err) {
                if (err) {
                    return next(err);
                }

                // Insert concession tickets
                const insertConcessionQuery = `
                    INSERT INTO ticket_types (event_id, type, price, quantity_total)
                    VALUES (?, 'concession', ?, ?)
                `;

                global.db.run(insertConcessionQuery, [eventId, concession_price, concession_qty], function(err) {
                    if (err) {
                        return next(err);
                    }

                    req.session.flash = { type: 'success', message: '✓ Event saved successfully!' };
                    res.redirect('/organiser');
                });
            });
        });
    });
});

/**
 * POST /organiser/event/:id/publish
 * Publish a draft event (set status='published', timestamp published_at)
 * Inputs: event_id from URL
 * Outputs: update DB, redirect to /organiser
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

        req.session.flash = { type: 'success', message: '✓ Event published successfully!' };
        res.redirect('/organiser');
    });
});

/**
 * POST /organiser/event/:id/delete
 * Delete an event (and cascade to ticket types, bookings, waitlist)
 * Inputs: event_id from URL
 * Outputs: delete from DB, redirect to /organiser
 */
router.post('/event/:id/delete', authRequired, (req, res, next) => {
    const eventId = req.params.id;

    // First check if event exists
    const checkQuery = "SELECT event_id FROM events WHERE event_id = ?";

    global.db.get(checkQuery, [eventId], function(err, event) {
        if (err) {
            return next(err);
        }

        if (!event) {
            return res.status(404).send('Event not found');
        }

        // Foreign keys are set to ON DELETE CASCADE, so this will cascade
        const deleteQuery = "DELETE FROM events WHERE event_id = ?";

        global.db.run(deleteQuery, [eventId], function(err) {
            if (err) {
                return next(err);
            }

            req.session.flash = { type: 'success', message: '✓ Event deleted successfully.' };
            res.redirect('/organiser');
        });
    });
});

// ============================================================================
// DYNAMIC PRICING HELPER (shared with attendees.js)
// ============================================================================

/**
 * calculateCurrentPrice(ticketTypeId, callback)
 * Calculates the current tiered price for a ticket type based on % sold
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

        if (row.remaining === 0) {
            return callback(null, null);
        }

        const percentSold = (row.sold / row.quantity_total) * 100;
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
// GUEST LIST & BOOKING MANAGEMENT
// ============================================================================

/**
 * GET /organiser/event/:id/guests
 * Display guest list (bookings) for an event with cancellation buttons
 * Inputs: event_id from URL
 * Outputs: rendered organiser/guests.ejs with list of bookings by ticket type
 */
router.get('/event/:id/guests', authRequired, (req, res, next) => {
    const eventId = req.params.id;

    // Query 1: Get event details
    const eventQuery = "SELECT title FROM events WHERE event_id = ?";

    global.db.get(eventQuery, [eventId], function(err, event) {
        if (err) {
            return next(err);
        }

        if (!event) {
            return res.status(404).send('Event not found');
        }

        // Query 2: Get all bookings for this event, grouped by ticket type, ordered by booking date
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

            // Separate active and cancelled bookings for display
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
 * Cancel a booking and promote next waitlisted person if applicable
 * Inputs: booking_id from URL
 * Outputs: set booking status to 'cancelled', call promoteWaitlistForTicketType(), redirect back
 */
router.post('/booking/:id/cancel', authRequired, (req, res, next) => {
    const bookingId = req.params.id;

    // Query 1: Get the booking details to find event_id and ticket_type_id
    const getBookingQuery = "SELECT event_id, ticket_type_id FROM bookings WHERE booking_id = ?";

    global.db.get(getBookingQuery, [bookingId], function(err, booking) {
        if (err) {
            return next(err);
        }

        if (!booking) {
            return res.status(404).send('Booking not found');
        }

        // Query 2: Mark booking as cancelled
        const cancelQuery = "UPDATE bookings SET status = 'cancelled' WHERE booking_id = ?";

        global.db.run(cancelQuery, [bookingId], function(err) {
            if (err) {
                return next(err);
            }

            // Query 3: Promote waitlist for this ticket type
            promoteWaitlistForTicketType(booking.ticket_type_id, function(promoteErr) {
                if (promoteErr) {
                    console.error('Error promoting waitlist:', promoteErr);
                    // Still redirect even if promotion fails; log the error but don't block the response
                }

                // Redirect back to guest list
                res.redirect(`/organiser/event/${booking.event_id}/guests`);
            });
        });
    });
});

// ============================================================================
// WAITLIST PROMOTION HELPER
// ============================================================================

/**
 * promoteWaitlistForTicketType(ticket_type_id, callback)
 * Promote the next person on the waitlist for a ticket type to an actual booking
 * if they now have sufficient availability.
 *
 * Logic:
 * 1. Get the next waitlist entry (position 1)
 * 2. Check remaining availability for that ticket_type_id
 * 3. If remaining >= requested_quantity, create a booking and remove from waitlist
 * 4. Recursively try to promote the next person
 * 5. When no one can be promoted, callback
 *
 * Inputs: ticket_type_id (int), callback(err) function
 * Outputs: calls callback when done; may create bookings and remove waitlist entries
 */
function promoteWaitlistForTicketType(ticketTypeId, callback) {
    // Query 1: Get ticket details (event_id, quantity_total)
    const ticketQuery = "SELECT event_id, quantity_total FROM ticket_types WHERE ticket_type_id = ?";

    global.db.get(ticketQuery, [ticketTypeId], function(err, ticket) {
        if (err) {
            return callback(err);
        }

        if (!ticket) {
            return callback(null); // Ticket doesn't exist; nothing to promote
        }

        // Query 2: Get current active bookings for this ticket type
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

            // Query 3: Get next waitlist entry (position 1, waiting status only)
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

                // No waitlist entry; we're done
                if (!waitlistEntry) {
                    return callback(null);
                }

                // Check if this person can be promoted
                if (remaining >= waitlistEntry.requested_quantity) {
                    // Can promote! Calculate tiered price at promotion time
                    calculateCurrentPrice(ticketTypeId, function(priceErr, tieredPrice) {
                        if (priceErr) {
                            return callback(priceErr);
                        }

                        const pricePaid = tieredPrice || 0;

                        // Create a booking with the current tiered price
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

                                // Update waitlist status to 'promoted' (soft-delete)
                                const updateWaitlistQuery = "UPDATE waitlist SET status = 'promoted' WHERE waitlist_id = ?";

                                global.db.run(updateWaitlistQuery, [waitlistEntry.waitlist_id], function(updateErr) {
                                    if (updateErr) {
                                        return callback(updateErr);
                                    }

                                    // Recursively try to promote the next person
                                    // (availability has now decreased by requested_quantity)
                                    promoteWaitlistForTicketType(ticketTypeId, callback);
                                });
                            }
                        );
                    });
                } else {
                    // Can't promote this person; stop here
                    // They'll be promoted later when more tickets become available
                    callback(null);
                }
            });
        });
    });
}

// ============================================================================
// ANALYTICS DASHBOARD
// ============================================================================

/**
 * GET /organiser/analytics
 * Display analytics dashboard with revenue, sales, and waitlist metrics
 * All data from SQL aggregates, no client-side computation
 */
router.get('/analytics', authRequired, (req, res, next) => {
    // Query 1: Total revenue across all events
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

        // Query 2: Revenue per event
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

            // Query 3: Tickets sold per ticket type per event
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

                // Query 4: Waitlist conversion rate
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

                    // Query 5: Most popular event (by tickets sold)
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

                        // Prepare data for chart (revenue per event)
                        const chartData = {
                            labels: eventRevenues.map(e => e.title),
                            revenues: eventRevenues.map(e => e.event_revenue),
                            ticketsSold: eventRevenues.map(e => e.tickets_sold)
                        };

                        res.render('organiser/analytics', {
                            totalRevenue: totalData.total_revenue.toFixed(2),
                            totalTicketsSold: totalData.total_tickets_sold,
                            eventRevenues: eventRevenues,
                            ticketsSold: ticketsSold,
                            waitlistPromoted: waitlistData.promoted_count,
                            waitlistTotal: waitlistData.total_waitlist_entries,
                            conversionRate: conversionRate,
                            mostPopular: mostPopular,
                            chartData: chartData
                        });
                    });
                });
            });
        });
    });
});

module.exports = router;
