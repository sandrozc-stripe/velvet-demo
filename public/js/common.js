/* Velvet — utilitaires partagés par tous les écrans. Aucun framework :
   ce qui est projeté doit démarrer sans build et sans réseau tiers. */

const VELVET = (() => {
  const euro = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });

  function money(cents, currency = 'EUR') {
    if (cents === null || cents === undefined) return '—';
    if (currency.toUpperCase() !== 'EUR') {
      return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: currency.toUpperCase() })
        .format(cents / 100);
    }
    return euro.format(cents / 100);
  }

  function clock(unixOrMs) {
    const ms = unixOrMs > 1e12 ? unixOrMs : unixOrMs * 1000;
    return new Date(ms).toLocaleTimeString('fr-FR', { hour12: false });
  }

  function longDate(iso) {
    const d = new Date(`${iso}T00:00:00`);
    return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }

  // Les polices Velvet sont injectées dans l'iframe Stripe : le formulaire de
  // paiement doit être typographiquement indiscernable du reste du site.
  //
  // Stripe.js rejette toute source de police servie en http://, ce qui est le
  // cas sur localhost. On passe donc la woff2 en data: URI. Si la police n'est
  // pas récupérable, on renvoie une liste vide : le formulaire s'affiche avec
  // la police système plutôt que de ne pas s'afficher du tout.
  let fontsPromise = null;
  function fonts() {
    if (!fontsPromise) {
      fontsPromise = fetch('/api/font')
        .then((r) => (r.ok ? r.text() : Promise.reject(new Error('police indisponible'))))
        .then((b64) => {
          const src = `url(data:font/woff2;charset=utf-8;base64,${b64})`;
          return [
            { family: 'Work Sans', src, weight: '400' },
            { family: 'Work Sans', src, weight: '600' },
          ];
        })
        .catch(() => []);
    }
    return fontsPromise;
  }

  // Reprise exacte des jetons de velvet.fr : vert #003E40, rose #EFAAFE,
  // angles droits, aucune ombre. C'est ce qui rend l'argument « le paiement
  // reste dans l'expérience Velvet » visible plutôt que verbal.
  const appearance = {
    theme: 'stripe',
    variables: {
      colorPrimary: '#003E40',
      colorBackground: '#FFFFFF',
      colorText: '#003E40',
      colorTextSecondary: 'rgba(0,62,64,0.65)',
      colorTextPlaceholder: 'rgba(0,62,64,0.42)',
      colorDanger: '#D95667',
      colorIcon: '#003E40',
      fontFamily: '"Work Sans", -apple-system, sans-serif',
      fontSizeBase: '17px',
      borderRadius: '0px',
      spacingUnit: '5px',
      focusBoxShadow: 'none',
      focusOutline: '2px solid #EFAAFE',
    },
    rules: {
      '.Input': {
        border: '1px solid rgba(0,62,64,0.35)',
        boxShadow: 'none',
        padding: '14px 15px',
        transition: 'border-color .2s ease',
      },
      '.Input:hover': { border: '1px solid rgba(0,62,64,0.6)' },
      '.Input:focus': { border: '1px solid #003E40', boxShadow: 'none', outline: '2px solid #EFAAFE' },
      '.Input--invalid': { border: '1px solid #D95667', boxShadow: 'none' },
      '.Label': {
        fontWeight: '600',
        fontSize: '13px',
        textTransform: 'uppercase',
        letterSpacing: '0.12em',
        color: 'rgba(0,62,64,0.6)',
      },
      '.Tab': { border: '1px solid rgba(0,62,64,0.35)', boxShadow: 'none', borderRadius: '0' },
      '.Tab--selected': { border: '1px solid #003E40', backgroundColor: '#EFAAFE', color: '#003E40', boxShadow: 'none' },
      '.Tab:hover': { boxShadow: 'none', backgroundColor: '#F0EBE1' },
      '.TabLabel': { fontWeight: '600', letterSpacing: '0.04em' },
      '.Block': { border: '1px solid rgba(0,62,64,0.18)', boxShadow: 'none', borderRadius: '0' },
      // Le poste sélectionné porte la même barre rose que le dossier courant.
      '.AccordionItem': {
        border: '1px solid rgba(0,62,64,0.22)',
        boxShadow: 'none',
        borderRadius: '0',
        transition: 'border-color .2s ease',
      },
      '.AccordionItem:hover': { border: '1px solid rgba(0,62,64,0.45)', backgroundColor: '#FFFFFF' },
      '.AccordionItem--selected': { border: '1px solid #003E40', borderLeft: '5px solid #EFAAFE' },
      '.CheckboxInput': { borderRadius: '0', boxShadow: 'none' },
      '.CheckboxInput--checked': { backgroundColor: '#003E40' },
      '.RadioIconOuter': { stroke: 'rgba(0,62,64,0.5)' },
      '.RadioIconInner': { fill: '#003E40' },
      '.Error': { fontSize: '14px', fontWeight: '500' },
    },
  };

  let configPromise = null;
  function config() {
    if (!configPromise) configPromise = fetch('/api/config').then((r) => r.json());
    return configPromise;
  }

  async function post(url, body) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Échec de l’appel ${url}`);
    return data;
  }

  async function get(url) {
    const res = await fetch(url);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Échec de l’appel ${url}`);
    return data;
  }

  function el(id) {
    return document.getElementById(id);
  }

  // Rend la navigation identique sur les six écrans et marque la page courante.
  function nav() {
    const here = location.pathname.replace(/\.html$/, '') || '/';
    document.querySelectorAll('.topbar__nav a').forEach((a) => {
      const target = a.getAttribute('href').replace(/\.html$/, '');
      if (target === here) a.setAttribute('aria-current', 'page');
    });
  }

  function banner(node, message, kind = 'error') {
    if (!node) return;
    node.textContent = message;
    node.className = kind === 'error' ? 'alert' : kind === 'ok' ? 'alert alert--ok' : 'alert alert--info';
    node.hidden = !message;
    if (message) node.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  // Apparition au défilement. Un seul observateur pour toute la page, et rien
  // qui bouge si le système demande de réduire les animations.
  function reveals() {
    const nodes = document.querySelectorAll('[data-reveal]');
    if (!nodes.length) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      nodes.forEach((n) => n.classList.add('is-in'));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('is-in');
          io.unobserve(entry.target);
        });
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.08 }
    );
    nodes.forEach((n, i) => {
      // L'index sert de retard en cascade au sein d'un même groupe.
      if (!n.style.getPropertyValue('--i')) n.style.setProperty('--i', String(i % 4));
      io.observe(n);
    });
  }

  // Les animations d'entrée attendent que la page soit peinte : sinon la
  // première image projetée montre le texte déjà en place.
  function start() {
    nav();
    requestAnimationFrame(() => {
      document.body.classList.add('is-loaded');
      // Les transitions ne sont armées qu'avec « is-loaded » : on n'observe
      // qu'après, sinon les blocs déjà visibles apparaissent d'un coup.
      requestAnimationFrame(reveals);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();

  return { money, clock, longDate, appearance, fonts, config, post, get, el, banner, reveals };
})();
