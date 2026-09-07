'use strict';
const { BOOKING } = require('../config');

// Source unique de vérité pour le bloc de métadonnées qui relie Sqills,
// Stripe et le reporting financier. Toute création d'objet payant passe ici.
function buildMetadata(overrides = {}) {
  const base = {
    booking_reference: BOOKING.pnr,
    route: BOOKING.route,
    travel_date: BOOKING.travelDate,
    booking_channel: 'web',
    fare_type: BOOKING.fareType,
    passenger_segment: BOOKING.passengerSegment,
    sqills_order_id: BOOKING.sqillsOrderId,
  };
  const merged = { ...base, ...overrides };
  // Stripe refuse les valeurs nulles ; on nettoie plutôt que d'échouer à l'appel.
  for (const key of Object.keys(merged)) {
    if (merged[key] === undefined || merged[key] === null) delete merged[key];
    else merged[key] = String(merged[key]);
  }
  return merged;
}

module.exports = { buildMetadata };
