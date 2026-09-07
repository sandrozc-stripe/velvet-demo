/* Écran de paiement — le cœur de la démonstration.
   Un seul PaymentIntent porte la réservation : le refus, la reprise et
   l'authentification 3-D Secure se déroulent tous dans ce même dossier. */

(async () => {
  const banner = VELVET.el('banner');
  const status = VELVET.el('status');
  const submit = VELVET.el('submit');
  const submitLabel = VELVET.el('submit-label');

  // Garde-fou de répétition : au-delà de trois confirmations sur une même
  // intention, on recharge la page pour repartir d'une intention neuve.
  const MAX_TENTATIVES = 3;
  let tentatives = 0;
  let elements;
  let clientSecret;

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

    // Chaque chargement crée une intention neuve, sur un PNR neuf : indispensable
    // pour enchaîner les répétitions sans épuiser une intention déjà confirmée,
    // et pour que le Dashboard filtré sur ce PNR ne montre que ce dossier.
    const session = await VELVET.post('/api/booking', { tripType });
    clientSecret = session.clientSecret;

    VELVET.el('fare').textContent = session.fareLabel;
    VELVET.el('total').textContent = VELVET.money(session.amount);
    submitLabel.textContent = `Payer ${VELVET.money(session.amount)}`;

    VELVET.el('pnr-badge').textContent = session.pnr;
    VELVET.el('pi-id').textContent = session.paymentIntentId;

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

    // customerSessionClientSecret est ce qui fait apparaître la case
    // « enregistrer ce moyen de paiement » : le consentement est géré par
    // Stripe, pas par une case maison.
    elements = stripe.elements({
      clientSecret,
      customerSessionClientSecret: session.customerSessionClientSecret,
      appearance: VELVET.appearance,
      fonts: await VELVET.fonts(),
      loader: 'auto',
    });

    const paymentElement = elements.create('payment', {
      layout: { type: 'accordion', defaultCollapsed: false, radios: true, spacedAccordionItems: false },
      defaultValues: { billingDetails: { name: booking.passenger.name, email: booking.passenger.email } },
      terms: { card: 'never' },
      wallets: { applePay: 'auto', googlePay: 'auto' },
    });
    paymentElement.mount('#payment-element');

    paymentElement.on('ready', () => {
      submit.disabled = false;
      setStatus('');
    });

    paymentElement.on('loaderror', (e) => {
      VELVET.banner(banner, `Formulaire indisponible : ${e.error && e.error.message}`, 'error');
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
      const { error, paymentIntent } = await stripe.confirmPayment({
        elements,
        confirmParams: { return_url: session.returnUrl },
        redirect: 'if_required',
      });

      if (error) {
        // Le PaymentIntent revient à requires_payment_method : la même
        // instance elements et le même client_secret restent valides. On ne
        // remonte rien, on ne recrée aucune intention.
        VELVET.banner(banner, error.message || 'Le paiement n’a pas abouti.', 'error');
        setStatus(
          `Dossier ${session.pnr} conservé · intention ${session.paymentIntentId} inchangée`,
          false
        );
        submit.disabled = false;
        return;
      }

      if (paymentIntent && paymentIntent.status === 'succeeded') {
        setStatus('Paiement autorisé — édition du billet…', true);
        const params = new URLSearchParams({
          payment_intent: paymentIntent.id,
          payment_intent_client_secret: paymentIntent.client_secret || '',
        });
        return void (location.href = `/confirmation?${params}`);
      }

      setStatus(`Statut : ${paymentIntent ? paymentIntent.status : 'inconnu'}`, false);
      submit.disabled = false;
    });
  } catch (err) {
    VELVET.banner(banner, err.message, 'error');
    setStatus('');
  }
})();
