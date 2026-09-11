'use strict';
require('dotenv').config();

const PORT = Number(process.env.PORT || 4242);
const ORIGIN = process.env.ORIGIN || `http://localhost:${PORT}`;

// Le parcours de référence de la démonstration : une seule réservation
// Paris Montparnasse -> Bordeaux Saint-Jean, suivie de bout en bout.
const BOOKING = {
  pnr: 'VLT-2028-PAR-BDX-0042',
  sqillsOrderId: 'SQ-784210',
  route: 'PAR-BDX',
  origin: 'Paris Montparnasse',
  destination: 'Bordeaux Saint-Jean',
  travelDate: '2028-01-15',
  departure: '08:12',
  arrival: '10:19',
  trainNumber: 'VLT 8412',
  coach: '4',
  seat: '32A',
  fareType: 'velvet_flex',
  fareLabel: 'Velvet Flex',
  passengerSegment: 'loyalty_member',
  amount: 7500,
  currency: 'eur',
  passenger: {
    // Identifiant fixe : la démonstration pointe toujours vers ce client, quel
    // que soit son e-mail. Fini la résolution par adresse, source de collision
    // quand plusieurs clients « Camille » coexistent dans le bac à sable.
    customerId: 'cus_VD2KkdA6Bs9Sz8',
    name: 'Camille Martin',
    // Le suffixe « +location_gb » est la façon documentée par Stripe de simuler
    // un acheteur localisé au Royaume-Uni : c'est lui qui déclenche la
    // présentation en livres sterling quand Adaptive Pricing est actif, sans
    // quoi le bac à sable présenterait toujours des euros.
    //
    // « gb », pas « uk ». Stripe attend un code pays ISO 3166 alpha-2, et « uk »
    // n'en est pas un : mesuré sur ce compte, « +location_uk » renvoie une
    // session sans aucune option de devise, donc un écran en euros avec
    // l'interrupteur en position « activé ». La casse, elle, est indifférente.
    email: 'camille.martin+location_gb@example.com',
    loyaltyId: 'VLT-LOY-88231',
  },
};

// Les prestations complémentaires vendues depuis l'espace voyageur.
const ANCILLARIES = {
  baggage: { key: 'baggage', label: 'Bagage supplémentaire', amount: 1500 },
  exchange: { key: 'exchange', label: 'Modification de trajet', amount: 2000 },
};

const ONBOARD = { label: 'Régularisation à bord', amount: 2500 };

// Les deux formules proposées à la réservation. L'aller-retour n'est pas le
// double de l'aller simple : c'est le tarif commercial affiché par Velvet.
const FARES = {
  aller_simple: { key: 'aller_simple', label: 'Aller simple', amount: 7500 },
  aller_retour: { key: 'aller_retour', label: 'Aller-retour', amount: 16000 },
};

const PMC_ID = process.env.STRIPE_PMC_ID || 'pmc_1UCZPvLxBtYMYaT4g6N4JJRh';

// Version d'API v1 exigée par `ui_mode: 'elements'` sur les sessions Checkout.
// En dessous, l'API refuse la création : « In order to use ui_mode: elements,
// you must upgrade to Stripe API version 2026-03-25.dahlia ». C'est donc une
// dépendance dure de l'intégration, pas un réglage cosmétique.
const API_VERSION = process.env.STRIPE_API_VERSION || '2026-03-25.dahlia';

// Version de l'API v2 utilisée uniquement pour l'aperçu Workflows. Valeur
// relevée dans l'onglet « API call » du déclencheur à la demande, dans le
// Dashboard — c'est la seule source de vérité pour une API en aperçu.
const WORKFLOWS_API_VERSION = process.env.WORKFLOWS_API_VERSION || '2026-08-26.preview';

module.exports = {
  PORT,
  ORIGIN,
  BOOKING,
  ANCILLARIES,
  ONBOARD,
  FARES,
  PMC_ID,
  API_VERSION,
  WORKFLOWS_API_VERSION,
  SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  PUBLIC_KEY: process.env.STRIPE_PUBLIC_KEY,
  WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
  WORKFLOW_ID: process.env.VELVET_WORKFLOW_ID,
  DASHBOARD_BASE: 'https://dashboard.stripe.com/acct_1UCZPPLxBtYMYaT4/test',
};
