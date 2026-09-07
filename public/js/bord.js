/* Terminal du chef de bord — génère une session de paiement propre au dossier
   et l'affiche en QR code. Le QR est produit côté serveur en SVG : rien ne
   dépend du réseau au moment de le projeter. */

(async () => {
  const banner = VELVET.el('banner');
  let poll = null;
  let sessionId = null;
  let pnr = null;

  /* Le sélecteur de dossier. Une liste native ne montre ni le PNR en machine
     ni le trajet en capitales : on la redessine, avec le clavier au complet
     (flèches, Entrée, Échap) et un dossier courant marqué d'un filet rose. */
  const picker = (() => {
    const root = VELVET.el('voyage-picker');
    const trigger = VELVET.el('voyage-trigger');
    const value = VELVET.el('voyage-value');
    const list = VELVET.el('voyage-list');

    let items = [];
    let active = -1;
    let onChange = () => {};

    const isOpen = () => !list.hidden;

    function line(d) {
      return `
        <span class="picker__pnr">${d.pnr}</span>
        <span class="picker__route">${d.route}</span>
        <span class="picker__meta">${VELVET.longDate(d.travelDate)} · ${d.departure}</span>`;
    }

    function setActive(i) {
      const options = [...list.children];
      if (!options.length) return;
      active = (i + options.length) % options.length;
      options.forEach((li, n) => li.classList.toggle('is-active', n === active));
      const current = options[active];
      trigger.setAttribute('aria-activedescendant', current.id);
      current.scrollIntoView({ block: 'nearest' });
    }

    function open() {
      if (!items.length) return;
      list.hidden = false;
      root.classList.add('is-open');
      trigger.setAttribute('aria-expanded', 'true');
      setActive(Math.max(0, items.findIndex((d) => d.pnr === pnr)));
    }

    function close() {
      list.hidden = true;
      root.classList.remove('is-open');
      trigger.setAttribute('aria-expanded', 'false');
      trigger.removeAttribute('aria-activedescendant');
      active = -1;
    }

    // Une sélection à l'identique ne relance pas le parcours : seul un vrai
    // changement de dossier remet l'écran à zéro.
    function select(nextPnr, { silent = false } = {}) {
      const d = items.find((x) => x.pnr === nextPnr);
      if (!d) return false;
      const changed = d.pnr !== pnr;
      pnr = d.pnr;
      value.innerHTML = line(d);
      [...list.children].forEach((li) =>
        li.setAttribute('aria-selected', String(li.dataset.pnr === pnr))
      );
      if (changed && !silent) onChange(d);
      return true;
    }

    function render(dossiers) {
      items = dossiers;
      if (!items.length) {
        list.innerHTML = '';
        list.hidden = true;
        value.textContent = 'Aucun dossier en mémoire';
        trigger.disabled = true;
        return;
      }
      trigger.disabled = false;
      list.innerHTML = items
        .map(
          (d, i) => `
        <li class="picker__option" id="voyage-opt-${i}" role="option"
            aria-selected="false" data-pnr="${d.pnr}">${line(d)}</li>`
        )
        .join('');
    }

    trigger.addEventListener('click', () => (isOpen() ? close() : open()));

    trigger.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!isOpen()) return open();
        setActive(active + (e.key === 'ArrowDown' ? 1 : -1));
        return;
      }
      if (e.key === 'Home' || e.key === 'End') {
        if (!isOpen()) return;
        e.preventDefault();
        setActive(e.key === 'Home' ? 0 : items.length - 1);
        return;
      }
      if (e.key === 'Enter' || e.key === ' ') {
        if (!isOpen()) return void (e.preventDefault(), open());
        e.preventDefault();
        const current = list.children[active];
        if (current) select(current.dataset.pnr);
        close();
        return;
      }
      if (e.key === 'Escape' && isOpen()) {
        e.preventDefault();
        close();
      }
    });

    list.addEventListener('click', (e) => {
      const li = e.target.closest('[data-pnr]');
      if (!li) return;
      select(li.dataset.pnr);
      close();
      trigger.focus();
    });

    list.addEventListener('mousemove', (e) => {
      const li = e.target.closest('[data-pnr]');
      if (li) setActive([...list.children].indexOf(li));
    });

    document.addEventListener('pointerdown', (e) => {
      if (isOpen() && !root.contains(e.target)) close();
    });
    trigger.addEventListener('blur', () => {
      // Le clic sur une option est traité avant le blur par pointerdown.
      requestAnimationFrame(() => { if (!root.contains(document.activeElement)) close(); });
    });

    return { render, select, has: (p) => items.some((d) => d.pnr === p), set onChange(fn) { onChange = fn; } };
  })();

  const { booking, onboard } = await VELVET.config();
  VELVET.el('label').textContent = onboard.label;
  VELVET.el('amount').textContent = VELVET.money(onboard.amount);

  // Reflète le dossier choisi dans l'en-tête, sans présumer qu'il s'agit
  // toujours du même train que le parcours canonique de la démonstration.
  function renderVoyage(dossier) {
    VELVET.el('train').textContent = dossier
      ? `${booking.trainNumber} · voiture ${booking.coach}`
      : '—';
    VELVET.el('pnr-badge').textContent = pnr || '—';
  }

  // La liste des dossiers en mémoire, du plus récent au plus ancien : le chef
  // de bord choisit explicitement le voyage à régulariser plutôt que de
  // dépendre d'un dossier présélectionné en silence.
  async function loadVoyages(preferredPnr) {
    const { dossiers } = await VELVET.get('/api/booking');
    picker.render(dossiers);
    if (!dossiers.length) {
      pnr = null;
      renderVoyage(null);
      return;
    }
    const wanted = dossiers.some((d) => d.pnr === preferredPnr) ? preferredPnr : dossiers[0].pnr;
    pnr = null;
    picker.select(wanted, { silent: true });
    renderVoyage(dossiers.find((d) => d.pnr === pnr));
  }

  picker.onChange = (dossier) => {
    renderVoyage(dossier);
    banner.hidden = true;
    VELVET.el('placeholder').hidden = false;
    VELVET.el('qr').hidden = true;
    VELVET.el('generate').textContent = 'Générer le code de paiement';
    VELVET.el('s-id').textContent = '—';
    VELVET.el('s-status').textContent = '—';
    VELVET.el('result').textContent = 'En attente du paiement du voyageur…';
    sessionId = null;
    if (poll) clearInterval(poll);
    poll = null;
  };

  await loadVoyages();

  function renderQr(data) {
    VELVET.el('placeholder').hidden = true;
    const qr = VELVET.el('qr');
    qr.innerHTML = data.qrSvg;
    qr.hidden = false;
    sessionId = data.sessionId;
    VELVET.el('s-id').textContent = data.sessionId;
    VELVET.el('s-status').textContent = 'ouverte';
    VELVET.el('generate').textContent = 'Régénérer le code';
    watch();
  }

  // Interrogation périodique : l'écran du contrôleur passe au vert dès que le
  // paiement est encaissé sur le téléphone du voyageur.
  function watch() {
    if (poll) clearInterval(poll);
    poll = setInterval(async () => {
      if (!sessionId) return;
      try {
        const s = await VELVET.get(`/api/bord/session/${sessionId}`);
        VELVET.el('s-status').textContent = `${s.status} · ${s.paymentStatus}`;
        if (s.paymentStatus === 'paid') {
          clearInterval(poll);
          poll = null;
          VELVET.el('result').innerHTML = `
            <p style="margin:0 0 .4rem"><strong>${VELVET.money(s.amountTotal)} encaissés</strong></p>
            <p class="mono micro" style="margin:0;word-break:break-all">${s.paymentIntentId}</p>
            <p class="mono micro" style="margin:.3rem 0 0">booking_reference : ${s.bookingReference || '—'}</p>`;
          VELVET.banner(banner, `Régularisation encaissée sur le dossier ${s.bookingReference || pnr}.`, 'ok');
        } else if (s.status === 'expired') {
          clearInterval(poll);
          poll = null;
          VELVET.banner(banner, 'Session expirée — régénérez un code.', 'error');
        }
      } catch {
        /* on ignore un aléa réseau : la prochaine itération réessaie */
      }
    }, 2500);
  }

  VELVET.el('generate').addEventListener('click', async () => {
    banner.hidden = true;
    const btn = VELVET.el('generate');
    btn.disabled = true;
    try {
      renderQr(await VELVET.post('/api/bord/session', { pnr }));
    } catch (err) {
      VELVET.banner(banner, err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  });

  // Reprise d'une session déjà ouverte si l'écran est rechargé : on resélectionne
  // le voyage de cette session plutôt que de revenir au dossier le plus récent.
  try {
    const last = await VELVET.get('/api/bord/last');
    if (picker.has(last.pnr)) {
      picker.select(last.pnr, { silent: true });
      renderVoyage({ pnr });
    }
    renderQr(last);
  } catch {
    /* aucune session en cours : état initial */
  }
})();
