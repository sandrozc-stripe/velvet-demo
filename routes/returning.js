'use strict';
const express = require('express');
const stripe = require('../lib/stripe');
const { buildMetadata } = require('../lib/metadata');
const store = require('../lib/store');
const { findOrCreateCustomer, createCheckoutSession } = require('./booking');
const { BOOKING, ANCILLARIES, ORIGIN } = require('../config');

const router = express.Router();

// GET /api/espace — profil voyageur : moyens de paiement enregistrés et
// consentement. Velvet conserve un identifiant client et un identifiant de
// moyen de paiement, jamais le numéro de carte.
router.get('/espace', async (req, res, next) => {
  try {
    const customer = await findOrCreateCustomer();
    const methods = await stripe.paymentMethods.list({
      customer: customer.id,
      type: 'card',
      limit: 10,
    });

    res.json({
      customer: {
        id: customer.id,
        name: customer.name,
        email: customer.email,
        loyaltyId: (customer.metadata && customer.metadata.loyalty_id) || null,
      },
      paymentMethods: methods.data.map((pm) => ({
        id: pm.id,
        brand: pm.card.brand,
        last4: pm.card.last4,
        expMonth: pm.card.exp_month,
        expYear: pm.card.exp_year,
        country: pm.card.country,
        // allow_redisplay est ce qui autorise Stripe à réafficher la carte :
        // c'est la trace technique du consentement du passager.
        allowRedisplay: pm.allow_redisplay,
        wallet: pm.card.wallet ? pm.card.wallet.type : null,
      })),
      // Toutes les réservations de Camille, la plus récente en tête : c'est
      // la liste depuis laquelle elle choisit celle à annuler.
      bookings: store
        .all()
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
        .map((b) => ({
          pnr: b.pnr,
          route: b.route || `${BOOKING.origin} → ${BOOKING.destination}`,
          travelDate: b.travelDate || BOOKING.travelDate,
          departure: b.departure || BOOKING.departure,
          tripType: b.tripType || 'aller_simple',
          fareLabel: b.fareLabel || BOOKING.fareLabel,
          amount: b.amount || BOOKING.amount,
          status: b.status || 'reservee',
          paymentIntentId: b.paymentIntentId || null,
        })),
      ancillaries: Object.values(ANCILLARIES),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/espace/charge — prestation complémentaire réglée depuis l'espace
// voyageur, sans quitter la page : une session Checkout est créée comme pour la
// réservation initiale (routes/booking.js), et le paiement se fait via un
// Payment Element monté directement dans l'espace.
router.post('/espace/charge', async (req, res, next) => {
  try {
    const key = req.body && req.body.ancillary;
    const ancillary = ANCILLARIES[key];
    if (!ancillary) {
      return res.status(400).json({ error: `Prestation inconnue : ${key}` });
    }

    const customer = await findOrCreateCustomer();

    // Le billet parent est le dossier choisi par Camille dans « Vos voyages »,
    // pas systématiquement le plus récent : chaque réservation a sa propre
    // référence, et la prestation doit se rattacher à celle actuellement
    // sélectionnée. À défaut de sélection explicite, on retombe sur le
    // dossier le plus récent en mémoire.
    const requestedPnr = req.body && req.body.pnr;
    if (requestedPnr && !store.get(requestedPnr)) {
      return res.status(404).json({ error: `Dossier inconnu : ${requestedPnr}` });
    }
    const dossier = (requestedPnr && store.get(requestedPnr)) || store.mostRecent();
    const pnr = (dossier && dossier.pnr) || BOOKING.pnr;
    let parent = (dossier && dossier.paymentIntentId) || undefined;
    if (!parent) {
      const recent = await stripe.paymentIntents.list({ customer: customer.id, limit: 20 });
      const ticket = recent.data.find(
        (pi) => pi.status === 'succeeded' && pi.metadata && pi.metadata.booking_reference && !pi.metadata.ancillary_type
      );
      if (ticket) parent = ticket.id;
    }

    // Même fabrique de session que pour la réservation : c'est le `customer`
    // porté par la session qui fait réafficher la carte enregistrée de Camille
    // pour un paiement en un geste.
    const session = await createCheckoutSession({
      customerId: customer.id,
      amount: ancillary.amount,
      productName: `Velvet — ${ancillary.label}`,
      description: `Velvet — ${ancillary.label} — ${pnr}`,
      statementSuffix: 'VELVET SERVICE',
      metadata: buildMetadata({
        booking_reference: pnr,
        ancillary_type: ancillary.key,
        ancillary_label: ancillary.label,
        parent_payment_intent: parent,
      }),
    });

    res.json({
      clientSecret: session.client_secret,
      checkoutSessionId: session.id,
      pnr,
      label: ancillary.label,
      amount: ancillary.amount,
      returnUrl: `${ORIGIN}/confirmation?checkout_session=${session.id}`,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/espace/cancel — Camille annule une réservation depuis son espace.
// Le dossier passe à « annulee » et le paiement associé est intégralement
// remboursé : c'est la seule action qui touche à la fois la réservation et
// la transaction Stripe.
router.post('/espace/cancel', async (req, res, next) => {
  try {
    const pnr = req.body && req.body.pnr;
    const dossier = pnr && store.get(pnr);
    if (!dossier) return res.status(404).json({ error: 'Dossier inconnu' });
    if (dossier.status === 'annulee') {
      return res.status(409).json({ error: 'Ce dossier est déjà annulé.' });
    }
    if (!dossier.paymentIntentId) {
      return res.status(409).json({ error: 'Aucun paiement associé à ce dossier.' });
    }

    const refund = await stripe.refunds.create({
      payment_intent: dossier.paymentIntentId,
      reason: 'requested_by_customer',
      metadata: buildMetadata({
        booking_reference: pnr,
        refund_origin: 'espace_voyageur',
      }),
    });

    store.upsert(pnr, { status: 'annulee' });

    res.json({
      pnr,
      refundId: refund.id,
      amount: refund.amount,
      status: refund.status,
      bookingStatus: 'annulee',
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
