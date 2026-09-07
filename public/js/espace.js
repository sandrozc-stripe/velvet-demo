/* Espace voyageur — les prestations complémentaires se règlent sans quitter
   la page : un Payment Element est monté directement dans la carte, exactement
   comme sur l'écran Paiement. Camille y retrouve sa carte enregistrée
   proposée d'emblée, mais peut tout aussi bien en choisir une autre ou en
   saisir une nouvelle — ou régler en un clic avec un portefeuille
   (Apple Pay, Google Pay, Link, PayPal) via l'Express Checkout Element. */

(async () => {
  const banner = VELVET.el('banner');
  const status = VELVET.el('status');

  function setStatus(text, spinning) {
    status.innerHTML = spinning ? `<span class="spinner"></span><span>${text}</span>` : text || '';
  }

  function statusLabel(status) {
    return status === 'annulee' ? 'Annulée et remboursée' : 'Confirmée';
  }

  // PNR dont l'annulation est en cours de confirmation dans la carte, pas via
  // une boîte de dialogue du navigateur : un seul dossier à la fois.
  let pendingCancel = null;

  // Le dossier sur lequel portent le badge PNR et le panneau « Dossier » : on
  // clique un voyage pour le rendre courant avant de pouvoir l'annuler, plutôt
  // que d'agir en permanence sur le plus récent des dossiers de Camille.
  let selectedPnr = null;

  function updateHeader(data) {
    const active = data.bookings.find((b) => b.pnr === selectedPnr) || data.bookings[0] || null;
    VELVET.el('pnr-badge').textContent = active ? active.pnr : '—';
  }

  function bookingRow(b) {
    const cancelled = b.status === 'annulee';
    const selected = b.pnr === selectedPnr;
    const confirming = !cancelled && b.pnr === pendingCancel;
    return `
      <div class="card ${cancelled ? 'card--flat' : 'card--selectable'} ${selected ? 'card--on' : ''}" data-pnr="${b.pnr}">
        <div class="between between--top">
          <div class="between__grow">
            <p class="eyebrow"><span class="mono">${b.pnr}</span> · ${b.fareLabel}</p>
            <h3 class="display" style="font-size:1.35rem;margin:.25rem 0 .35rem">${b.route}</h3>
            <p class="small muted flush">${VELVET.longDate(b.travelDate)} — départ ${b.departure}</p>
          </div>
          <div class="between__aside">
            <p class="amount-row flush nowrap">${VELVET.money(b.amount)}</p>
            <span class="tag ${cancelled ? '' : 'tag--green'}" style="margin-top:.45rem">${statusLabel(b.status)}</span>
          </div>
        </div>
        ${
          cancelled
            ? ''
            : confirming
            ? `<div class="alert alert--info" style="margin-top:var(--sp-2)">
                <p style="margin:0 0 .5rem">Annuler et rembourser ${VELVET.money(b.amount)} sur la réservation ${b.pnr} ?</p>
                <div class="row">
                  <button class="btn btn--small" type="button" data-confirm-cancel="${b.pnr}">Confirmer l’annulation</button>
                  <button class="btn btn--ghost btn--small" type="button" data-abort-cancel="${b.pnr}">Non, garder</button>
                </div>
              </div>`
            : selected
            ? `<button class="btn btn--ghost btn--small" type="button" data-cancel="${b.pnr}" style="margin-top:var(--sp-3)">Annuler et rembourser</button>`
            : `<p class="micro" style="margin:var(--sp-3) 0 0;font-weight:600;letter-spacing:.06em;text-transform:uppercase">Sélectionner ce voyage →</p>`
        }
      </div>`;
  }

  function renderBookings(data) {
    VELVET.el('bookings').innerHTML = data.bookings.length
      ? data.bookings.map(bookingRow).join('')
      : '<p class="small muted" style="margin:0">Aucune réservation.</p>';
  }

  let latestBookings = null;

  try {
    const data = await VELVET.get('/api/espace');
    latestBookings = data;
    const mostRecent = data.bookings[0];
    selectedPnr = mostRecent ? mostRecent.pnr : null;

    VELVET.el('hello').textContent = `Bonjour ${data.customer.name.split(' ')[0]}`;
    VELVET.el('initials').textContent = data.customer.name
      .split(' ')
      .map((part) => part[0])
      .join('')
      .slice(0, 2)
      .toUpperCase();
    VELVET.el('loyalty').textContent = data.customer.loyaltyId
      ? `Programme Velvet — ${data.customer.loyaltyId}`
      : data.customer.email;
    updateHeader(data);

    renderBookings(data);

    VELVET.el('bookings').addEventListener('click', async (e) => {
      const askBtn = e.target.closest('[data-cancel]');
      if (askBtn) {
        pendingCancel = askBtn.dataset.cancel;
        renderBookings(latestBookings);
        return;
      }

      const abortBtn = e.target.closest('[data-abort-cancel]');
      if (abortBtn) {
        pendingCancel = null;
        renderBookings(latestBookings);
        return;
      }

      const confirmBtn = e.target.closest('[data-confirm-cancel]');
      if (confirmBtn) {
        const pnr = confirmBtn.dataset.confirmCancel;
        confirmBtn.disabled = true;
        banner.hidden = true;
        try {
          const r = await VELVET.post('/api/espace/cancel', { pnr });
          pendingCancel = null;
          VELVET.banner(banner, `Réservation ${pnr} annulée — ${VELVET.money(r.amount)} remboursés.`, 'ok');
          latestBookings = await VELVET.get('/api/espace');
          updateHeader(latestBookings);
          renderBookings(latestBookings);
        } catch (err) {
          VELVET.banner(banner, err.message, 'error');
          confirmBtn.disabled = false;
        }
        return;
      }

      // Sélectionner un dossier différent : le badge PNR et le panneau
      // « Dossier » suivent le voyage cliqué, et seul ce voyage devient
      // annulable — pas de bouton d'action flottant sur tous les voyages.
      const card = e.target.closest('[data-pnr]');
      if (!card || card.dataset.pnr === selectedPnr) return;
      selectedPnr = card.dataset.pnr;
      pendingCancel = null;
      updateHeader(latestBookings);
      renderBookings(latestBookings);
    });

    // Les prestations complémentaires vendues depuis l'espace, réglées avec
    // un Payment Element monté sur place : la sélection de carte enregistrée
    // ou nouvelle se fait dans ce même Payment Element, pas via une redirection.
    const ancillaryButtons = VELVET.el('ancillaries');
    const ancillaryForm = VELVET.el('ancillary-form');
    const ancillaryExpress = VELVET.el('ancillary-express');
    const ancillarySummary = VELVET.el('ancillary-summary');
    const ancillarySubmit = VELVET.el('ancillary-submit');
    const ancillarySubmitLabel = VELVET.el('ancillary-submit-label');
    const ancillaryCancel = VELVET.el('ancillary-cancel');

    const { publishableKey } = await VELVET.config();
    const stripe = Stripe(publishableKey, {
      locale: 'fr',
      developerTools: { assistant: { enabled: true } },
    });
    let ancillaryElements = null;
    let ancillarySession = null;
    let ancillarySubmitting = false;

    function resetAncillaryForm() {
      ancillaryElements = null;
      ancillarySession = null;
      ancillarySubmitting = false;
      ancillaryForm.hidden = true;
      ancillaryForm.reset();
      VELVET.el('ancillary-payment-element').innerHTML = '';
      VELVET.el('ancillary-express-element').innerHTML = '';
      ancillaryExpress.hidden = true;
      ancillaryButtons.hidden = false;
    }

    // Une seule confirmation pour les deux chemins : le bouton « Payer » du
    // Payment Element et les boutons en un clic de l'Express Checkout Element
    // règlent le même PaymentIntent, sur la même instance elements.
    function beginConfirmation() {
      if (ancillarySubmitting || !ancillaryElements || !ancillarySession) return false;
      ancillarySubmitting = true;
      ancillarySubmit.disabled = true;
      banner.hidden = true;
      setStatus('Autorisation en cours…', true);
      return true;
    }

    async function confirmAncillary() {
      // redirect: 'if_required' garde le défi 3-D Secure dans une fenêtre
      // modale : Camille ne quitte pas l'espace voyageur.
      const { error, paymentIntent } = await stripe.confirmPayment({
        elements: ancillaryElements,
        confirmParams: { return_url: ancillarySession.returnUrl },
        redirect: 'if_required',
      });

      if (error) {
        VELVET.banner(banner, error.message || 'Le paiement n’a pas abouti.', 'error');
        setStatus('');
        ancillarySubmit.disabled = false;
        ancillarySubmitting = false;
        return;
      }

      if (paymentIntent && paymentIntent.status === 'succeeded') {
        setStatus('Paiement autorisé…', true);
        const params = new URLSearchParams({
          payment_intent: paymentIntent.id,
          payment_intent_client_secret: paymentIntent.client_secret || '',
        });
        return void (location.href = `/confirmation?${params}`);
      }

      setStatus(`Statut : ${paymentIntent ? paymentIntent.status : 'inconnu'}`, false);
      ancillarySubmit.disabled = false;
      ancillarySubmitting = false;
    }

    ancillaryButtons.innerHTML = data.ancillaries
      .map(
        (a) => `
      <button class="option" type="button" data-ancillary="${a.key}">
        <span class="option__label">${a.label}</span>
        <span class="option__price">${VELVET.money(a.amount)}</span>
        <span class="option__arrow" aria-hidden="true">→</span>
      </button>`
      )
      .join('');

    ancillaryButtons.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-ancillary]');
      if (!btn) return;
      banner.hidden = true;
      btn.disabled = true;
      setStatus('Préparation du paiement…', true);
      try {
        ancillarySession = await VELVET.post('/api/espace/charge', { ancillary: btn.dataset.ancillary, pnr: selectedPnr });
        ancillarySummary.textContent = `${ancillarySession.label} — ${VELVET.money(ancillarySession.amount)}, dossier ${ancillarySession.pnr}`;
        ancillarySubmitLabel.textContent = `Payer ${VELVET.money(ancillarySession.amount)}`;

        ancillaryElements = stripe.elements({
          clientSecret: ancillarySession.clientSecret,
          customerSessionClientSecret: ancillarySession.customerSessionClientSecret,
          appearance: VELVET.appearance,
          fonts: await VELVET.fonts(),
          loader: 'auto',
        });
        // Boutons en un clic — Apple Pay, Google Pay, Link, PayPal — montés
        // sur la même instance elements que le Payment Element : un seul
        // PaymentIntent, deux manières de le régler. Le bloc reste masqué
        // jusqu'à ce que Stripe annonce au moins un portefeuille disponible
        // sur l'appareil de Camille, pour ne pas laisser un vide dans la carte.
        const expressElement = ancillaryElements.create('expressCheckout', {
          buttonHeight: 48,
          buttonType: { applePay: 'buy', googlePay: 'buy', paypal: 'buynow', klarna: 'pay' },
          paymentMethodOrder: ['apple_pay', 'google_pay', 'link', 'paypal'],
          // La carte latérale est étroite : on empile les boutons plutôt que
          // d'en cacher derrière un menu « Afficher plus ».
          layout: { maxColumns: 1, maxRows: 0, overflow: 'never' },
        });
        expressElement.mount('#ancillary-express-element');

        expressElement.on('availablepaymentmethodschange', ({ paymentMethods }) => {
          ancillaryExpress.hidden = !paymentMethods;
        });

        // La feuille du portefeuille rend un moyen de paiement déjà complet :
        // il n'y a rien à saisir, on confirme directement l'intention.
        expressElement.on('confirm', async () => {
          if (!beginConfirmation()) return;
          await confirmAncillary();
        });

        // Fermeture de la feuille du portefeuille sans payer : on revient à
        // l'état d'attente, le formulaire carte reste disponible.
        expressElement.on('cancel', () => {
          setStatus('');
          ancillarySubmit.disabled = false;
          ancillarySubmitting = false;
        });

        expressElement.on('loaderror', (err) => {
          ancillaryExpress.hidden = true;
          VELVET.banner(
            banner,
            `Paiement en un clic indisponible : ${err.error && err.error.message}`,
            'info'
          );
        });

        const paymentElement = ancillaryElements.create('payment', {
          layout: { type: 'accordion', defaultCollapsed: false, radios: true, spacedAccordionItems: false },
          terms: { card: 'never' },
          wallets: { applePay: 'auto', googlePay: 'auto' },
        });
        paymentElement.mount('#ancillary-payment-element');
        paymentElement.on('ready', () => {
          ancillarySubmit.disabled = false;
          setStatus('');
        });
        paymentElement.on('loaderror', (err) => {
          VELVET.banner(banner, `Formulaire indisponible : ${err.error && err.error.message}`, 'error');
        });

        ancillaryButtons.hidden = true;
        ancillaryForm.hidden = false;
      } catch (err) {
        VELVET.banner(banner, err.message, 'error');
        setStatus('');
        btn.disabled = false;
      }
    });

    ancillaryCancel.addEventListener('click', () => {
      banner.hidden = true;
      setStatus('');
      resetAncillaryForm();
      ancillaryButtons.querySelectorAll('[data-ancillary]').forEach((b) => (b.disabled = false));
    });

    ancillaryForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!beginConfirmation()) return;
      await confirmAncillary();
    });
  } catch (err) {
    VELVET.banner(banner, err.message, 'error');
    setStatus('');
  }
})();
