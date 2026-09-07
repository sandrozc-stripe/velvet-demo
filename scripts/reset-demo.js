'use strict';
// Remet le dossier de démonstration à zéro entre deux répétitions.
//
// Un PaymentIntent ne se supprime pas. Or chaque répétition en crée trois ou
// quatre sur le même PNR, et le tableau de rapprochement projeté finirait par
// afficher dix lignes au lieu de deux. On réécrit donc la référence de dossier
// des intentions existantes vers une référence d'archive : le PNR de la
// démonstration redevient vierge, sans rien détruire.
//
// Les cartes enregistrées du client de démonstration sont aussi détachées, pour
// que la case « enregistrer ce moyen de paiement » de l'écran B ait un effet
// visible et que « Mon espace » ne montre pas la carte d'une répétition passée.

const stripe = require('../lib/stripe');
const { BOOKING } = require('../config');

const ARCHIVE = 'VLT-REPETITION-ARCHIVE';

(async () => {
  console.log('\n──── Remise à zéro du dossier de démonstration ────\n');

  const customers = await stripe.customers.list({ email: BOOKING.passenger.email, limit: 1 });
  const customer = customers.data[0];

  if (!customer) {
    console.log('Aucun client de démonstration : rien à nettoyer.\n');
    return;
  }
  console.log(`Client ${customer.id}`);

  // On liste par client plutôt que par recherche sur métadonnée : la recherche
  // met jusqu'à une minute à s'indexer et manquerait la répétition qui vient
  // de se terminer. Chaque réservation ayant désormais son propre PNR, on
  // archive tout ce qui n'est pas déjà archivé plutôt que de filtrer sur une
  // référence figée.
  const intents = [];
  for await (const pi of stripe.paymentIntents.list({ customer: customer.id, limit: 100 })) {
    if (pi.metadata && pi.metadata.booking_reference && pi.metadata.booking_reference !== ARCHIVE) {
      intents.push(pi);
    }
  }
  console.log(`${intents.length} intention(s) sur le dossier\n`);

  let archived = 0;
  let canceled = 0;
  for (const pi of intents) {
    // Une intention ouverte est d'abord annulée : elle ne doit pas rester
    // confirmable après la remise à zéro.
    if (['requires_payment_method', 'requires_confirmation', 'requires_action'].includes(pi.status)) {
      try {
        await stripe.paymentIntents.cancel(pi.id);
        canceled += 1;
      } catch (err) {
        console.log(`  ⚠ ${pi.id} non annulable — ${err.message}`);
      }
    }

    try {
      await stripe.paymentIntents.update(pi.id, {
        metadata: {
          booking_reference: ARCHIVE,
          archived_from: pi.metadata.booking_reference,
          archived_payment_intent: pi.id,
        },
      });
      archived += 1;
    } catch (err) {
      console.log(`  ⚠ ${pi.id} non archivable — ${err.message}`);
    }
  }
  console.log(`${canceled} annulée(s), ${archived} archivée(s) vers ${ARCHIVE}`);

  const methods = await stripe.paymentMethods.list({ customer: customer.id, type: 'card', limit: 20 });
  for (const pm of methods.data) await stripe.paymentMethods.detach(pm.id);
  console.log(`${methods.data.length} carte(s) détachée(s)\n`);

  console.log(
    'Le dossier est vierge. Relancez le serveur pour vider le magasin en mémoire,\n' +
      'puis rejouez le parcours à partir de /paiement.\n' +
      'Attention : la recherche par PNR peut encore renvoyer les anciennes lignes\n' +
      'pendant une minute, le temps que l’index se mette à jour.\n'
  );
})().catch((err) => {
  console.error('\n✗ Échec :', err.message, '\n');
  process.exit(1);
});
