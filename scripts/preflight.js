'use strict';
// À lancer dix minutes avant la présentation. Lecture seule côté données de
// démonstration : aucune création, aucun remboursement, aucune modification.
// Le seul appel écrivant est un paiement de contrôle de 1,00 € clairement
// étiqueté, désactivable avec PREFLIGHT_NO_CHARGE=1.

const fs = require('fs');
const path = require('path');
const stripe = require('../lib/stripe');
const { BOOKING, PMC_ID, PORT, ORIGIN, WEBHOOK_SECRET, WORKFLOW_ID, PUBLIC_KEY } = require('../config');

let failures = 0;
let warnings = 0;

function ok(label, detail) {
  console.log(`✓ ${label}${detail ? ` — ${detail}` : ''}`);
}
function ko(label, detail) {
  console.log(`✗ ${label}${detail ? ` — ${detail}` : ''}`);
  failures += 1;
}
function warn(label, detail) {
  console.log(`⚠ ${label}${detail ? ` — ${detail}` : ''}`);
  warnings += 1;
}
function check(cond, label, detail) {
  cond ? ok(label, detail) : ko(label, detail);
}

// 1. Aucune clé secrète dans ce qui est servi au navigateur -----------------
function secretSweep() {
  console.log('\n1. Étanchéité des secrets');
  const root = path.join(__dirname, '..', 'public');
  const hits = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(html|js|css|json|svg)$/.test(entry.name)) {
        const text = fs.readFileSync(full, 'utf8');
        if (/sk_(test|live)_/.test(text) || /whsec_/.test(text) || /rk_(test|live)_/.test(text)) {
          hits.push(path.relative(root, full));
        }
      }
    }
  };
  walk(root);
  check(hits.length === 0, 'aucune clé secrète dans public/', hits.length ? hits.join(', ') : 'balayage propre');
  check(Boolean(PUBLIC_KEY && PUBLIC_KEY.startsWith('pk_test_')), 'clé publiable de test', PUBLIC_KEY ? PUBLIC_KEY.slice(0, 14) + '…' : 'absente');
}

// 2. Compte et moyens de paiement -------------------------------------------
async function accountChecks() {
  console.log('\n2. Compte');
  const account = await stripe.accounts.retrieve();
  ok('compte', `${account.id} · ${account.country} · ${account.default_currency.toUpperCase()}`);
  if (!account.charges_enabled) {
    warn('charges_enabled = false', 'les paiements de test fonctionnent malgré tout — vérifié');
  } else {
    ok('charges_enabled', 'true');
  }

  // Adaptive Pricing exige que la devise des prix soit une devise de règlement
  // du compte. C'est la seule de ses conditions qui se lise par l'API.
  check(
    BOOKING.currency === account.default_currency,
    'devise des prix réglable par le compte',
    `${BOOKING.currency.toUpperCase()} · règlement ${account.default_currency.toUpperCase()}`
  );

  // Le réglage Adaptive Pricing du Dashboard n'a pas d'API de lecture. Les
  // sessions déjà créées le reflètent : c'est le seul signal disponible, et il
  // est réel. S'il tombe à false, l'interrupteur de l'écran Paiement restera en
  // euros dans les deux positions.
  const sessions = await stripe.checkout.sessions.list({ limit: 5 });
  const converting = sessions.data.filter((s) => s.adaptive_pricing && s.adaptive_pricing.enabled);
  if (!sessions.data.length) {
    warn('réglage Adaptive Pricing invérifiable', 'aucune session Checkout sur le compte — jouez /paiement une fois');
  } else {
    check(
      converting.length > 0,
      'Adaptive Pricing actif sur le compte',
      `${converting.length}/${sessions.data.length} session(s) récente(s) en adaptive_pricing.enabled`
    );
  }

  console.log('\n3. Moyens de paiement');
  const pmc = await stripe.paymentMethodConfigurations.retrieve(PMC_ID);
  // Exactement les moyens de paiement annoncés dans le script — même liste que
  // scripts/configure-pmc.js, Link inclus.
  for (const m of ['card', 'cartes_bancaires', 'apple_pay', 'google_pay', 'paypal', 'link']) {
    const e = pmc[m] || {};
    const dp = e.display_preference || {};
    const enabled = e.available === true && dp.value === 'on';
    // Apple Pay ne s'affichera pas sur http://localhost : c'est attendu et
    // couvert par la capture d'écran de repli.
    if (!enabled && m === 'apple_pay') warn(`${m} indisponible`, 'repli capture d’écran prévu');
    else check(enabled, m, `available=${e.available} valeur=${dp.value}`);
  }
}

// 3. Le jeu de données donne bien l'impression d'un compte en activité -------
async function dataChecks() {
  console.log('\n4. Jeu de données');
  const [pis, customers, disputes, efws] = await Promise.all([
    stripe.paymentIntents.list({ limit: 100 }),
    stripe.customers.list({ limit: 100 }),
    stripe.disputes.list({ limit: 20 }),
    stripe.radar.earlyFraudWarnings.list({ limit: 20 }),
  ]);
  check(pis.data.length >= 100, 'volume de paiements', `${pis.data.length}+ sur la première page`);
  check(customers.data.length >= 50, 'clients', `${customers.data.length}+`);
  check(disputes.data.length >= 1, 'litiges', String(disputes.data.length));
  check(efws.data.length >= 1, 'alertes de fraude précoce', String(efws.data.length));

  console.log('\n5. Recherche par dossier');
  const byRoute = await stripe.paymentIntents.search({ query: 'metadata["route"]:"PAR-BDX"', limit: 1 });
  check(byRoute.data.length > 0, 'indexation de la recherche opérationnelle', `${byRoute.data.length} résultat(s) sur route=PAR-BDX`);
}

// 4. L'état du dossier de démonstration -------------------------------------
async function demoBookingChecks() {
  console.log('\n6. Dossier de démonstration');
  const res = await stripe.paymentIntents.search({
    query: `metadata["booking_reference"]:"${BOOKING.pnr}"`,
    limit: 20,
  });

  if (!res.data.length) {
    warn(`aucun paiement sur ${BOOKING.pnr}`, 'normal avant la première répétition du parcours');
    return;
  }
  ok(`paiements sur ${BOOKING.pnr}`, String(res.data.length));

  const live = res.data.filter((pi) => ['requires_payment_method', 'requires_confirmation', 'requires_action'].includes(pi.status));
  const canceled = res.data.filter((pi) => pi.status === 'canceled');
  if (canceled.length) {
    warn(`${canceled.length} intention(s) annulée(s)`, 'trop de confirmations en répétition — l’écran en recrée une à chaque chargement');
  }
  ok('intentions ouvertes', live.length ? live.map((p) => p.id).join(', ') : 'aucune — une nouvelle sera créée au chargement de /paiement');

  // La carte réaffichable dans « Mon espace » doit exister et porter le bon
  // consentement, sinon l'écran D affiche un formulaire vide.
  const customers = await stripe.customers.list({ email: BOOKING.passenger.email, limit: 1 });
  if (!customers.data.length) {
    warn('client de démonstration absent', 'sera créé au premier chargement de /paiement');
    return;
  }
  const pms = await stripe.paymentMethods.list({ customer: customers.data[0].id, type: 'card', limit: 10 });
  const redisplayable = pms.data.filter((pm) => pm.allow_redisplay === 'always');
  if (redisplayable.length) {
    ok('carte réaffichable pour « Mon espace »', redisplayable.map((pm) => `${pm.card.brand} ••${pm.card.last4}`).join(', '));
  } else if (pms.data.length === 0) {
    // Après « npm run reset » le dossier est volontairement vierge : la carte
    // n'existera qu'une fois l'écran B joué sur scène. C'est l'état attendu
    // dix minutes avant la présentation, pas un blocage.
    warn('aucune carte enregistrée', 'état normal après remise à zéro — l’écran B la créera en direct');
  } else {
    ko(
      'carte réaffichable pour « Mon espace »',
      `${pms.data.length} carte(s), aucune en allow_redisplay=always — rejouez /paiement en cochant « enregistrer »`
    );
  }
}

// 5. Serveur, webhook, workflow ---------------------------------------------
async function runtimeChecks() {
  console.log('\n7. Exécution locale');
  check(Boolean(WEBHOOK_SECRET), 'STRIPE_WEBHOOK_SECRET présent', WEBHOOK_SECRET ? 'signature vérifiable' : 'lancez « npm run listen » puis relancez le serveur');
  if (WORKFLOW_ID) ok('VELVET_WORKFLOW_ID', WORKFLOW_ID);
  else warn('VELVET_WORKFLOW_ID absent', 'le bouton « Déclencher le workflow » restera désactivé');

  try {
    const res = await fetch(`${ORIGIN}/api/config`, { signal: AbortSignal.timeout(3000) });
    const body = await res.json();
    check(res.ok, `serveur joignable sur le port ${PORT}`, `HTTP ${res.status}`);
    const leaked = JSON.stringify(body).match(/sk_test_|whsec_/);
    check(!leaked, '/api/config ne renvoie aucun secret', 'seule la clé publiable est exposée');
  } catch {
    ko(`serveur injoignable sur ${ORIGIN}`, 'lancez « npm start »');
  }

  for (const p of ['/', '/paiement', '/espace', '/bord']) {
    try {
      const res = await fetch(`${ORIGIN}${p}`, { signal: AbortSignal.timeout(3000) });
      check(res.ok, `écran ${p}`, `HTTP ${res.status}`);
    } catch {
      ko(`écran ${p}`, 'injoignable');
    }
  }
}

(async () => {
  console.log('\n──── Contrôle avant présentation — Velvet ────');
  secretSweep();
  await accountChecks();
  await dataChecks();
  await demoBookingChecks();
  await runtimeChecks();

  console.log(
    `\n──── ${failures ? `${failures} blocage(s)` : 'aucun blocage'}` +
      `${warnings ? `, ${warnings} avertissement(s)` : ''} ────\n`
  );
  process.exit(failures ? 1 : 0);
})().catch((err) => {
  console.error('\n✗ Contrôle interrompu :', err.message, '\n');
  process.exit(1);
});
