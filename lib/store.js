'use strict';

// Tient lieu de « système de réservation » pour la démonstration : ce que
// Sqills détiendrait en production. En mémoire volontairement — un redémarrage
// remet la démonstration à zéro, ce qui est le comportement souhaité.
const bookings = new Map(); // pnr -> dossier

function get(pnr) {
  return bookings.get(pnr) || null;
}

function upsert(pnr, patch) {
  const current = bookings.get(pnr) || { pnr, createdAt: Date.now(), payments: [] };
  const next = { ...current, ...patch, pnr, updatedAt: Date.now() };
  bookings.set(pnr, next);
  return next;
}

function addPayment(pnr, payment) {
  const current = bookings.get(pnr) || { pnr, createdAt: Date.now(), payments: [] };
  const payments = current.payments.filter((p) => p.paymentIntent !== payment.paymentIntent);
  payments.push(payment);
  const next = { ...current, pnr, payments, updatedAt: Date.now() };
  bookings.set(pnr, next);
  return next;
}

// Rattache une session Checkout réglée au dossier qu'elle porte. Le
// PaymentIntent n'existe qu'à partir de la confirmation : c'est le seul moment
// où le dossier peut connaître l'identifiant du paiement, et c'est lui que
// l'annulation depuis l'espace voyageur remboursera.
//
// Les prestations complémentaires (`ancillary_type`) sont exclues : leur
// paiement ne doit pas remplacer celui du billet dans le dossier.
function linkCheckoutSession(session) {
  const metadata = session.metadata || {};
  const pnr = metadata.booking_reference;
  if (!pnr) return null;

  const paymentIntentId =
    typeof session.payment_intent === 'string'
      ? session.payment_intent
      : session.payment_intent && session.payment_intent.id;
  if (!paymentIntentId || metadata.ancillary_type) return get(pnr);

  const current = get(pnr);
  if (current && current.paymentIntentId === paymentIntentId) return current;
  return upsert(pnr, { checkoutSessionId: session.id, paymentIntentId });
}

function all() {
  return Array.from(bookings.values());
}

// Le dossier le plus récent : sert de dossier « courant » aux écrans qui
// n'ont pas reçu de PNR explicite (terminal à bord, régularisation).
function mostRecent() {
  const list = all().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return list[0] || null;
}

module.exports = { get, upsert, addPayment, linkCheckoutSession, all, mostRecent };
