'use strict';
const express = require('express');
const stripe = require('../lib/stripe');
const store = require('../lib/store');
const { resolveBookingContext, extractAmount } = require('../lib/pnr');
const { WEBHOOK_SECRET, BOOKING } = require('../config');

const router = express.Router();

// Les événements que la démonstration exploite réellement (suivi du dossier
// local, complément des cartes enregistrées). Le reste est ignoré
// silencieusement : on répond quand même 200, comme en production.
const WATCHED = new Set([
  'payment_intent.created',
  'payment_intent.payment_failed',
  'payment_intent.requires_action',
  'payment_intent.succeeded',
  'payment_intent.amount_capturable_updated',
  'payment_intent.updated',
  'charge.succeeded',
  'charge.refunded',
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
  'checkout.session.expired',
  'payment_method.attached',
]);

// Le paiement enregistre automatiquement la carte (setup_future_usage), mais
// Stripe ne la rend réaffichable dans le Payment Element que si
// allow_redisplay vaut « always » — sans case à cocher côté client, la carte
// reste sinon attachée au client mais invisible au paiement suivant.
// Checkout ne prérempli/ne propose une carte enregistrée pour un `customer`
// que si le PaymentMethod porte aussi un nom, un email et une adresse de
// facturation valides. Le Payment Element de /paiement ne collecte pas ces
// champs (carte seule) : sans ce complément, la carte de Camille resterait
// enregistrée sur le client mais invisible à bord, forçant une re-saisie.
async function backfillBillingDetails(paymentMethod) {
  const billing = paymentMethod.billing_details || {};
  const patch = {};
  if (paymentMethod.allow_redisplay !== 'always') patch.allow_redisplay = 'always';
  if (!billing.name || !billing.email) {
    patch.billing_details = {
      name: billing.name || BOOKING.passenger.name,
      email: billing.email || BOOKING.passenger.email,
    };
  }
  if (!Object.keys(patch).length) return;
  try {
    await stripe.paymentMethods.update(paymentMethod.id, patch);
  } catch (err) {
    console.error('[webhook] complément moyen de paiement:', err.message);
  }
}

// express.raw est monté sur cette route dans server.js : la vérification de
// signature exige le corps brut, non parsé.
router.post('/', async (req, res) => {
  let event;
  try {
    if (!WEBHOOK_SECRET) throw new Error('STRIPE_WEBHOOK_SECRET absent');
    event = stripe.webhooks.constructEvent(
      req.body,
      req.headers['stripe-signature'],
      WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('[webhook] signature invalide:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // On accuse réception immédiatement : le traitement ne doit jamais retarder
  // la réponse à Stripe.
  res.json({ received: true });

  if (!WATCHED.has(event.type)) return;

  try {
    const ctx = await resolveBookingContext(stripe, event);
    const o = event.data.object;
    const status = o.status || o.payment_status || null;

    // Le dossier local suit l'état, comme le ferait Sqills à la réception du
    // webhook.
    if (ctx.pnr) {
      const paymentIntentId =
        event.type.startsWith('payment_intent.') ? o.id
        : typeof o.payment_intent === 'string' ? o.payment_intent
        : null;
      if (paymentIntentId) {
        store.addPayment(ctx.pnr, {
          paymentIntent: paymentIntentId,
          amount: extractAmount(event),
          status,
          lastEvent: event.type,
          updatedAt: Date.now(),
        });
      }
    }

    // La session Checkout ne crée son PaymentIntent qu'à la confirmation :
    // c'est cet événement qui apprend au dossier quel paiement le porte, et
    // donc ce que l'annulation depuis l'espace voyageur remboursera.
    if (event.type.startsWith('checkout.session.')) {
      store.linkCheckoutSession(o);
    }

    console.log(`[webhook] ${event.type} ${o.id} pnr=${ctx.pnr || '—'} statut=${status || '—'}`);

    if (event.type === 'payment_method.attached') {
      backfillBillingDetails(o);
    }
  } catch (err) {
    console.error('[webhook] traitement:', err.message);
  }
});

module.exports = router;
