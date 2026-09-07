'use strict';
const fs = require('fs');
const path = require('path');
const express = require('express');
const { PORT, ORIGIN, BOOKING, ANCILLARIES, ONBOARD, FARES, PUBLIC_KEY, WEBHOOK_SECRET, WORKFLOW_ID, DASHBOARD_BASE } = require('./config');

const bookingRoutes = require('./routes/booking');
const returningRoutes = require('./routes/returning');
const onboardRoutes = require('./routes/onboard');
const webhookRoutes = require('./routes/webhook');

const app = express();
app.disable('x-powered-by');

// Le webhook doit recevoir le corps brut : il est monté AVANT express.json,
// sinon la vérification de signature échoue systématiquement.
app.use('/webhook', express.raw({ type: 'application/json' }), webhookRoutes);

app.use(express.json());

// Journal minimal : lisible pendant la démonstration, sans bruit inutile.
app.use((req, res, next) => {
  if (req.path.startsWith('/api') || req.path === '/webhook') {
    console.log(`${req.method} ${req.originalUrl}`);
  }
  next();
});

// GET /api/config — uniquement la clé publiable. La clé secrète ne quitte
// jamais le serveur.
app.get('/api/config', (req, res) => {
  res.json({
    publishableKey: PUBLIC_KEY,
    origin: ORIGIN,
    booking: BOOKING,
    fares: FARES,
    ancillaries: ANCILLARIES,
    onboard: ONBOARD,
    dashboardBase: DASHBOARD_BASE,
    workflowConfigured: Boolean(WORKFLOW_ID),
    webhookConfigured: Boolean(WEBHOOK_SECRET),
  });
});

// GET /api/font — Work Sans encodée en base64. Stripe.js refuse toute source
// de police en http:// (« URLs have to start with 'https://' or 'data:' »), donc
// sur localhost la seule façon d'obtenir la typographie Velvet à l'intérieur de
// l'iframe de paiement est de la passer en data: URI. Lue une fois, gardée en
// mémoire.
let fontCache = null;
app.get('/api/font', (req, res, next) => {
  try {
    if (!fontCache) {
      const file = path.join(__dirname, 'public', 'fonts', 'WorkSans-VariableFont_wght.woff2');
      fontCache = fs.readFileSync(file).toString('base64');
    }
    res.type('text/plain').send(fontCache);
  } catch (err) {
    next(err);
  }
});

app.use('/api', bookingRoutes.router);
app.use('/api', returningRoutes);
app.use('/api', onboardRoutes);

const PUBLIC_DIR = path.join(__dirname, 'public');
app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));

// Adresses lisibles pour la barre d'URL projetée : /paiement plutôt que
// /paiement.html.
const PAGES = {
  '/': 'index.html',
  '/paiement': 'paiement.html',
  '/confirmation': 'confirmation.html',
  '/espace': 'espace.html',
  '/bord': 'bord.html',
};
for (const [route, file] of Object.entries(PAGES)) {
  app.get(route, (req, res) => res.sendFile(path.join(PUBLIC_DIR, file)));
}

// Gestion d'erreur unique : renvoie un message exploitable à l'écran plutôt
// qu'une page blanche.
app.use((err, req, res, next) => {
  const status = err.statusCode || 500;
  console.error('[erreur]', err.type || '', err.message);
  res.status(status).json({
    error: err.message || 'Erreur interne',
    type: err.type || null,
    code: err.code || null,
  });
});

app.listen(PORT, () => {
  console.log(`\nVelvet — démonstration RFP`);
  console.log(`  Écrans      ${ORIGIN}/  ·  /paiement  ·  /espace  ·  /bord`);
  console.log(`  Webhook     ${WEBHOOK_SECRET ? 'signature configurée' : '⚠ STRIPE_WEBHOOK_SECRET absent — lancez « npm run listen »'}`);
  console.log(`  Workflow    ${WORKFLOW_ID ? WORKFLOW_ID : '⚠ VELVET_WORKFLOW_ID absent'}`);
  console.log('');
});
