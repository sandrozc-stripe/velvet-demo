# Velvet — démonstration RFP PSP

Application de démonstration pour le comité de sélection Velvet. Six écrans, un seul
dossier de réservation, aucune étape de build.

> **Thèse à faire passer :** « Une seule référence de réservation suit le paiement,
> de l'interface voyageur jusqu'aux processus opérationnels et financiers. »

Dossier canonique : **`VLT-2028-PAR-BDX-0042`** — Camille Martin, Paris Montparnasse →
Bordeaux Saint-Jean, 15 janvier 2028 08:12, Velvet Flex, 75,00 €, commande Sqills
`SQ-784210`.

---

## Le rituel de démarrage

### La voie rapide

```sh
npm run demo:start
```

Remet d'abord le dossier de démonstration à zéro (`npm run reset` — sinon la carte
enregistrée à la répétition précédente réapparaît dès l'ouverture de `/paiement`,
avant même le premier refus du beat 04:30). Ouvre ensuite les trois terminaux ci-dessous
dans des fenêtres Terminal.app séparées, récupère le `whsec_…` généré par `stripe listen`
et l'écrit lui-même dans `.env` **avant** de démarrer le serveur — l'ordre qui compte,
décrit ci-dessous, est donc garanti. À la fin, le script déclenche un
`payment_intent.succeeded` de test et vérifie dans les logs que le webhook est bien arrivé
jusqu'au serveur local ; il échoue bruyamment sinon.

Pour tout arrêter (serveur, `stripe listen`, et referme les trois fenêtres) :

```sh
npm run demo:stop
```

macOS uniquement (pilote Terminal.app via AppleScript). Sur une autre plateforme, ou pour
garder la main terminal par terminal, suivez la voie manuelle ci-dessous.

### La voie manuelle

**L'ordre compte.** `stripe listen` régénère un secret de signature `whsec_…` à *chaque*
invocation. Si le serveur démarre avant d'avoir ce secret, tous les webhooks échouent en
400 et la console d'exploitation reste muette — sans le moindre message d'erreur visible
à l'écran. C'est la panne la plus facile à provoquer et la plus difficile à diagnostiquer
sur scène.

### Terminal 1 — l'écoute des événements

```sh
npm run listen
```

Recopiez le secret affiché (`whsec_…`). **Laissez ce terminal ouvert pendant toute la
présentation.**

> Le chemin du binaire est figé sur `/opt/homebrew/bin/stripe` dans `package.json`. Si la
> commande échoue, vérifiez ce chemin avant toute autre hypothèse.

### Terminal 2 — le serveur

Collez le secret dans `.env` :

```
STRIPE_WEBHOOK_SECRET=whsec_…
```

puis :

```sh
npm start
```

L'application écoute sur **http://localhost:4242**.

### Terminal 3 — le contrôle

Dix minutes avant de présenter :

```sh
npm run preflight
```

Lecture seule côté données. Il faut **zéro blocage**. Deux avertissements sont attendus
et sans conséquence :

| Avertissement | Pourquoi il est normal |
|---|---|
| `charges_enabled = false` | Les paiements de test fonctionnent malgré tout — vérifié de bout en bout. |
| `aucune carte enregistrée` | État correct après `npm run reset` : l'écran B crée la carte en direct. |

---

## Les écrans

| URL | Rôle | Moment |
|---|---|---|
| `/` | Réservation Paris → Bordeaux, 75 € | 02:00 |
| `/paiement` | Payment Element sur session Checkout (`ui_mode: 'elements'`), 3-D Secure, interrupteur Adaptive Pricing | 02:00–10:00 |
| `/confirmation` | Billet confirmé, PNR, données opérateur repliables | 10:00 |
| `/espace` | Carte enregistrée, bagage 15 € hors session | 10:00–12:30 |
| `/bord` | QR code de régularisation, session unique par PNR | 18:30 |
| `/ops` | Flux d'événements en direct, rapprochement, remboursement, workflow | 16:00–23:00 |

**Ouvrez `/ops` dès le début et laissez-le ouvert.** Il accumule les événements depuis le
premier paiement : à 21:00 il raconte déjà l'histoire, au lieu de démarrer vide.

---

## Cartes de test

| Usage | Numéro |
|---|---|
| **Le refus attendu — beat 04:30** | `4000 0000 0000 9995` |
| **3-D Secure + carte réutilisable — beat 07:00** | `4000 0025 0000 3155` |
| Repli sans authentification | `4242 4242 4242 4242` |
| Refus générique de secours | `4000 0000 0000 0002` |

Date d'expiration future (`12/34`), CVC quelconque (`123`).

### Pourquoi cette carte de 3-D Secure et pas une autre

Vérifié dans le sandbox, et c'est contre-intuitif :

- **`4000 0000 0000 3220`** exige une authentification à **chaque** transaction, y compris
  hors session. Si on l'enregistre à 07:00, l'achat en un geste de 10:00 redemande un défi
  et le beat « sans nouvelle saisie » s'effondre.
- **`4242 4242 4242 4242`** ne déclenche **jamais** de défi, même avec
  `request_three_d_secure: 'any'`. Elle ne peut pas porter le moment 3-D Secure.
- **`4000 0025 0000 3155`** est émise **en France** : un défi à l'enregistrement, puis des
  débits hors session acceptés sans nouvelle authentification. C'est exactement le
  comportement dont dépend l'écran « Mon espace ».

Aucune carte de test ne produit une authentification 3-D Secure *sans friction* en session.
L'exemption ne s'applique qu'à `off_session: true`. Ne promettez pas au comité une
authentification transparente sur l'écran B.

---

## Entre deux répétitions

```sh
npm run reset
```

Remet le dossier de démonstration à blanc.

**Une limite à connaître :** un PaymentIntent ne peut pas être supprimé. Le script
réécrit leurs métadonnées, donc les paiements des répétitions existent toujours dans le
compte — ils ne répondent simplement plus au PNR de démonstration. La recherche par
dossier reste propre, la liste des paiements non.

---

## Les pièges vérifiés

**Le dialogue `beforeunload` pendant le défi 3-D Secure.** Stripe.js installe une
confirmation de sortie de page tant que le défi est actif. Un pilotage automatisé se
retrouve bloqué ; à la main, il suffit d'accepter le dialogue. Ne cliquez pas autour.

**Apple Pay ne s'affichera pas sur `http://localhost`.** Les portefeuilles exigent un
domaine HTTPS enregistré, et `localhost` ne peut pas l'être. Repli par capture d'écran sur
les écrans B et D — mais Apple Pay apparaît bien sur la page Checkout hébergée du beat
18:30, ce qui rend la démonstration honnête.

**Link est activé — la mise en page a été vérifiée.** Contrairement à ce qu'on craignait,
Link ne se place **pas** au-dessus des champs de carte et n'entoure pas la case de
consentement : l'ordre observé est carte → expiration/CVC → pays → **case « Enregistrer les
informations de paiement »** → bloc Link (e-mail, téléphone facultatif, nom facultatif,
mention de consentement Link) → PayPal → bouton de paiement. La case du beat 07:00 est donc
au-dessus du bloc Link, dégagée.

Ce qu'il coûte quand même : de la **hauteur**. Le bloc Link ajoute trois champs et un
paragraphe de conditions, ce qui pousse le bouton « Payer 75,00 € » vers le bas de la zone
projetée. Faites défiler jusqu'au bouton **avant** de commencer à parler, pour ne pas
chercher en direct.

S'il gêne malgré tout, deux sorties : une adresse que Link ne reconnaît pas, ou retirer
`link` de la liste `ON` dans `scripts/configure-pmc.js` puis relancer `npm run pmc`.

**`setup_future_usage` vaut `off_session`** sur l'intention de paiement, sans case à cocher
à l'écran : c'est `payment_intent_data.setup_future_usage` sur la session Checkout qui le
pose, et `saved_payment_method_options.payment_method_save` reste `disabled`. Il n'y a plus
de CustomerSession dans l'intégration — le réaffichage de la carte enregistrée découle du
`customer` porté par la session. La preuve de l'enregistrement reste sur le moyen de
paiement : `allow_redisplay: 'always'` et rattachement au client.

**Aucune liste de moyens de paiement n'est épinglée dans le code.** Ni
`payment_method_types`, ni `payment_method_configuration` : la session Checkout retombe sur la
configuration par défaut du compte et Stripe résout les moyens à présenter selon le pays du
voyageur, la devise et l'appareil. Le parcours a longtemps épinglé
`pmc_1UCZPvLxBtYMYaT4g6N4JJRh` explicitement, ce qui ne changeait rien à l'écran — cette
configuration **est** la configuration par défaut (`is_default: true`) — mais figeait dans le
code une décision qui appartient au Dashboard. `scripts/configure-pmc.js` et
`scripts/preflight.js` continuent de lire et d'écrire cette configuration par son
identifiant : c'est l'outillage de préparation, pas le parcours de paiement.

**Adaptive Pricing — quatre choses mesurées sur ce compte, dont trois contre-intuitives.**

*Le réglage du Dashboard est déjà actif.* Les sessions Checkout de ce sandbox reviennent en
`adaptive_pricing.enabled = true` alors que le code ne demandait rien. Le paramètre de
`routes/booking.js` n'ouvre donc pas la fonctionnalité — il rend l'état **désactivé**
démontrable au lieu de le laisser hériter du compte. C'est pour cela qu'il est toujours
transmis, jamais omis, dans les deux positions de l'interrupteur.

*Le suffixe d'e-mail attend un code pays ISO 3166 alpha-2, et « uk » n'en est pas un.*
Mesuré : `+location_uk` et `+location_UK` renvoient une session **sans aucune option de
devise** — donc un écran en euros avec l'interrupteur en position « activé », la panne
silencieuse. `+location_gb` et `+location_GB` donnent tous deux 67,01 £ ; `+location_JP`
donne 14 019 ¥. La casse est indifférente, le code ne l'est pas. Le client de démonstration
`cus_VD2KkdA6Bs9Sz8` porte donc `camille.martin+location_gb@example.com` : changer
`config.js` sans changer l'adresse du client ferait naître un second client sans carte
enregistrée, et le beat 10:00 s'effondrerait.

⚠️ **Le suffixe est projeté.** Vérifié à l'écran : le bloc Link du formulaire de carte
préremplit `camille.martin+location_gb@example.com`, et l'adresse ressort aussi sur le reçu
Stripe et dans les coordonnées de facturation du moyen de paiement enregistré. C'est
exactement le champ que l'on montre en gros plan au beat 07:00. Prenez-le de front en une
phrase — « c'est l'adresse de test qui simule la localisation du voyageur » — ou repassez le
client sur une adresse propre et renoncez au beat Adaptive Pricing : les deux ne peuvent pas
être vrais en même temps sur le même client.

*La session vue par l'API reste en euros.* `currency: eur`, `amount_total: 7500`, quelle que
soit la devise présentée : `currencyOptions` n'existe que sur l'objet de session **côté
navigateur**, et c'est `presentment_details` — sur la session, le PaymentIntent, le paiement
et le remboursement — qui porte ce que le voyageur a réglé. Le champ est **absent** quand
aucune conversion n'a eu lieu, pas `null` : le billet ne teste donc pas l'égalité à `null`.
Corollaire rassurant pour le rapprochement : `/ops` continue de compter des euros.

*Les moyens affichés changent — dans le sens qu'on n'attend pas, et l'API ne le dit pas.* Le
réflexe est d'annoncer que la conversion « débloque les moyens locaux ». C'est l'inverse qui se
produit ici : **PayPal disparaît** de l'écran quand la conversion est active. Mesuré à l'écran,
dans les deux sens, à état égal : en euros le Payment Element affiche deux lignes
(« Carte bancaire », « PayPal »), sous présentation en livres il n'affiche que le formulaire
carte, sans accordéon.

⚠️ **Le signal est l'écran, pas la session.** `payment_method_types` vaut
`["card","link","paypal"]` **dans les deux états** — vérifié sur les quatre combinaisons
(conversion oui/non × configuration épinglée ou non). Cette liste porte ce que le compte rend
éligible côté serveur ; c'est Stripe.js qui écarte ensuite PayPal, la présentation convertie
n'étant pas prise en charge pour ce moyen. Ne concluez donc rien sur ce qui sera affiché en
lisant la session : ouvrez la page. `cartes_bancaires` ne figure d'ailleurs dans aucune de ces
listes — il est fusionné dans la ligne « Carte bancaire » — et les portefeuilles n'y sont pas
non plus, faute de domaine vérifié sur `localhost`.

Donc : l'effet à montrer est la devise, le sélecteur de devise et la ligne de taux garanti
(« 1 EUR = 0,8935 GBP, frais de conversion de 4 % inclus »), pas un élargissement du choix de
paiement. Et si quelqu'un remarque que PayPal a disparu, la réponse est que la présentation
convertie n'est pas prise en charge par PayPal, pas que la démonstration a changé de
configuration. Pour que le basculement ouvre réellement Pay by Bank ou Klarna, il faudrait
élargir la configuration des moyens de paiement dans le Dashboard — ce qui changerait l'écran
sur **tous** les autres beats. Écarté volontairement.

Deux détails de scène : `setup_future_usage: 'off_session'` **ne supprime pas** la conversion
(vérifié, la combinaison exacte du parcours), et le SDK formate le total en locale française,
ce qui donne « 67,01 £GB » et non « 67,01 £ » — c'est le formatage de Stripe, lu sur la
session, et le corriger à la main reviendrait à recalculer un montant à l'écran.

**Le délai d'indexation de la recherche.** `/v1/payment_intents/search` met 45 à 60
secondes à indexer un paiement neuf. `paymentIntents.list({customer})` est immédiat. Le
créneau naturel de l'agenda entre 10:00 et 12:30 absorbe ce délai ; si la recherche revient
vide, collez l'identifiant du PaymentIntent.

**Le flux à bord utilise un vrai Payment Link, pas une session Checkout en `ui_mode:
'elements'`** comme les écrans `/paiement` et `/espace`. Un Payment Link
n'accepte pas de `success_url` : `after_completion.type = 'hosted_confirmation'` garde le
voyageur sur le domaine `checkout.stripe.com` jusqu'à la confirmation, donc son téléphone
n'a jamais besoin de joindre `localhost`. La contrepartie : pas de `customer` rattaché (la
carte enregistrée ne se préremplit pas) et pas d'`expires_at` — l'usage unique est garanti
par `restrictions.completed_sessions.limit: 1` plutôt que par une expiration dans le temps.

---

## Ce qui est configuré dans le Dashboard

Ni les workflows ni les règles Radar ne s'écrivent par l'API — il n'existe pas de
`POST /v1/radar/rules`, et les workflows ne se créent qu'à la souris. **Tout est déjà en
place** dans le sandbox Velvet (`acct_1UCZPPLxBtYMYaT4`) ; cette section documente l'état
pour pouvoir le reconstruire ou le vérifier.

**1. `Velvet — Remboursement traité`** — workflow événementiel, publié, actif.
Identifiant `wf_test_61VM0QCHPBjZYeITW16VLxMl79DPF3ceAfjVeoBbM3NY`.

| Étape | Valeur |
|---|---|
| Déclencheur | événement `charge.refunded` |
| Condition | `Metadata` → `booking_reference` → `isn't empty` |
| Action | mettre à jour le PaymentIntent : `ops_status` = `refund_processed` |

Vérifié : l'écriture est un **`merge`**, pas un remplacement — `booking_reference` et les
six autres clés survivent. L'application ne l'appelle jamais, il se déclenche seul.

> **Attention à ce que l'on promet au comité.** Cette écriture de métadonnées **n'émet
> aucun événement webhook** sur ce compte — vérifié contre `/v1/events` : un remboursement
> ne produit que `charge.refunded`, `refund.created`, `refund.updated` et
> `charge.refund.updated`, jamais `payment_intent.updated`. L'automatisation est donc
> réelle mais muette. Pour la rendre visible, `routes/webhook.js` **relit** le
> PaymentIntent 3, 6, 10 puis 16 secondes après le remboursement et pousse une ligne dès
> que `ops_status` change. Cette ligne porte `source: lecture` et l'écran l'affiche :
> c'est un état observé, pas un événement Stripe. Ne dites pas « Stripe nous envoie un
> événement » — dites « la console relit le dossier et voit le changement ».
>
> La valeur de référence est relue *avant* de surveiller : un `ops_status` laissé par une
> répétition précédente ne peut pas faire apparaître un faux vert.

**2. `Velvet — Vérification exploitation (à la demande)`** — workflow à déclenchement
manuel derrière le bouton « Déclencher le workflow » de `/ops`. Identifiant
`wf_test_61VM0ah9j4a9HieYa16VLxMl79DPF3ceAfjVeoBbMQg4`.

Déclencheur à la demande, un champ d'entrée `payment_intent_id` ; action « Update a
payment intent » qui écrit `ops_status` = `ops_review_requested`. Le workflow n'accepte
donc **pas un PNR** : `routes/ops.js` résout d'abord le PNR en identifiant de paiement.

Le contrat d'invocation est relevé mot pour mot dans l'onglet **« API call »** du
déclencheur — seule source de vérité pour une API en aperçu :

```
POST https://api.stripe.com/v2/extend/workflows/{ID}/invoke
Stripe-Version: 2026-08-26.preview
{ "input_parameters": { "payment_intent_id": "pi_…" } }
```

Le corps est `input_parameters`, pas `input`. La réponse est un `workflow_run` en
`status: "started"` : l'exécution est **asynchrone**, l'écriture arrive quelques secondes
plus tard.

Les deux identifiants sont dans `.env` (`VELVET_WORKFLOW_ID`,
`VELVET_REFUND_WORKFLOW_ID`) et dans le panneau 0 du scénario Bob `Velvet — 06`.

**3. La règle Radar** — `/test/radar/rules`, créée et **activée** :

```
Request 3DS if ::booking_channel:: = 'web' and :amount_in_eur: > 150
```

Elle exprime une politique dans le vocabulaire de Velvet — le canal de réservation — et
non dans celui d'un score opaque.

> **Ne dites pas que c'est cette règle qui a authentifié Camille.** Son billet est à 75 €,
> sous le seuil de 150 € : la règle ne le concerne pas. Le défi du beat 07:00 vient de
> `payment_method_options.card.request_three_d_secure: 'any'`, posé exprès dans le code pour
> que le beat soit reproductible. Si vous préférez que la règle couvre réellement le dossier
> de démonstration, passez le seuil à `> 50` et la phrase devient littéralement vraie.

L'éditeur **accepte** la syntaxe `::booking_channel::` sur ce compte — le risque « les
attributs de métadonnées relèvent de Radar Plus » ne s'est pas matérialisé, et l'une des
règles d'exemple fournies par Stripe utilise elle-même `::product_sku::`. Aucun repli
n'est nécessaire.

> **Beat gratuit à envisager.** Le bouton « Test rule » de l'éditeur rejoue la règle sur
> l'historique du compte avant de l'enregistrer : sur les données peuplées, il annonce
> **12 839 € de volume concerné**, ventilé en litiges, remboursements, paiements refusés
> et réussis. C'est un argument de gouvernance offert — on écrit une règle qui utilise le
> canal de réservation de Velvet et on en mesure l'impact avant de la mettre en
> production.

**4. Le sandbox est renommé « Velvet »** — `/test/settings/account`. Les titres d'onglets
lisent désormais « … – Velvet – Stripe [Test] ». Impossible à changer par l'API : cette
méthode est refusée sur son propre compte (« you may only use it on connected accounts »).

> **Il reste une occurrence de « Velvet sandbox », et elle est projetée.** Le renommage a
> changé `settings.dashboard.display_name`, mais la case de consentement du Payment
> Element lit `business_profile.name`, qui vaut toujours `Velvet sandbox` :
>
> > ☐ Enregistrer les informations de paiement auprès de **Velvet sandbox** pour vos futurs achats
>
> C'est exactement la case que l'on montre au beat 07:00, en gros plan. Le champ n'est
> modifiable ni par l'API ni par `/test/settings/business-details`, qui répond « You
> haven't added business information yet. To add it, activate your products. » — il est
> derrière l'activation du compte.
>
> **Deux sorties, à vous de choisir :** terminer l'activation (`/test/settings/account` →
> *Activate products*, ce qui débloque le champ « nom commercial » — c'est le geste
> d'intégration déjà prévu, avec vos vraies coordonnées de représentant), ou assumer le mot
> à l'oral : « nous sommes dans un environnement de test, d'où le suffixe ». La première
> est nettement préférable : le comité lira le mot avant que vous ne l'expliquiez.

---

## Scripts

| Commande | Effet |
|---|---|
| `npm run demo:start` | Lance toute la démo (3 terminaux, webhook secret synchronisé, vérifié bout en bout) |
| `npm run demo:stop` | Arrête le serveur et `stripe listen`, referme les 3 terminaux |
| `npm start` | Démarre le serveur sur le port 4242 |
| `npm run listen` | `stripe listen --forward-to localhost:4242/webhook` |
| `npm run preflight` | Contrôle avant présentation, lecture seule |
| `npm run reset` | Remet le dossier de démonstration à blanc |
| `npm run smoke` | Paiement de contrôle à 1,00 € |
| `npm run pmc` | Applique la configuration des moyens de paiement |
| `npm run seed` | Peuple le compte (~400 paiements) — **une seule fois** |

`npm run seed` refuse de tourner si le compte contient déjà plus de 50 paiements.

---

## Scénarios Bob

Six scénarios dans le dossier **`Velvet RFP`**, un par beat, pour prouver chaque étape
sans passer par l'application :

| Scénario | Ce qu'il prouve |
|---|---|
| `Velvet — 01 Réservation : refus puis 3DS réussie` | Une seule intention de paiement survit au refus |
| `Velvet — 02 Carte enregistrée : bagage 15 €` | `allow_redisplay: always`, puis débit hors session sans authentification |
| `Velvet — 03 Remboursement partiel 25 €` | Le remboursement porte les métadonnées du dossier |
| `Velvet — 04 Régularisation à bord : session unique par PNR` | Session Checkout par dossier, URL du QR |
| `Velvet — 05 Recherche par PNR et rapprochement` | Recherche + brut / commission / net / net après remboursement |
| `Velvet — 06 Déclenchement du workflow` | Invocation de l'API Workflows v2 en aperçu, et l'écriture qui en découle |

**Les six sont au vert** dans le compte Velvet. Trois remarques de lecture :

- Dans le scénario 01, le panneau « Essai refusé » **doit** renvoyer un 402. C'est son
  objet. Il est exclu de l'exécution complète pour ne pas faire passer le scénario au rouge.
- Toujours dans le 01, le panneau d'authentification ouvre un vrai navigateur. En exécution
  sans interface, le défi n'est pas achevé et l'intention retombe en
  `requires_payment_method` : c'est le comportement normal d'un défi abandonné.
- Le scénario 06 crée son propre paiement à 12 € **sans** `ops_status`, invoque le workflow,
  puis attend l'écriture. Le sandbox de Bob **n'a pas de `setTimeout`** : l'attente est
  faite de relectures successives (jusqu'à 60), et la latence réseau fait le délai. Le
  panneau final vérifie deux choses à la fois — `ops_status` est apparu **et**
  `booking_reference` a survécu, ce qui prouve que l'action fusionne les métadonnées au
  lieu de les remplacer.

---

## Sécurité

- La clé secrète ne quitte jamais `.env`, côté serveur.
- `/api/config` n'expose que la clé publiable.
- `lib/stripe.js` refuse de démarrer sur une clé qui ne commence pas par `sk_test_`.
- `npm run preflight` balaie `public/` à la recherche de `sk_test`, `whsec_` et `rk_`, et
  échoue durement en cas de trouvaille.
- Aucune donnée de carte réelle, aucun mouvement d'argent réel, aucune action en mode réel.
