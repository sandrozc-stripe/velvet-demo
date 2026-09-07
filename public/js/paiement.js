/* Écran de paiement — le cœur de la démonstration.
   Une seule session Checkout porte la réservation : le refus, la reprise et
   l'authentification 3-D Secure se déroulent tous dans ce même dossier. */

(async () => {
  const banner = VELVET.el('banner');
  const status = VELVET.el('status');
  const submit = VELVET.el('submit');
  const submitLabel = VELVET.el('submit-label');

  // Garde-fou de répétition : au-delà de trois confirmations sur une même
  // session, on recharge la page pour repartir d'une session neuve.
  const MAX_TENTATIVES = 3;
  let tentatives = 0;

  function setStatus(text, spinning) {
    status.innerHTML = spinning ? `<span class="spinner"></span><span>${text}</span>` : text || '';
  }

  try {
    const { publishableKey, booking } = await VELVET.config();
    const tripType = new URLSearchParams(location.search).get('tripType') || 'aller_simple';

    VELVET.el('from').textContent = booking.origin;
    VELVET.el('to').textContent = booking.destination;
    VELVET.el('departure').textContent = booking.departure;
    VELVET.el('arrival').textContent = booking.arrival;
    VELVET.el('travel-date').textContent = VELVET.longDate(booking.travelDate);
    VELVET.el('passenger').textContent = booking.passenger.name;

    // Chaque chargement crée une session neuve, sur un PNR neuf : indispensable
    // pour enchaîner les répétitions sans réutiliser une session déjà réglée,
    // et pour que le Dashboard filtré sur ce PNR ne montre que ce dossier.
    const session = await VELVET.post('/api/booking', { tripType });

    VELVET.el('fare').textContent = session.fareLabel;
    VELVET.el('pnr-badge').textContent = session.pnr;
    VELVET.el('cs-id').textContent = session.checkoutSessionId;

    const metaList = VELVET.el('meta-list');
    const shown = [
      ['booking_reference', session.pnr],
      ['sqills_order_id', booking.sqillsOrderId],
      ['route', booking.route],
      ['travel_date', booking.travelDate],
      ['booking_channel', 'web'],
      ['fare_type', booking.fareType],
      ['passenger_segment', booking.passengerSegment],
    ];
    metaList.innerHTML = shown
      .map(([k, v]) => `<dt class="mono">${k}</dt><dd class="mono">${v}</dd>`)
      .join('');

    const stripe = Stripe(publishableKey, {
      locale: 'fr',
      developerTools: { assistant: { enabled: true } },
    });

    // C'est le client_secret de la session Checkout qui initialise Checkout
    // lui-même, plus une instance Elements : le montant, le client et les
    // moyens de paiement viennent de la session, pas d'options côté navigateur.
    // La carte enregistrée de Camille réapparaît parce que la session porte un
    // `customer` — il n'y a plus de CustomerSession à créer pour cela.
    const checkout = stripe.initCheckoutElementsSdk({
      clientSecret: session.clientSecret,
      elementsOptions: {
        appearance: VELVET.appearance,
        fonts: await VELVET.fonts(),
        loader: 'auto',
        savedPaymentMethod: { enableRedisplay: 'auto', enableSave: 'never' },
      },
      defaultValues: { billingAddress: { name: booking.passenger.name } },
    });

    const paymentElement = checkout.createPaymentElement({
      layout: { type: 'accordion', radios: 'always', spacedAccordionItems: false },
      terms: { card: 'never' },
      wallets: { applePay: 'auto', googlePay: 'auto' },
    });
    paymentElement.mount('#payment-element');

    paymentElement.on('loaderror', (e) => {
      VELVET.banner(banner, `Formulaire indisponible : ${e.error && e.error.message}`, 'error');
    });

    const loaded = await checkout.loadActions();
    if (loaded.type === 'error') throw new Error(loaded.error.message);
    const actions = loaded.actions;

    // Le montant affiché est lu sur la session, pas recalculé côté navigateur :
    // c'est ce que `confirm` exige, et c'est ce qui ferait suivre l'écran sans
    // retouche si une remise ou une conversion de devise s'ajoutait un jour.
    function renderTotal(checkoutSession) {
      VELVET.el('total').textContent = checkoutSession.total.total.amount;
      submitLabel.textContent = `Payer ${checkoutSession.total.total.amount}`;
      submit.disabled = !checkoutSession.canConfirm;
    }
    renderTotal(actions.getSession());

    // `canConfirm` remplace l'événement « ready » du Payment Element : le
    // bouton s'active quand la session a de quoi être confirmée.
    checkout.on('change', (updated) => {
      renderTotal(updated);
      if (updated.canConfirm) setStatus('');
    });

    VELVET.el('payment-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      if (submit.disabled) return;

      if (tentatives >= MAX_TENTATIVES) {
        VELVET.banner(banner, 'Trop de tentatives sur ce dossier — rechargement.', 'info');
        return setTimeout(() => location.reload(), 800);
      }
      tentatives += 1;

      submit.disabled = true;
      banner.hidden = true;
      setStatus('Autorisation en cours…', true);

      // redirect: 'if_required' garde le défi 3-D Secure dans une fenêtre
      // modale : le voyageur ne quitte pas velvet.fr.
      const result = await actions.confirm({ redirect: 'if_required' });

      if (result.type === 'error') {
        // La session reste `open` : la même instance Checkout et le même
        // client_secret restent valides. On ne remonte rien, on ne recrée
        // aucune session.
        VELVET.banner(banner, result.error.message || 'Le paiement n’a pas abouti.', 'error');
        setStatus(
          `Dossier ${session.pnr} conservé · session ${session.checkoutSessionId} inchangée`,
          false
        );
        submit.disabled = false;
        return;
      }

      const confirmed = actions.getSession();
      if (confirmed.status.type === 'complete') {
        setStatus('Paiement autorisé — édition du billet…', true);
        const params = new URLSearchParams({ checkout_session: session.checkoutSessionId });
        return void (location.href = `/confirmation?${params}`);
      }

      setStatus(`Statut : ${confirmed.status.type}`, false);
      submit.disabled = false;
    });
  } catch (err) {
    VELVET.banner(banner, err.message, 'error');
    setStatus('');
  }
})();
