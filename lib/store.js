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

function all() {
  return Array.from(bookings.values());
}

// Le dossier le plus récent : sert de dossier « courant » aux écrans qui
// n'ont pas reçu de PNR explicite (terminal à bord, régularisation).
function mostRecent() {
  const list = all().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return list[0] || null;
}

module.exports = { get, upsert, addPayment, all, mostRecent };
