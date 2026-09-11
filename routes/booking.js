'use strict';
const express = require('express');
const stripe = require('../lib/stripe');
const { buildMetadata } = require('../lib/metadata');
const store = require('../lib/store');
const { generatePnr } = require('../lib/pnr');
const { BOOKING, FARES, ORIGIN } = require('../config');

const router = express.Router();

// Réutilise le client s'il existe déjà : le passager de la démonstration est
// toujours le même, et on veut voir son historique s'accumuler.
async function findOrCreateCustomer() {
  const found = await stripe.customers.list({ email: BOOKING.passenger.email, limit: 1 });
  if (found.data.length) {
    const customer = found.data[0];

    // Le client « +location_gb » du bac à sable a été créé hors de ce parcours,
    // donc sans métadonnées. Or l'espace voyageur retombe sur l'adresse e-mail
    // quand le numéro de fidélité manque : il projetterait alors le suffixe
    // technique en pleine démonstration. On complète une fois pour toutes.
    if (!customer.metadata || !customer.metadata.loyalty_id) {
      return stripe.customers.update(customer.id, {
        metadata: {
          loyalty_id: BOOKING.passenger.loyaltyId,
          passenger_segment: BOOKING.passengerSegment,
          sqills_customer_id: 'SQ-CUST-11204',
        },
      });
    }

    return customer;
  }

  return stripe.customers.create({
    email: BOOKING.passenger.email,
    name: BOOKING.passenger.name,
    phone: '+33612345678',
    address: { line1: '14 rue de la Gaîté', postal_code: '75014', city: 'Paris', country: 'FR' },
    preferred_locales: ['fr-FR'],
    metadata: {
      loyalty_id: BOOKING.passenger.loyaltyId,
      passenger_segment: BOOKING.passengerSegment,
      sqills_customer_id: 'SQ-CUST-11204',
    },
  });
}

// Toute vente de la démonstration passe par une session Checkout en
// `ui_mode: 'elements'` : c'est elle qui porte le montant, le client, les
// métadonnées du dossier et l'URL de retour, et c'est son client_secret qui
// initialise le Payment Element côté navigateur.
//
// Deux points valent d'être notés, parce qu'ils remplacent la CustomerSession
// de l'intégration Payment Intents :
//   - la carte enregistrée de Camille est réaffichée du seul fait que la
//     session porte un `customer` (le navigateur laisse `savedPaymentMethod`
//     en réglage automatique) ;
//   - l'enregistrement reste sans case à cocher — `payment_method_save` est
//     désactivé et c'est `payment_intent_data.setup_future_usage` qui
//     enregistre la carte à chaque paiement réussi.
function createCheckoutSession({
  customerId,
  amount,
  productName,
  description,
  statementSuffix,
  metadata,
  adaptivePricing = false,
}) {
  return stripe.checkout.sessions.create({
    ui_mode: 'elements',
    mode: 'payment',
    customer: customerId,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: BOOKING.currency,
          unit_amount: amount,
          product_data: { name: productName, description },
        },
      },
    ],
    // Adaptive Pricing se règle à la création de la session : il ne se modifie
    // pas sur une session déjà ouverte. C'est pour cette raison que
    // l'interrupteur de l'écran Paiement recharge la page sur une session neuve
    // plutôt que de reconfigurer l'instance Checkout du navigateur.
    //
    // Le paramètre est toujours transmis, jamais omis. Sans lui, la session
    // hériterait du réglage du Dashboard — déjà actif sur ce bac à sable — et
    // l'état « désactivé » de la démonstration ne serait pas démontrable.
    //
    // Par défaut à false : la prestation complémentaire de l'espace voyageur
    // partage cette fabrique mais ne monte pas de Currency Selector Element, or
    // Stripe exige de l'afficher dès qu'une session peut être convertie.
    adaptive_pricing: { enabled: Boolean(adaptivePricing) },
    // Aucune configuration de moyens de paiement n'est épinglée ici, et aucune
    // liste `payment_method_types` : la session retombe sur la configuration
    // par défaut du compte et c'est Stripe qui décide quels moyens présenter,
    // selon le pays du voyageur, la devise et l'appareil.
    //
    // Épingler `pmc_…` ne changeait rien à l'écran — cette configuration *est*
    // la configuration par défaut du compte (`is_default: true`) — mais figeait
    // dans le code une décision qui appartient au Dashboard. `npm run pmc`
    // continue de la piloter ; le parcours ne la nomme plus.
    // Aucune case « enregistrer ma carte » : le consentement de la
    // démonstration est porté par setup_future_usage, comme avant.
    saved_payment_method_options: { payment_method_save: 'disabled' },
    payment_intent_data: {
      setup_future_usage: 'off_session',
      statement_descriptor_suffix: statementSuffix,
      description,
      receipt_email: BOOKING.passenger.email,
      metadata,
    },
    // Le même bloc de métadonnées sur la session : le dossier est
    // retrouvable dès `checkout.session.completed`, sans attendre le
    // PaymentIntent.
    metadata,
    // `redirect: 'if_required'` garde les cartes sur velvet.fr ; cette URL ne
    // sert qu'aux moyens de paiement qui redirigent réellement.
    return_url: `${ORIGIN}/confirmation?checkout_session={CHECKOUT_SESSION_ID}`,
  });
}

// Ce que l'API a réellement retenu, indépendamment de ce qu'on a demandé.
function sessionAllowsConversion(session) {
  return Boolean(session.adaptive_pricing && session.adaptive_pricing.enabled);
}

// Adaptive Pricing ne change pas la devise d'encaissement : la session et le
// paiement restent en euros, et c'est `presentment_details` qui porte ce que le
// voyageur a vu et réglé. Le champ est *absent* quand aucune conversion n'a eu
// lieu — c'est ce qui distingue les deux états, et pourquoi on ne teste pas
// `null`.
function readPresentment(...objects) {
  const found = objects.find((o) => o && o.presentment_details);
  if (!found) return { presentmentAmount: null, presentmentCurrency: null };

  return {
    presentmentAmount: found.presentment_details.presentment_amount,
    presentmentCurrency: found.presentment_details.presentment_currency,
  };
}

// Une référence neuve par réservation, jamais réutilisée par le dossier en
// mémoire — sinon rien ne distingue une vraie collision d'une simple reprise.
function freshPnr() {
  let pnr = generatePnr();
  while (store.get(pnr)) pnr = generatePnr();
  return pnr;
}

// POST /api/booking — crée le dossier de paiement du trajet Paris -> Bordeaux.
// Appelé à chaque chargement de l'écran Paiement : on repart toujours d'une
// session Checkout neuve sur un PNR neuf, pour ne jamais réutiliser une session
// déjà réglée pendant les répétitions, et pour que le Dashboard Stripe filtré
// sur ce PNR ne montre que cette réservation.
router.post('/booking', async (req, res, next) => {
  try {
    const fareKey = FARES[req.body && req.body.tripType] ? req.body.tripType : 'aller_simple';
    const fare = FARES[fareKey];
    // Seul le booléen `true` active la conversion : une valeur inattendue dans
    // la requête ne doit pas changer silencieusement la devise présentée au
    // milieu de la présentation.
    const adaptivePricing = (req.body && req.body.adaptivePricing) === true;
    const pnr = freshPnr();

    const customer = await findOrCreateCustomer();

    const session = await createCheckoutSession({
      customerId: customer.id,
      amount: fare.amount,
      productName: `Velvet — ${fare.label}`,
      description: `Velvet — ${fare.label} — ${BOOKING.origin} → ${BOOKING.destination} — ${BOOKING.travelDate} ${BOOKING.departure}`,
      statementSuffix: 'VELVET PARBDX',
      metadata: buildMetadata({
        booking_reference: pnr,
        trip_type: fareKey,
        train_number: BOOKING.trainNumber,
        seat: `${BOOKING.coach}-${BOOKING.seat}`,
        // Trace du réglage employé : le Dashboard doit pouvoir dire pourquoi ce
        // dossier a été présenté en livres et le suivant en euros.
        adaptive_pricing: adaptivePricing ? 'enabled' : 'disabled',
      }),
      adaptivePricing,
    });

    // Le PaymentIntent n'existe pas encore : la session Checkout le crée à la
    // confirmation. Le dossier suit donc la session, et l'identifiant du
    // paiement arrive par `checkout.session.completed` ou par la lecture de la
    // session sur l'écran de confirmation.
    store.upsert(pnr, {
      customerId: customer.id,
      checkoutSessionId: session.id,
      amount: fare.amount,
      tripType: fareKey,
      fareLabel: fare.label,
      route: `${BOOKING.origin} → ${BOOKING.destination}`,
      travelDate: BOOKING.travelDate,
      departure: BOOKING.departure,
      status: 'reservee',
      // Le dossier retient le réglage : c'est lui qui explique l'écart entre le
      // montant encaissé et le montant réglé, sur le billet comme au
      // rapprochement.
      adaptivePricing: sessionAllowsConversion(session),
    });

    res.json({
      clientSecret: session.client_secret,
      checkoutSessionId: session.id,
      customerId: customer.id,
      pnr,
      tripType: fareKey,
      fareLabel: fare.label,
      amount: fare.amount,
      // On renvoie ce que l'API a répondu, pas ce qu'on a demandé : si le
      // réglage du compte refusait la conversion, l'écran doit le dire.
      adaptivePricing: sessionAllowsConversion(session),
      returnUrl: `${ORIGIN}/confirmation?checkout_session=${session.id}`,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/booking/current — le dossier le plus récent, pour les écrans qui
// n'ont pas reçu de PNR explicite (terminal à bord, régularisation).
router.get('/booking/current', (req, res) => {
  const dossier = store.mostRecent();
  res.json({ pnr: dossier ? dossier.pnr : BOOKING.pnr });
});

// GET /api/booking — la liste des dossiers en mémoire, du plus récent au plus
// ancien. Sert le sélecteur de voyage du terminal chef de bord : la
// régularisation ne doit plus retomber silencieusement sur le dossier le plus
// récent quand plusieurs voyageurs sont à bord.
router.get('/booking', (req, res) => {
  const dossiers = store
    .all()
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .map((d) => ({
      pnr: d.pnr,
      route: d.route || `${BOOKING.origin} → ${BOOKING.destination}`,
      travelDate: d.travelDate || BOOKING.travelDate,
      departure: d.departure || BOOKING.departure,
      fareLabel: d.fareLabel,
      status: d.status,
    }));
  res.json({ dossiers });
});

// GET /api/booking/:pnr — état du dossier, pour l'écran de confirmation et la
// console d'exploitation.
router.get('/booking/:pnr', async (req, res, next) => {
  try {
    const dossier = store.get(req.params.pnr);
    if (!dossier) return res.status(404).json({ error: 'Dossier inconnu' });
    res.json(dossier);
  } catch (err) {
    next(err);
  }
});

// GET /api/checkout/session/:id — état d'une session Checkout, interrogé par
// l'écran de confirmation. C'est ici que le dossier apprend l'identifiant du
// PaymentIntent que la session vient de créer : sans cette lecture, une
// démonstration jouée sans « npm run listen » n'aurait aucun paiement à
// rembourser depuis l'espace voyageur.
router.get('/checkout/session/:id', async (req, res, next) => {
  try {
    const session = await stripe.checkout.sessions.retrieve(req.params.id, {
      expand: ['payment_intent'],
    });
    store.linkCheckoutSession(session);

    const pi = session.payment_intent && typeof session.payment_intent === 'object' ? session.payment_intent : null;
    res.json({
      id: session.id,
      status: session.status,
      paymentStatus: session.payment_status,
      amountTotal: session.amount_total,
      currency: session.currency,
      metadata: session.metadata,
      paymentIntentId: pi ? pi.id : typeof session.payment_intent === 'string' ? session.payment_intent : null,
      paymentIntentStatus: pi ? pi.status : null,
      bookingReference: (session.metadata && session.metadata.booking_reference) || null,
      adaptivePricing: sessionAllowsConversion(session),
      ...readPresentment(session, pi),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/payment/:id — état d'un paiement, pour l'écran de confirmation.
// N'expose que ce que le billet doit afficher.
router.get('/payment/:id', async (req, res, next) => {
  try {
    const pi = await stripe.paymentIntents.retrieve(req.params.id, {
      expand: ['latest_charge', 'payment_method'],
    });
    const charge = pi.latest_charge && typeof pi.latest_charge === 'object' ? pi.latest_charge : null;
    const card = charge && charge.payment_method_details ? charge.payment_method_details.card : null;

    res.json({
      id: pi.id,
      status: pi.status,
      amount: pi.amount,
      currency: pi.currency,
      metadata: pi.metadata,
      created: pi.created,
      ...readPresentment(pi, charge),
      chargeId: charge ? charge.id : null,
      receiptUrl: charge ? charge.receipt_url : null,
      card: card
        ? {
            brand: card.brand,
            last4: card.last4,
            network: card.network,
            country: card.country,
            wallet: card.wallet ? card.wallet.type : null,
            // La présence de authentication_flow prouve que l'authentification
            // forte a bien eu lieu : c'est l'exhibit DSP2 de la démonstration.
            threeDSecure: card.three_d_secure || null,
          }
        : null,
      savedPaymentMethod:
        pi.payment_method && typeof pi.payment_method === 'object'
          ? { id: pi.payment_method.id, allowRedisplay: pi.payment_method.allow_redisplay }
          : null,
      setupFutureUsage: pi.setup_future_usage || null,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = { router, findOrCreateCustomer, createCheckoutSession };
