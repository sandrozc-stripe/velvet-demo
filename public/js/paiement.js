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
    const params = new URLSearchParams(location.search);
    const tripType = params.get('tripType') || 'aller_simple';

    // Adaptive Pricing se règle à la création de la session Checkout : le
    // basculement passe donc par l'URL, comme le type de trajet, et l'écran
    // repart d'une session neuve. Cela garde aussi le garde-fou de répétition
    // cohérent — le `location.reload()` plus bas conserve la chaîne de requête,
    // donc le réglage affiché survit au rechargement.
    const adaptivePricing = params.get('adaptive') === '1';

    // L'interrupteur est câblé avant la création de la session : si l'API refuse,
    // le présentateur doit pouvoir rebasculer sans réécrire l'URL à la main.
    const adaptiveToggle = VELVET.el('adaptive-toggle');
    adaptiveToggle.classList.toggle('is-on', adaptivePricing);
    adaptiveToggle.setAttribute('aria-checked', String(adaptivePricing));
    adaptiveToggle.addEventListener('click', () => {
      const next = new URLSearchParams({ tripType });
      if (!adaptivePricing) next.set('adaptive', '1');
      location.href = `/paiement?${next}`;
    });

    VELVET.el('from').textContent = booking.origin;
    VELVET.el('to').textContent = booking.destination;
    VELVET.el('departure').textContent = booking.departure;
    VELVET.el('arrival').textContent = booking.arrival;
    VELVET.el('travel-date').textContent = VELVET.longDate(booking.travelDate);
    VELVET.el('passenger').textContent = booking.passenger.name;

    // Chaque chargement crée une session neuve, sur un PNR neuf : indispensable
    // pour enchaîner les répétitions sans réutiliser une session déjà réglée,
    // et pour que le Dashboard filtré sur ce PNR ne montre que ce dossier.
    const session = await VELVET.post('/api/booking', { tripType, adaptivePricing });

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
      // `adaptivePricing` est une option de premier niveau, aux côtés de
      // clientSecret — et non un réglage d'Elements. `allowed` ne décide de
      // rien : il déclare que cette intégration sait présenter une autre devise,
      // c'est-à-dire que tous les montants affichés sont lus sur la session et
      // que le Currency Selector Element est monté. Les deux sont vrais en
      // permanence ici, donc il reste toujours à true : seul
      // `adaptive_pricing.enabled` de la session varie, pour que le basculement
      // n'ait qu'une seule cause possible à l'écran.
      adaptivePricing: { allowed: true },
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

    // Obligatoire dès qu'Adaptive Pricing est autorisé : c'est ce composant qui
    // laisse le voyageur choisir entre sa devise et celle de Velvet, et Stripe
    // en fait une condition d'usage. Monté sans condition — sans
    // `currencyOptions`, il ne rend rien.
    checkout.createCurrencySelectorElement().mount('#currency-selector');

    paymentElement.on('loaderror', (e) => {
      VELVET.banner(banner, `Formulaire indisponible : ${e.error && e.error.message}`, 'error');
    });

    const loaded = await checkout.loadActions();
    if (loaded.type === 'error') throw new Error(loaded.error.message);
    const actions = loaded.actions;

    // Le montant affiché est lu sur la session, pas recalculé côté navigateur :
    // c'est ce que `confirm` exige, et c'est ce qui ferait suivre l'écran sans
    // retouche si une remise ou une conversion de devise s'ajoutait un jour.
    const currencySelector = VELVET.el('currency-selector');

    function renderTotal(checkoutSession) {
      VELVET.el('total').textContent = checkoutSession.total.total.amount;
      submitLabel.textContent = `Payer ${checkoutSession.total.total.amount}`;
      submit.disabled = !checkoutSession.canConfirm;

      // `currencyOptions` n'est renseigné que si Stripe a effectivement une
      // conversion à proposer. Vide, le sélecteur ne rend rien de visible mais
      // son iframe laisserait une gouttière morte dans la carte : on masque le
      // conteneur plutôt que de monter le composant sous condition.
      const options = checkoutSession.currencyOptions || [];
      currencySelector.hidden = options.length === 0;

      // L'interrupteur reflète ce que l'API a répondu, pas ce qui a été demandé :
      // si le compte refusait la conversion, il doit retomber en position
      // « arrêt » au lieu de mentir sur l'état de la session.
      adaptiveToggle.classList.toggle('is-on', session.adaptivePricing);
      adaptiveToggle.setAttribute('aria-checked', String(session.adaptivePricing));
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
