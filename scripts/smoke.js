'use strict';
// Portail zéro : si ce script échoue, rien d'autre n'a de sens. Il vérifie que
// le compte bac à sable accepte réellement une autorisation de carte.
const stripe = require('../lib/stripe');

(async () => {
  let failures = 0;
  const check = (ok, label, detail) => {
    console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
    if (!ok) failures += 1;
  };

  const account = await stripe.accounts.retrieve();
  console.log(`\nCompte ${account.id} · ${account.country} · ${account.default_currency.toUpperCase()}\n`);
  check(account.charges_enabled, 'charges_enabled', String(account.charges_enabled));
  check(account.details_submitted, 'details_submitted', String(account.details_submitted));

  const pi = await stripe.paymentIntents.create(
    {
      amount: 100,
      currency: 'eur',
      payment_method: 'pm_card_visa',
      payment_method_types: ['card'],
      confirm: true,
      description: 'Velvet — test de fumée',
      metadata: { velvet_smoke: 'true' },
    },
    { idempotencyKey: 'velvet-smoke-v1' }
  );
  check(pi.status === 'succeeded', 'autorisation de 1,00 € confirmée', `${pi.id} · ${pi.status}`);

  const cs = await stripe.customerSessions.create({
    customer: (await stripe.customers.create({ email: 'velvet.smoke@example.com' })).id,
    components: { payment_element: { enabled: true, features: { payment_method_save: 'enabled', payment_method_save_usage: 'off_session', payment_method_redisplay: 'enabled', payment_method_remove: 'enabled' } } },
  });
  check(Boolean(cs.client_secret), 'CustomerSession créée', 'case « enregistrer » disponible');

  const search = await stripe.paymentIntents.search({ query: 'metadata["velvet_smoke"]:"true"', limit: 1 });
  check(Array.isArray(search.data), 'recherche PaymentIntent disponible', `${search.data.length} résultat(s)`);

  console.log(failures ? `\n${failures} vérification(s) en échec.\n` : '\nToutes les vérifications passent.\n');
  process.exit(failures ? 1 : 0);
})().catch((err) => {
  console.error('\n✗ Échec :', err.message, '\n');
  process.exit(1);
});
