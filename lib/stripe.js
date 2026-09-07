'use strict';
const Stripe = require('stripe');
const { SECRET_KEY } = require('../config');

if (!SECRET_KEY) {
  throw new Error('STRIPE_SECRET_KEY manquant. Vérifiez le fichier .env.');
}
if (!SECRET_KEY.startsWith('sk_test_')) {
  throw new Error('Clé non-sandbox détectée. Cette démonstration refuse de tourner en mode réel.');
}

const stripe = new Stripe(SECRET_KEY, {
  maxNetworkRetries: 2,
  timeout: 20000,
  appInfo: { name: 'Velvet RFP Demo', version: '1.0.0' },
});

module.exports = stripe;
