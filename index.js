/**
 * index.js
 * Event Manager application entry point
 *
 * Sets up Express server with SQLite database, EJS templating, sessions, and routes.
 * Auto-seeds default organiser account on first startup if none exists.
 */

// ============================================================================
// DEPENDENCIES
// ============================================================================
const express = require('express');
const session = require('express-session');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');

// ============================================================================
// APP SETUP
// ============================================================================
const app = express();
const port = 3000;

// Middleware: body parsing (Express 4.16+ has this built in; no separate
// body-parser package needed — avoids relying on it as an undeclared
// transitive dependency of express itself)
app.use(express.urlencoded({ extended: true }));

// Middleware: session management
app.use(session({
    secret: 'event-manager-secret-key-change-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false } // set true in production with HTTPS
}));

// View engine setup
app.set('view engine', 'ejs');

// Static files
app.use(express.static(__dirname + '/public'));

// ============================================================================
// DATABASE SETUP
// ============================================================================
global.db = new sqlite3.Database('./database.db', function(err){
    if(err){
        console.error(err);
        process.exit(1);
    } else {
        console.log("Database connected");
        global.db.run("PRAGMA foreign_keys=ON");

        // Auto-seed default organiser on first run
        seedDefaultOrganiser();
    }
});

/**
 * @desc Seeds a default organiser account if none exists
 * Prevents needing a separate npm script; auto-runs on startup
 * Default credentials: username="organiser", password="password123" (hashed with bcrypt)
 * Logs credentials to console on creation
 */
function seedDefaultOrganiser() {
    const checkQuery = "SELECT COUNT(*) as count FROM organisers";

    global.db.get(checkQuery, function(err, row) {
        if (err) {
            console.error("Error checking organisers table:", err);
            return;
        }

        if (row.count === 0) {
            // No organisers exist; create default
            const defaultUsername = 'organiser';
            const defaultPassword = 'password123';
            const salt = bcrypt.genSaltSync(10);
            const passwordHash = bcrypt.hashSync(defaultPassword, salt);

            const insertQuery = "INSERT INTO organisers (username, password_hash) VALUES (?, ?)";
            global.db.run(insertQuery, [defaultUsername, passwordHash], function(err) {
                if (err) {
                    console.error("Error seeding default organiser:", err);
                } else {
                    console.log("========================================");
                    console.log("Default organiser account created:");
                    console.log("Username: organiser");
                    console.log("Password: password123");
                    console.log("========================================");
                }
            });
        }
    });
}

// ============================================================================
// ROUTES
// ============================================================================

/**
 * GET /
 * Main home page: displays links to organiser and attendee sections
 * Inputs: none
 * Outputs: rendered main.ejs view with navigation links
 */
app.get('/', (req, res) => {
    res.render('main');
});

// Import and use route modules
const organisersRoutes = require('./routes/organisers');
const attendeesRoutes = require('./routes/attendees');

app.use('/organiser', organisersRoutes);
app.use('/attendee', attendeesRoutes);

// ============================================================================
// ERROR HANDLING
// ============================================================================

/**
 * Global error handler — every route calls next(err) on a DB failure, but
 * without a handler here Express falls back to its own default handler,
 * which sends a full stack trace (file paths, line numbers, query text) to
 * the browser. Catch it here and log server-side instead.
 */
app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).send('Something went wrong. Please try again.');
});

// ============================================================================
// SERVER START
// ============================================================================
app.listen(port, () => {
    console.log(`Event Manager listening on http://localhost:${port}`);
});

