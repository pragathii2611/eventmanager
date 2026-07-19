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
