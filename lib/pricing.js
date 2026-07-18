/**
 * lib/pricing.js
 * This works out the current ticket price based on how many tickets have
 * already sold. Both routes/attendees.js and routes/organisers.js need
 * this same logic, so it lives here in one place instead of being
 * copy-pasted into both files.
 */

/**
 * calculateCurrentPrice(ticketTypeId, callback)
 * Works out what a ticket type currently costs based on % sold so far.
 * The price goes up in tiers the more tickets are sold:
 *   0-49% sold: normal price
 *   50-79% sold: price x 1.15
 *   80-99% sold: price x 1.3
 *   100% sold: returns null (no price, ticket type is sold out)
 */
function calculateCurrentPrice(ticketTypeId, callback) {
    // Get the base price, how many tickets are available in total, and
    // how many have already been booked, so we can work out % sold
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

        // Nothing left to sell, so there's no price to show
        if (row.remaining === 0) {
            return callback(null, null);
        }

        // Work out what percentage of tickets have sold so far
        const percentSold = (row.sold / row.quantity_total) * 100;

        // Pick the right price multiplier for that percentage
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

module.exports = { calculateCurrentPrice };
