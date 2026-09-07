'use strict';

// La référence de réservation ne se trouve pas au même endroit selon le type
// d'événement. C'est tout l'intérêt de la démonstration : quel que soit
// l'événement, on retrouve le PNR — donc cette extraction doit être fiable.
//
//   payment_intent.*                 -> object.metadata
//   charge.* / charge.refunded       -> object.metadata (recopié depuis le PI)
//   charge.dispute.*                 -> object.metadata, sinon via la charge
//   checkout.session.*               -> object.metadata
//   radar.early_fraud_warning.*      -> pas de metadata : nécessite la charge
//   refund.*                         -> object.metadata
//
// Renvoie { pnr, sqillsOrderId, route, needsLookup } ; needsLookup indique
// qu'un appel API supplémentaire est nécessaire pour compléter.
function extractBookingContext(event) {
  const o = (event && event.data && event.data.object) || {};
  const candidates = [
    o.metadata,
    o.payment_intent && o.payment_intent.metadata,
    o.charge && o.charge.metadata,
    o.latest_charge && o.latest_charge.metadata,
    o.payment_intent_data && o.payment_intent_data.metadata,
  ];

  for (const md of candidates) {
    if (md && md.booking_reference) {
      return {
        pnr: md.booking_reference,
        sqillsOrderId: md.sqills_order_id || null,
        route: md.route || null,
        bookingChannel: md.booking_channel || null,
        fareType: md.fare_type || null,
        needsLookup: false,
      };
    }
  }

  // Rien en local : on signale l'objet à interroger côté API.
  const chargeId = typeof o.charge === 'string' ? o.charge : null;
  const piId = typeof o.payment_intent === 'string' ? o.payment_intent : null;
  return {
    pnr: null,
    sqillsOrderId: null,
    route: null,
    bookingChannel: null,
    fareType: null,
    needsLookup: Boolean(chargeId || piId),
    lookup: { charge: chargeId, paymentIntent: piId },
  };
}

// Complète le contexte en interrogeant Stripe, uniquement quand c'est requis
// (typiquement radar.early_fraud_warning.created).
async function resolveBookingContext(stripe, event) {
  const ctx = extractBookingContext(event);
  if (ctx.pnr || !ctx.needsLookup) return ctx;

  try {
    let metadata = null;
    if (ctx.lookup.paymentIntent) {
      const pi = await stripe.paymentIntents.retrieve(ctx.lookup.paymentIntent);
      metadata = pi.metadata;
    } else if (ctx.lookup.charge) {
      const charge = await stripe.charges.retrieve(ctx.lookup.charge);
      metadata = charge.metadata;
      if (!metadata || !metadata.booking_reference) {
        if (charge.payment_intent) {
          const pi = await stripe.paymentIntents.retrieve(charge.payment_intent);
          metadata = pi.metadata;
        }
      }
    }
    if (metadata && metadata.booking_reference) {
      return {
        pnr: metadata.booking_reference,
        sqillsOrderId: metadata.sqills_order_id || null,
        route: metadata.route || null,
        bookingChannel: metadata.booking_channel || null,
        fareType: metadata.fare_type || null,
        needsLookup: false,
      };
    }
  } catch (err) {
    // On ne bloque jamais le flux d'événements pour un enrichissement manquant.
    console.warn('[pnr] enrichissement impossible:', err.message);
  }
  return ctx;
}

// Montant représentatif de l'événement, en centimes, ou null.
function extractAmount(event) {
  const o = (event && event.data && event.data.object) || {};
  if (typeof o.amount_refunded === 'number' && o.amount_refunded > 0 && event.type === 'charge.refunded') {
    return o.amount_refunded;
  }
  for (const k of ['amount', 'amount_total', 'amount_captured']) {
    if (typeof o[k] === 'number') return o[k];
  }
  return null;
}

// Une référence neuve à chaque réservation : sur le Dashboard Stripe, filtrer
// par ce PNR ne fait ressortir que les événements de cette démonstration, pas
// ceux d'une répétition précédente.
function generatePnr() {
  const suffix = String(Math.floor(Math.random() * 9000) + 1000);
  return `VLT-2028-PAR-BDX-${suffix}`;
}

module.exports = { extractBookingContext, resolveBookingContext, extractAmount, generatePnr };
