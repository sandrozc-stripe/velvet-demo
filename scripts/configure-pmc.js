'use strict';
// Ne garde que les moyens de paiement pertinents pour un opérateur ferroviaire
// français. Douze méthodes activées par défaut n'ont aucun sens ici et
// encombreraient le formulaire projeté.
const stripe = require('../lib/stripe');
const { PMC_ID } = require('../config');

// Exactement les moyens de paiement annoncés dans le script : carte, Cartes
// Bancaires, Apple Pay, Google Pay, PayPal et Link.
//
// Link ajoute un champ e-mail au-dessus du formulaire et, une fois la voyageuse
// reconnue, peut reprendre la main sur le parcours avec sa propre marque. À
// répéter avant la présentation pour savoir à quoi ressemble l'écran projeté et
// ne pas le découvrir sur scène — voir README, « Les pièges vérifiés ».
const ON = ['card', 'cartes_bancaires', 'apple_pay', 'google_pay', 'paypal', 'link'];

(async () => {
  const before = await stripe.paymentMethodConfigurations.retrieve(PMC_ID);

  // Tout ce qui n'est pas dans la liste cible est désactivé, y compris les
  // méthodes activées par défaut sans rapport avec le ferroviaire français
  // (virement bancaire, prélèvement américain, portefeuilles asiatiques…).
  const params = {};
  const OFF = [];
  for (const [key, value] of Object.entries(before)) {
    if (!value || typeof value !== 'object' || !value.display_preference) continue;
    if (ON.includes(key)) params[key] = { display_preference: { preference: 'on' } };
    else {
      params[key] = { display_preference: { preference: 'off' } };
      if (value.display_preference.value === 'on') OFF.push(key);
    }
  }
  if (OFF.length) console.log(`\nDésactivation : ${OFF.join(', ')}`);

  await stripe.paymentMethodConfigurations.update(PMC_ID, params);
  const pmc = await stripe.paymentMethodConfigurations.retrieve(PMC_ID);

  console.log(`\nConfiguration « ${pmc.name} » · ${pmc.id}\n`);

  const missing = [];
  for (const m of ON) {
    const entry = pmc[m] || {};
    const dp = entry.display_preference || {};
    const ok = entry.available === true && dp.value === 'on';
    if (!ok) missing.push(m);
    console.log(
      `${ok ? '✓' : '✗'} ${m.padEnd(18)} available=${entry.available} preference=${dp.preference} valeur=${dp.value}`
    );
  }
  for (const m of OFF) {
    const dp = (pmc[m] || {}).display_preference || {};
    if (dp.value === 'on') console.log(`⚠ ${m.padEnd(18)} toujours actif`);
  }

  if (missing.length) {
    console.log(
      `\n⚠ Non disponibles : ${missing.join(', ')}` +
        '\n  Ces moyens de paiement exigent que la capacité correspondante soit demandée et' +
        '\n  activée sur le compte : https://dashboard.stripe.com/test/settings/payment_methods' +
        '\n  Repli pour la démonstration : narrer depuis cette page de réglages.\n'
    );
    process.exit(1);
  }

  console.log(`\nLes ${ON.length} moyens de paiement cibles sont disponibles.\n`);
})().catch((err) => {
  console.error('\n✗ Échec :', err.message, '\n');
  process.exit(1);
});
