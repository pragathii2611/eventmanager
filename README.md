# Event Manager - CM2040 Coursework

A deployable event management application for organisers to create and manage events, and attendees to browse events and book tickets. Includes organiser authentication, booking management, and a waitlist system for sold-out events.

## Quick Start

```bash
npm install
npm run build-db        # or npm run build-db-win on Windows
npm run start
```

Then visit: `http://localhost:3000`

## Default Login Credentials

**Username:** `organiser`  
**Password:** `password123`

These are seeded automatically on first server startup (logged to console).

---

## Installation Requirements

- Node.js 16.x or higher
- npm 8.x or higher
- SQLite3 (usually pre-installed on macOS and Linux; Windows included in npm package)

---

## Additional npm Packages

Only **two packages** were added beyond the template:

| Package | Version | Purpose |
|---------|---------|---------|
| `bcryptjs` | ^2.4.3 | Password hashing for organiser login (bcrypt cost=10, never plaintext) |
| `express-session` | ^1.17.3 | Session management for authenticated users (maintains login state) |

Both are production-standard security packages with no build tools or compilation required.

---

## Application Overview

### Two Discrete Interfaces

1. **Organiser Interface** (`/organiser/*`) - Create, edit, publish, and manage events
2. **Attendee Interface** (`/attendee/*`) - Browse and book published events

### Key Features

**Base Requirements:**
- Event creation with title, description, date, and multiple ticket types
- Draft/published event states with timestamps
- Ticket booking with availability validation
- Site settings (name & description)
- Guest list view (bookings for each event)

**Extension: Authentication + Waitlist**
- Organiser login required (bcrypt password hashing)
- Booking cancellation with soft-delete audit trail
- Automatic waitlist promotion when tickets become available
- Attendees can join waitlist for sold-out ticket types
- Position-based queue system (FIFO promotion)

---

## Database Schema

All tables created via `db_schema.sql` with foreign key constraints and cascade deletes:

- **site_settings** – Organiser's site branding
- **organisers** – Login credentials (username, bcrypt hash)
- **events** – Event records (title, description, date, status, timestamps)
- **ticket_types** – Ticket variants per event (full/concession, price, quantity)
- **bookings** – Attendee reservations (active/cancelled status for audit trail)
- **waitlist** – Queue for sold-out tickets (position-based, FIFO)

---

## Routes Summary

**Public:**
- `GET /` – Home page with links
- `GET /attendee` – Browse published events
- `GET /attendee/event/:id` – Event detail + booking form
- `POST /attendee/event/:id/book` – Create booking
- `POST /attendee/event/:id/waitlist` – Join waitlist

**Organiser (Login Required):**
- `GET /organiser` – Home page with event lists
- `GET /organiser/login` – Login form
- `POST /organiser/login` – Authenticate
- `GET /organiser/logout` – Logout
- `GET /organiser/event/new` – Create event
- `GET /organiser/event/:id` – Edit event
- `POST /organiser/event/:id` – Save changes
- `POST /organiser/event/:id/publish` – Publish event
- `POST /organiser/event/:id/delete` – Delete event
- `GET /organiser/event/:id/guests` – View bookings
- `POST /organiser/booking/:id/cancel` – Cancel booking (auto-promotes waitlist)
- `GET /organiser/settings` – Edit site settings
- `POST /organiser/settings` – Save settings

---

## File Structure

```
.
├── index.js                          # Server entry + session setup + organiser auto-seed
├── routes/
│   ├── organisers.js                 # All organiser routes + waitlist promotion helper
│   └── attendees.js                  # All attendee routes
├── views/
│   ├── main.ejs                      # Home page
│   ├── organiser/
│   │   ├── login.ejs
│   │   ├── home.ejs                  # Event lists
│   │   ├── settings.ejs
│   │   ├── edit-event.ejs
│   │   └── guests.ejs                # Booking management
│   └── attendee/
│       ├── home.ejs                  # Event browsing
│       └── event.ejs                 # Booking + waitlist form
├── public/
│   └── main.css
├── db_schema.sql                     # Database definition + seed data
└── package.json
```

---

## Code Style

- **Consistent naming:** camelCase (JS), snake_case (SQL)
- **Security:** Parameterized queries, password hashing, session management
- **Error handling:** All database errors passed to Express error handler
- **Comments:** Every route and query documented (purpose, inputs, outputs)
- **Validation:** Server-side form validation (not client-only)
- **Scoping:** Proper use of let/const; no accidental globals

---

## Running the Grader Tests

The grader will run **exactly these commands** (no others):

```bash
npm install
npm run build-db        # or npm run build-db-win on Windows
npm run start
```

The app will:
1. Create an empty database from `db_schema.sql`
2. Seed the database with demo data (events, bookings, waitlist)
3. Auto-create the default organiser account (organiser / password123)
4. Start the server on port 3000

Log in with the credentials above to access organiser features.

---

## Extension: Waitlist System

### How It Works

1. **Limited tickets** – Organiser creates events with limited quantity per ticket type
2. **Sold out** – When a ticket type reaches 0 remaining, attendees see "Join Waitlist" form
3. **Queue** – Multiple attendees can join; they're queued by position (FIFO)
4. **Automatic promotion** – When a booking is cancelled:
   - System marks it as 'cancelled' (soft delete for audit trail)
   - Checks waitlist for next person
   - If their requested quantity now fits → auto-promotes to real booking
   - Recursively promotes subsequent people
5. **Partial availability** – Won't promote if insufficient tickets; person stays in queue

### Testing the Extension

1. **Login:** organiser / password123
2. **Guest List:** Click "Guest List" on any published event
3. **Cancel:** Click "Cancel" to mark a booking cancelled and trigger promotion
4. **View demo:** "Morning Yoga Flow" has limited full-price tickets (David Brown is waitlisted)
5. **Attendee side:** Try joining waitlist when an event is sold out

---

## Preparation for Submission

Before submitting, ensure:

1. ✅ Run the three commands above without errors
2. ✅ All features work (see extension testing above)
3. ✅ Remove `node_modules/`, `.git/`, and `database.db` before zipping
4. ✅ `package.json` includes `bcryptjs` and `express-session` in dependencies
5. ✅ Diagrams in report (architecture, ER diagram)
6. ✅ Video screencast (max 2.5 minutes)
7. ✅ Code PDF with plagiarism markers

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "Organiser table is empty" | This shouldn't happen; check server console for seed errors |
| "NOT NULL constraint on event_date" | Ensure you're on latest code; event_date defaults to tomorrow 18:00 |
| Port 3000 already in use | Kill the process: `lsof -ti:3000 \| xargs kill -9` (macOS/Linux) |
| Database lock errors | Delete `database.db` and run `npm run build-db` again |

---

**Questions?** Check the `Working with this Template.pdf` document or the inline code comments for detailed explanations.

