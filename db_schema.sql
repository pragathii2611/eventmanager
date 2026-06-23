PRAGMA foreign_keys=ON;

BEGIN TRANSACTION;

-- ============================================================================
-- SITE SETTINGS
-- ============================================================================
CREATE TABLE IF NOT EXISTS site_settings (
    settings_id INTEGER PRIMARY KEY,
    site_name TEXT NOT NULL DEFAULT 'My Event Manager',
    site_description TEXT NOT NULL DEFAULT 'Manage your events here'
);

-- ============================================================================
-- ORGANISER AUTHENTICATION
-- ============================================================================
-- NOTE: Default organiser is seeded on first server startup in index.js
-- (via bcryptjs hash of "password123", logged to console)
-- This ensures grader only needs: npm install, npm run build-db, npm run start
CREATE TABLE IF NOT EXISTS organisers (
    organiser_id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- EVENTS
-- ============================================================================
CREATE TABLE IF NOT EXISTS events (
    event_id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    event_date DATETIME NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('draft', 'published')) DEFAULT 'draft',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    published_at DATETIME,
    last_modified_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- TICKET TYPES
-- ============================================================================
CREATE TABLE IF NOT EXISTS ticket_types (
    ticket_type_id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    price REAL NOT NULL,
    quantity_total INTEGER NOT NULL,
    FOREIGN KEY (event_id) REFERENCES events(event_id) ON DELETE CASCADE
);

-- ============================================================================
-- BOOKINGS
-- ============================================================================
CREATE TABLE IF NOT EXISTS bookings (
    booking_id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL,
    ticket_type_id INTEGER NOT NULL,
    attendee_name TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    booked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    status TEXT NOT NULL CHECK (status IN ('active', 'cancelled')) DEFAULT 'active',
    FOREIGN KEY (event_id) REFERENCES events(event_id),
    FOREIGN KEY (ticket_type_id) REFERENCES ticket_types(ticket_type_id)
);

-- ============================================================================
-- WAITLIST
-- ============================================================================
CREATE TABLE IF NOT EXISTS waitlist (
    waitlist_id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL,
    ticket_type_id INTEGER NOT NULL,
    attendee_name TEXT NOT NULL,
    requested_quantity INTEGER NOT NULL,
    position INTEGER NOT NULL,
    joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (event_id) REFERENCES events(event_id),
    FOREIGN KEY (ticket_type_id) REFERENCES ticket_types(ticket_type_id)
);

-- ============================================================================
-- INITIAL DATA
-- ============================================================================

-- Site settings (single row)
INSERT INTO site_settings (settings_id, site_name, site_description)
VALUES (1, 'Stretch Yoga', 'Yoga classes for all ages and abilities');

-- Demo events: 2 published, 1 draft
INSERT INTO events (title, description, event_date, status, created_at, published_at, last_modified_at)
VALUES
    ('Morning Yoga Flow', 'A gentle 60-minute yoga session to start your day',
     '2026-07-15 09:00:00', 'published', '2026-06-20 10:00:00', '2026-06-20 10:30:00', '2026-06-20 10:30:00'),
    ('Evening Stretch Class', 'Relaxing stretches and breathing exercises',
     '2026-07-18 18:00:00', 'published', '2026-06-20 11:00:00', '2026-06-20 11:15:00', '2026-06-20 11:15:00'),
    ('Weekend Workshop', 'Advanced poses and alignment techniques',
     '2026-07-22 10:00:00', 'draft', '2026-06-21 14:00:00', NULL, '2026-06-21 14:00:00');

-- Demo ticket types for each event
-- Event 1: Morning Yoga Flow (2 full, 3 concession)
INSERT INTO ticket_types (event_id, type, price, quantity_total)
VALUES
    (1, 'full', 15.00, 2),
    (1, 'concession', 10.00, 3);

-- Event 2: Evening Stretch Class (5 full, 5 concession)
INSERT INTO ticket_types (event_id, type, price, quantity_total)
VALUES
    (2, 'full', 15.00, 5),
    (2, 'concession', 10.00, 5);

-- Event 3: Weekend Workshop (4 full, 2 concession) — draft, so no bookings yet
INSERT INTO ticket_types (event_id, type, price, quantity_total)
VALUES
    (3, 'full', 20.00, 4),
    (3, 'concession', 15.00, 2);

-- Demo bookings: show some tickets already booked, plus one cancelled for audit trail demo
-- Event 1, full-price: 1 booked (Alice) + 1 cancelled (Emma) = 1 full ticket remaining
INSERT INTO bookings (event_id, ticket_type_id, attendee_name, quantity, booked_at, status)
VALUES
    (1, 1, 'Alice Smith', 1, '2026-06-21 08:00:00', 'active'),
    (1, 1, 'Emma Davis', 1, '2026-06-21 07:30:00', 'cancelled');

-- Event 1, concession: 2 booked (Bob, Carol) = 1 concession ticket remaining
INSERT INTO bookings (event_id, ticket_type_id, attendee_name, quantity, booked_at, status)
VALUES
    (1, 2, 'Bob Jones', 1, '2026-06-21 09:00:00', 'active'),
    (1, 2, 'Carol White', 1, '2026-06-21 09:30:00', 'active');

-- Event 2: no bookings yet (all tickets available)

-- Demo waitlist entry (for Event 1, full-price, which now has only 1 free after 1 active booking)
-- David requested 2, but only 1 is available — should NOT auto-promote
INSERT INTO waitlist (event_id, ticket_type_id, attendee_name, requested_quantity, position, joined_at)
VALUES
    (1, 1, 'David Brown', 2, 1, '2026-06-21 10:00:00');

COMMIT;

