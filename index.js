/**
 * index.js
 * This is the main entry point for the Event Manager app.
 * It sets up Express, connects to the SQLite database, sets up sessions
 * and the EJS view engine, and loads the organiser and attendee routes.
 * It also creates a default organiser account the first time the app runs.
 */

const express = require('express');
const session = require('express-session');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');

const app = express();
const port = 3000;

// Lets us read form data sent from POST requests (req.body)
app.use(express.urlencoded({ extended: true }));

// Keeps the organiser logged in between page requests using a session cookie
app.use(session({
    secret: 'event-manager-secret-key-change-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false } // would be true if using HTTPS
}));

// Tell Express to use EJS for rendering pages
app.set('view engine', 'ejs');

// Serve CSS/JS files from the public folder
app.use(express.static(__dirname + '/public'));

// Connect to the database file
global.db = new sqlite3.Database('./database.db', function(err){
    if(err){
        console.error(err);
        process.exit(1);
    } else {
        console.log("Database connected");
        global.db.run("PRAGMA foreign_keys=ON");

        // Make sure there is always at least one organiser account to log in with
        seedDefaultOrganiser();
    }
});

/**
 * Creates a default organiser account if one doesn't already exist.
 * This means the app works straight away without any manual setup step.
 * Default login: username "organiser", password "password123".
 */
function seedDefaultOrganiser() {
    const checkQuery = "SELECT COUNT(*) as count FROM organisers";

    global.db.get(checkQuery, function(err, row) {
        if (err) {
            console.error("Error checking organisers table:", err);
            return;
        }

        if (row.count === 0) {
            // No organiser exists yet, so create the default one
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

/**
 * GET /
 * The main landing page. Just shows two links: one to the organiser
 * side and one to the attendee side.
 * Inputs: none
 * Outputs: renders main.ejs
 */
app.get('/', (req, res) => {
    res.render('main');
});

// Bring in the two route files and mount them at their base URLs
const organisersRoutes = require('./routes/organisers');
const attendeesRoutes = require('./routes/attendees');

app.use('/organiser', organisersRoutes);
app.use('/attendee', attendeesRoutes);

/**
 * Catches any error passed to next(err) from the routes above.
 * Without this, Express would send the full error stack trace back to
 * the browser, which isn't something we want users to see. Instead we
 * log the real error to the server console and show a simple message.
 */
app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).send('Something went wrong. Please try again.');
});

// Start the server
app.listen(port, () => {
    console.log(`Event Manager listening on http://localhost:${port}`);
});
