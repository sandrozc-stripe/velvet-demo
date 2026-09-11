'use strict';
// Peuple le bac à sable pour qu'il se lise comme le compte d'un opérateur en
// activité : des clients français, des trajets cohérents, des refus, des
// remboursements, des litiges et des alertes de fraude.
//
// Deux garde-fous : une clé d'idempotence sur chaque création (une relance
// partielle ne double pas le jeu de données) et un refus de tourner si le
// compte contient déjà de l'activité.

const stripe = require('../lib/stripe');

// La version fait partie des clés d'idempotence : la changer permet de rejouer
// un peuplement propre sans se heurter aux clés déjà consommées.
const SEED_VERSION = process.env.SEED_VERSION || 'v1';
const TOTAL = Number(process.env.SEED_TOTAL || 400);
const CUSTOMERS = Number(process.env.SEED_CUSTOMERS || 70);
const WORKERS = 7; // ~10-15 requêtes/s : sous la limite du bac à sable

const PRENOMS = ['Camille', 'Louis', 'Amélie', 'Hugo', 'Léa', 'Nathan', 'Chloé', 'Théo', 'Manon', 'Lucas',
  'Inès', 'Gabriel', 'Sarah', 'Jules', 'Émma', 'Raphaël', 'Alice', 'Adam', 'Louise', 'Paul',
  'Zoé', 'Arthur', 'Jade', 'Maël', 'Anaïs', 'Noah', 'Clara', 'Ethan', 'Juliette', 'Tom',
  'Margaux', 'Antoine', 'Élise', 'Baptiste', 'Charlotte'];
const NOMS = ['Martin', 'Bernard', 'Dubois', 'Thomas', 'Robert', 'Richard', 'Petit', 'Durand', 'Leroy',
  'Moreau', 'Simon', 'Laurent', 'Lefèvre', 'Michel', 'Garcia', 'David', 'Bertrand', 'Roux',
  'Vincent', 'Fournier', 'Morel', 'Girard', 'André', 'Mercier', 'Blanc', 'Guérin', 'Boyer',
  'Rousseau', 'Muller', 'Lemaire', 'Faure', 'Chevalier', 'Colin', 'Gauthier', 'Perrin'];
const VILLES = [
  { city: 'Paris', postal_code: '75011', line1: '12 rue Oberkampf' },
  { city: 'Bordeaux', postal_code: '33000', line1: '8 cours de l’Intendance' },
  { city: 'Nantes', postal_code: '44000', line1: '5 rue Crébillon' },
  { city: 'Rennes', postal_code: '35000', line1: '21 rue Saint-Michel' },
  { city: 'Angers', postal_code: '49100', line1: '3 place du Ralliement' },
  { city: 'Lyon', postal_code: '69002', line1: '17 rue Mercière' },
  { city: 'Tours', postal_code: '37000', line1: '9 rue Colbert' },
];

const ROUTES = [
  { code: 'PAR-BDX', from: 'Paris Montparnasse', to: 'Bordeaux Saint-Jean', base: 7500, weight: 34 },
  { code: 'BDX-PAR', from: 'Bordeaux Saint-Jean', to: 'Paris Montparnasse', base: 7500, weight: 30 },
  { code: 'PAR-NTS', from: 'Paris Montparnasse', to: 'Nantes', base: 6200, weight: 14 },
  { code: 'NTS-PAR', from: 'Nantes', to: 'Paris Montparnasse', base: 6200, weight: 8 },
  { code: 'PAR-RNS', from: 'Paris Montparnasse', to: 'Rennes', base: 5800, weight: 9 },
  { code: 'PAR-ANG', from: 'Paris Montparnasse', to: 'Angers', base: 4900, weight: 5 },
];

const FARES = [
  { type: 'velvet_eco', mult: 0.72, weight: 42 },
  { type: 'velvet_flex', mult: 1, weight: 38 },
  { type: 'velvet_premiere', mult: 1.85, weight: 20 },
];

const SEGMENTS = [
  { v: 'leisure', weight: 46 },
  { v: 'business', weight: 27 },
  { v: 'loyalty_member', weight: 19 },
  { v: 'group', weight: 8 },
];

const CHANNELS = [
  { v: 'web', weight: 58 },
  { v: 'mobile_app', weight: 27 },
  { v: 'onboard', weight: 8 },
  { v: 'agency', weight: 7 },
];

const SUCCESS_CARDS = [
  { pm: 'pm_card_visa', weight: 34 },
  { pm: 'pm_card_visa_debit', weight: 18 },
  { pm: 'pm_card_mastercard', weight: 22 },
  { pm: 'pm_card_amex', weight: 8 },
  { pm: 'pm_card_fr', weight: 10 },
  { pm: 'pm_card_visa_cartesBancaires', weight: 8 },
];

const DECLINES = [
  { pm: 'pm_card_visa_chargeDeclined', weight: 30 },
  { pm: 'pm_card_visa_chargeDeclinedInsufficientFunds', weight: 28 },
  { pm: 'pm_card_chargeDeclinedExpiredCard', weight: 14 },
  { pm: 'pm_card_chargeDeclinedIncorrectCvc', weight: 12 },
  { pm: 'pm_card_chargeDeclinedProcessingError', weight: 8 },
  { pm: 'pm_card_chargeDeclinedFraudulent', weight: 8 },
];

// ---------- aléatoire déterministe : deux exécutions produisent le même jeu ----------

let state = 0x2f6e2b1;
function rnd() {
  state ^= state << 13; state >>>= 0;
  state ^= state >> 17;
  state ^= state << 5; state >>>= 0;
  return state / 0xffffffff;
}
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
function weighted(list) {
  const total = list.reduce((s, x) => s + x.weight, 0);
  let r = rnd() * total;
  for (const x of list) {
    r -= x.weight;
    if (r <= 0) return x;
  }
  return list[list.length - 1];
}
const between = (a, b) => a + Math.floor(rnd() * (b - a + 1));

// Retire les accents pour construire des adresses e-mail valides.
const slug = (s) =>
  s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z]/g, '');

// ---------- exécution avec reprise sur limitation de débit ----------

async function withRetry(label, fn, attempt = 0) {
  try {
    return await fn();
  } catch (err) {
    const retryable = err.type === 'StripeRateLimitError' || err.statusCode === 429 || err.code === 'lock_timeout';
    if (retryable && attempt < 6) {
      const reason = (err.raw && err.raw.headers && err.raw.headers['stripe-rate-limited-reason']) || '—';
      const wait = Math.round(400 * 2 ** attempt + rnd() * 400);
      console.log(`  … ${label} limité (${reason}), nouvelle tentative dans ${wait} ms`);
      await new Promise((r) => setTimeout(r, wait));
      return withRetry(label, fn, attempt + 1);
    }
    throw err;
  }
}

async function pool(items, worker) {
  let cursor = 0;
  let done = 0;
  const results = [];
  const errors = [];
  await Promise.all(
    Array.from({ length: WORKERS }, async () => {
      while (cursor < items.length) {
        const i = cursor++;
        try {
          const r = await worker(items[i], i);
          if (r) results.push(r);
        } catch (err) {
          errors.push({ i, message: err.message });
        }
        done += 1;
        if (done % 25 === 0) process.stdout.write(`  ${done}/${items.length}\r`);
      }
    })
  );
  return { results, errors };
}

// ---------- construction d'une réservation ----------

function travelDate() {
  // Les dates de voyage sont réparties sur le premier trimestre 2028 : c'est le
  // champ metadata qui porte la temporalité, l'horodatage Stripe restant celui
  // de la création.
  const month = pick(['01', '02', '03']);
  return `2028-${month}-${String(between(1, 28)).padStart(2, '0')}`;
}

function booking(i) {
  const route = weighted(ROUTES);
  const fare = weighted(FARES);
  const passengers = rnd() < 0.24 ? between(2, 4) : 1;
  const amount = Math.round((route.base * fare.mult * passengers) / 100) * 100;
  return {
    pnr: `VLT-2028-${route.code.replace('-', '-')}-${String(1000 + i)}`,
    route,
    fare,
    passengers,
    amount: Math.max(2500, Math.min(amount, 185000)),
    channel: weighted(CHANNELS).v,
    segment: weighted(SEGMENTS).v,
    travel_date: travelDate(),
    sqills: `SQ-${between(700000, 799999)}`,
  };
}

function metadataFor(b) {
  return {
    booking_reference: b.pnr,
    route: b.route.code,
    travel_date: b.travel_date,
    booking_channel: b.channel,
    fare_type: b.fare.type,
    passenger_segment: b.segment,
    sqills_order_id: b.sqills,
    passengers: String(b.passengers),
  };
}

// ---------- programme principal ----------

(async () => {
  const existing = await stripe.paymentIntents.list({ limit: 100 });
  if (existing.data.length > 50) {
    console.log(
      `\n⚠ Le compte contient déjà ${existing.data.length}+ intentions de paiement.` +
        '\n  Le peuplement est annulé pour ne pas doubler le jeu de données.' +
        '\n  Forcez avec SEED_FORCE=1 si c’est volontaire.\n'
    );
    if (!process.env.SEED_FORCE) process.exit(0);
  }

  console.log(`\nPeuplement du bac à sable Velvet — ${TOTAL} paiements, ${CUSTOMERS} clients\n`);

  // 1. Clients ---------------------------------------------------------------
  console.log('1/5 Clients');
  const customerSpecs = Array.from({ length: CUSTOMERS }, (_, i) => {
    const prenom = pick(PRENOMS);
    const nom = pick(NOMS);
    const ville = pick(VILLES);
    return {
      i,
      name: `${prenom} ${nom}`,
      email: `${slug(prenom)}.${slug(nom)}${i}@example.com`,
      ville,
      loyalty: rnd() < 0.4 ? `VLT-LOY-${between(10000, 99999)}` : null,
    };
  });

  const { results: customers, errors: cErrors } = await pool(customerSpecs, (spec) =>
    withRetry(`client ${spec.i}`, () =>
      stripe.customers.create(
        {
          name: spec.name,
          email: spec.email,
          preferred_locales: ['fr-FR'],
          address: { ...spec.ville, country: 'FR' },
          metadata: {
            sqills_customer_id: `SQ-CUST-${20000 + spec.i}`,
            ...(spec.loyalty ? { loyalty_id: spec.loyalty } : {}),
          },
        },
        { idempotencyKey: `velvet-${SEED_VERSION}-customer-${spec.i}` }
      )
    )
  );
  console.log(`  ${customers.length} créés${cErrors.length ? `, ${cErrors.length} en échec` : ''}`);

  // 2. Répartition des paiements --------------------------------------------
  // 300 autorisés · 40 refusés · 25 remboursés · 8 litiges · 6 alertes fraude
  // · le reste abandonné à l'étape d'authentification.
  const plan = [];
  const counts = {
    succeeded: Math.round(TOTAL * 0.75),
    declined: Math.round(TOTAL * 0.1),
    refunded: Math.round(TOTAL * 0.0625),
    disputed: Math.round(TOTAL * 0.02),
    efw: Math.round(TOTAL * 0.015),
  };
  counts.abandoned = TOTAL - counts.succeeded - counts.declined - counts.refunded - counts.disputed - counts.efw;

  let idx = 0;
  for (const [kind, count] of Object.entries(counts)) {
    for (let k = 0; k < count; k++) plan.push({ kind, i: idx++ });
  }
  console.log(`2/5 Paiements — ${Object.entries(counts).map(([k, v]) => `${k}:${v}`).join(' · ')}`);

  const created = { succeeded: [], declined: [], refunded: [], disputed: [], efw: [], abandoned: [] };

  const { errors: pErrors } = await pool(plan, async (item) => {
    const b = booking(item.i);
    const customer = customers[item.i % customers.length];
    // Clé des intentions bumpée en `pi2` avec le passage à
    // automatic_payment_methods : une clé d'idempotence rejouée avec des
    // paramètres différents est refusée. Les clés des clients ne bougent pas —
    // leurs paramètres sont inchangés, et un rejeu ne doit pas les dupliquer.
    const key = `velvet-${SEED_VERSION}-pi2-${item.kind}-${item.i}`;
    const base = {
      amount: b.amount,
      currency: 'eur',
      // Pas de `payment_method_types` : aucune liste de moyens de paiement
      // n'est écrite en dur dans ce dépôt. Le moyen étant fourni à la
      // confirmation, les redirections sont interdites — sinon l'API exige une
      // `return_url` qu'un jeu de données n'a pas.
      automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
      confirm: true,
      description: `Velvet — ${b.route.from} → ${b.route.to} — ${b.travel_date}`,
      statement_descriptor_suffix: `VELVET ${b.route.code.replace('-', '')}`.slice(0, 22),
      metadata: metadataFor(b),
    };

    if (item.kind === 'declined') {
      // Les cartes de refus ne peuvent pas être rattachées à un client : on
      // crée donc un paiement invité, ce qui reflète aussi la réalité.
      const pi = await withRetry(key, () =>
        stripe.paymentIntents
          .create({ ...base, payment_method: weighted(DECLINES).pm }, { idempotencyKey: key })
          .catch((err) => {
            // Un refus se présente comme une erreur de carte : c'est le
            // résultat attendu, pas une panne.
            if (err.type === 'StripeCardError') return err.raw.payment_intent;
            throw err;
          })
      );
      if (pi) created.declined.push(pi.id);
      return null;
    }

    if (item.kind === 'abandoned') {
      // Authentification demandée puis jamais terminée : impossible à
      // confirmer côté serveur, ce qui produit exactement l'état voulu.
      const pi = await withRetry(key, () =>
        stripe.paymentIntents.create(
          { ...base, customer: customer.id, payment_method: 'pm_card_authenticationRequired' },
          { idempotencyKey: key }
        )
      );
      created.abandoned.push(pi.id);
      return null;
    }

    const pm =
      item.kind === 'efw'
        ? 'pm_card_createIssuerFraudRecord'
        : item.kind === 'disputed'
          ? 'pm_card_createDispute'
          : weighted(SUCCESS_CARDS).pm;

    const pi = await withRetry(key, () =>
      stripe.paymentIntents.create(
        // Pas de setup_future_usage ici : l'API l'interdit avec off_session,
        // et on ne veut surtout pas que ces cartes de test deviennent
        // réaffichables — l'écran « Mon espace » doit ne montrer que la carte
        // enregistrée en direct sur scène.
        { ...base, customer: customer.id, payment_method: pm, off_session: true },
        { idempotencyKey: key }
      )
    );
    created[item.kind === 'refunded' ? 'refunded' : item.kind].push(pi.id);
    return null;
  });

  const totalCreated = Object.values(created).reduce((s, a) => s + a.length, 0);
  console.log(`  ${totalCreated} intentions créées${pErrors.length ? `, ${pErrors.length} en échec` : ''}`);
  if (pErrors.length) console.log(`  premier échec : ${pErrors[0].message}`);

  // 3. Remboursements -------------------------------------------------------
  console.log('3/5 Remboursements');
  const refundPlan = created.refunded.map((id, k) => ({ id, k, full: k % 2 === 0 }));
  const { results: refunds } = await pool(refundPlan, async (r) => {
    const pi = await withRetry(`pi ${r.id}`, () => stripe.paymentIntents.retrieve(r.id));
    if (pi.status !== 'succeeded') return null;
    const amount = r.full ? undefined : Math.max(500, Math.round(pi.amount * 0.35 / 100) * 100);
    return withRetry(`remboursement ${r.k}`, () =>
      stripe.refunds.create(
        {
          payment_intent: r.id,
          ...(amount ? { amount } : {}),
          reason: pick(['requested_by_customer', 'requested_by_customer', 'duplicate']),
          metadata: {
            booking_reference: pi.metadata.booking_reference,
            sqills_order_id: pi.metadata.sqills_order_id,
            refund_origin: r.full ? 'annulation_train' : 'geste_commercial',
          },
        },
        { idempotencyKey: `velvet-${SEED_VERSION}-refund-${r.k}` }
      )
    );
  });
  console.log(`  ${refunds.length} remboursements (${refundPlan.filter((r) => r.full).length} intégraux)`);

  // 4. Litiges : l'issue se pilote par le texte de la preuve, pas par un champ.
  console.log('4/5 Litiges');
  await new Promise((r) => setTimeout(r, 3000));
  const disputes = await stripe.disputes.list({ limit: 50 });
  let closed = 0;
  for (const [k, d] of disputes.data.entries()) {
    if (d.status !== 'needs_response') continue;
    const win = k % 3 !== 0; // deux gagnés pour un perdu
    try {
      await withRetry(`litige ${d.id}`, () =>
        stripe.disputes.update(d.id, {
          evidence: {
            uncategorized_text: win ? 'winning_evidence' : 'losing_evidence',
            customer_name: 'Voyageur Velvet',
            product_description: 'Billet de train à grande vitesse, trajet effectué',
          },
          submit: true,
          metadata: { handled_by: 'service_client_velvet' },
        })
      );
      closed += 1;
    } catch (err) {
      console.log(`  ⚠ ${d.id} : ${err.message}`);
    }
  }
  console.log(`  ${disputes.data.length} litiges, ${closed} traités`);

  // 5. Contrôles ------------------------------------------------------------
  console.log('5/5 Contrôles');
  const [pis, efws, custs] = await Promise.all([
    stripe.paymentIntents.list({ limit: 1 }),
    stripe.radar.earlyFraudWarnings.list({ limit: 10 }),
    stripe.customers.list({ limit: 1 }),
  ]);
  console.log(`  alertes de fraude précoce : ${efws.data.length}`);
  console.log(`  litiges : ${disputes.data.length}`);
  console.log(`  dernière intention : ${pis.data[0] && pis.data[0].id}`);
  console.log(`  dernier client : ${custs.data[0] && custs.data[0].id}`);
  console.log('\nPeuplement terminé. L’indexation de la recherche peut prendre une minute.\n');
})().catch((err) => {
  console.error('\n✗ Échec du peuplement :', err.message, '\n');
  process.exit(1);
});
