'use strict';
const express = require('express');
const stripe = require('../lib/stripe');
const { buildMetadata } = require('../lib/metadata');
const store = require('../lib/store');
const { toSvg } = require('../lib/qr');
const { BOOKING, ONBOARD } = require('../config');

const router = express.Router();

// Mémorise la dernière session à bord pour que l'écran puisse interroger son
// état sans repasser par le QR code.
let lastSession = null;

// POST /api/bord/session — le contrôleur régularise un voyageur à bord.
// Chaque appel produit un Payment Link neuf, propre à ce PNR et à usage
// unique : ce n'est pas un lien de paiement statique partagé. Le voyageur
// reste sur le domaine Stripe jusqu'à la confirmation, donc son téléphone n'a
// jamais besoin de joindre le serveur local de la démo.
router.post('/bord/session', async (req, res, next) => {
  try {
    const pnr = (req.body && req.body.pnr) || (store.mostRecent() && store.mostRecent().pnr) || BOOKING.pnr;
    const dossier = store.get(pnr);

    // Un Payment Link n'accepte pas de paramètre `customer` : contrairement
    // à /paiement, la carte enregistrée du voyageur ne sera pas préremplie
    // sur ce parcours — accepté pour ce flux d'appoint à bord.
    const paymentLink = await stripe.paymentLinks.create({
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: BOOKING.currency,
            unit_amount: ONBOARD.amount,
            product_data: {
              name: `${ONBOARD.label} — ${BOOKING.origin} → ${BOOKING.destination}`,
              description: `Dossier ${pnr} — ${BOOKING.trainNumber} — voiture ${BOOKING.coach} place ${BOOKING.seat}`,
            },
          },
        },
      ],
      // Un lien par dossier, utilisable une seule fois : ce n'est pas un lien
      // de paiement statique partagé. Un Payment Link n'a pas d'expiration
      // dans le temps (pas d'`expires_at`), donc c'est la restriction
      // d'usage qui porte cette garantie plutôt qu'une minuterie.
      restrictions: { completed_sessions: { limit: 1 } },
      // Le voyageur reste sur le domaine Stripe pour voir la confirmation :
      // aucune redirection vers l'appli, donc aucune dépendance à ce que le
      // téléphone du voyageur puisse joindre le serveur local de la démo.
      after_completion: {
        type: 'hosted_confirmation',
        hosted_confirmation: {
          custom_message: `Paiement confirmé — dossier ${pnr}. Un reçu a été envoyé par email.`,
        },
      },
      // Le PNR voyage jusque dans le PaymentIntent : le paiement encaissé à
      // bord se rapproche du même dossier que le billet acheté sur le web.
      payment_intent_data: {
        description: `Velvet — ${ONBOARD.label} — ${pnr}`,
        statement_descriptor_suffix: 'VELVET BORD',
        metadata: buildMetadata({
          booking_reference: pnr,
          booking_channel: 'onboard',
          ancillary_type: 'onboard_regularisation',
          parent_payment_intent: (dossier && dossier.paymentIntentId) || undefined,
          collected_by: 'chef_de_bord',
        }),
      },
      metadata: buildMetadata({ booking_reference: pnr, booking_channel: 'onboard' }),
    });

    lastSession = {
      sessionId: paymentLink.id,
      pnr,
      url: paymentLink.url,
      amount: ONBOARD.amount,
      label: ONBOARD.label,
    };

    res.json({
      sessionId: paymentLink.id,
      url: paymentLink.url,
      // Le QR est rendu en SVG côté serveur : rien à dessiner côté client,
      // net à toutes les tailles de projection.
      qrSvg: toSvg(paymentLink.url, { size: 460 }),
      pnr,
      amount: ONBOARD.amount,
      label: ONBOARD.label,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/bord/session/:id — état du Payment Link, interrogé par l'écran du
// chef de bord pendant que le voyageur paie sur son téléphone. Un Payment
// Link n'a pas de statut de paiement propre : on regarde la Checkout Session
// que Stripe crée dès que le voyageur entame le paiement sur ce lien.
router.get('/bord/session/:id', async (req, res, next) => {
  try {
    const sessions = await stripe.checkout.sessions.list({
      payment_link: req.params.id,
      limit: 1,
      expand: ['data.payment_intent'],
    });
    const session = sessions.data[0];
    if (!session) {
      return res.json({ sessionId: req.params.id, status: 'open', paymentStatus: 'unpaid' });
    }
    const pi = session.payment_intent;
    res.json({
      sessionId: session.id,
      status: session.status,
      paymentStatus: session.payment_status,
      amountTotal: session.amount_total,
      paymentIntentId: pi ? pi.id : null,
      paymentIntentStatus: pi ? pi.status : null,
      bookingReference: pi && pi.metadata ? pi.metadata.booking_reference : null,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/bord/last — permet de rouvrir l'écran sans perdre la session en cours.
router.get('/bord/last', (req, res) => {
  if (!lastSession) return res.status(404).json({ error: 'Aucune session à bord' });
  res.json({ ...lastSession, qrSvg: toSvg(lastSession.url, { size: 460 }) });
});

module.exports = router;
