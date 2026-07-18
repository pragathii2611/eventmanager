/**
 * lib/pricing.js
 * Shared dynamic pricing logic used by both routes/attendees.js (booking,
 * event detail page) and routes/organisers.js (waitlist promotion).
 * Previously duplicated verbatim in both files — extracted here so the
 * tiering rules only exist in one place.
 */

/**
 * calculateCurrentPrice(ticketTypeId, callback)
 * Calculates the current tiered price for a ticket type based on % sold
 * Tiers:
 *   0–49% sold: base price × 1.0
 *   50–79% sold: base price × 1.15
 *   80–99% sold: base price × 1.3
 *   100% sold: null (waitlist only)
 */
function calculateCurrentPrice(ticketTypeId, callback) {
    // Query: get base price, capacity, and total active tickets sold for
    // this ticket type, so % sold (and therefore the tier) can be derived
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

        // If all sold, return null (waitlist only)
        if (row.remaining === 0) {
            return callback(null, null);
        }

        // Calculate percentage sold
        const percentSold = (row.sold / row.quantity_total) * 100;

        // Apply tiered pricing
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
