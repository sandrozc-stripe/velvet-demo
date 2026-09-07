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
    name: 'Camille Martin',
    email: 'camille.martin@example.com',
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
  WORKFLOWS_API_VERSION,
  SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  PUBLIC_KEY: process.env.STRIPE_PUBLIC_KEY,
  WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
  WORKFLOW_ID: process.env.VELVET_WORKFLOW_ID,
  DASHBOARD_BASE: 'https://dashboard.stripe.com/acct_1UCZPPLxBtYMYaT4/test',
};
