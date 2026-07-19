# Event Manager - CM2040 Coursework

An event management app. Organisers can create, publish and manage events; attendees can browse published events and book tickets.

## How to run it

```bash
npm install
npm run build-db
npm run start
```

(On Windows use `npm run build-db-win` instead.)

Then go to `http://localhost:3000` in your browser.

## Logging in as the organiser

An organiser account is created automatically the first time you start the app.

Username: `organiser`
Password: `password123`

## Extra libraries used

Two packages on top of the ones in the template:

- **bcryptjs** - hashes the organiser's password so it's never stored as plain text
- **express-session** - keeps the organiser logged in between page requests

Everything else (QR codes, calendar files, charts) is done with plain Node.js or free CDN scripts, so no extra packages were needed for those.

## What's in it

Base features: organiser login, creating/editing/publishing/deleting events, a settings page for the site name and description, and attendees booking tickets for published events.

On top of that:

- **Waitlist** - once a ticket type sells out, attendees can join a waitlist. If a booking gets cancelled, the next person in the queue is automatically promoted to a real booking.
- **Dynamic pricing** - ticket prices go up the more of them sell (0-49% sold = normal price, 50-79% = price x1.15, 80-99% = price x1.3). The price shown on the booking page always reflects this.
- **Analytics dashboard** - total revenue, tickets sold, revenue per event, and waitlist conversion rate, all worked out with SQL queries.
- **QR code tickets** - the booking confirmation page shows a QR code with the booking details.
- **Calendar export** - attendees can download an event as a .ics file to add to their calendar.

## Quick way to see the waitlist working

1. Log in as the organiser and open the guest list for an event that's sold out (or book all the tickets for one yourself from the attendee side)
2. Join the waitlist as an attendee for that sold-out ticket type
3. Back on the organiser side, cancel one of the existing bookings for that ticket type
4. The waitlisted person should now show up as a real booking
