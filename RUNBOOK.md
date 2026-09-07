# Velvet — conduite de scène

25 minutes. Une seule réservation : **VLT-2028-PAR-BDX-0042**, Camille Martin, Paris
Montparnasse → Bordeaux Saint-Jean, 15 janvier 2028, Velvet Flex, 75,00 €.

**La phrase qui porte tout, à dire au début et à répéter à la fin :**

> « Une seule référence de réservation suit le paiement, de l'interface voyageur jusqu'aux
> processus opérationnels et financiers. »

Chaque beat ci-dessous a trois lignes : **FAIRE**, **DIRE**, **SI ÇA CASSE**. Ne lisez pas
les phrases mot pour mot, gardez-en l'idée et le vocabulaire.

PAYMENT ANALYTICS: DEV BOX: https://devboxproxy.qa.corp.stripe.com/sandrozc/devbox/sandrozc-1788712368435/services + Console  (Crazy)? 
go/dev
---

## T−10 min — mise en place

1. Terminal 1 : `npm run listen` → copier le `whsec_…` dans `.env`. **Laisser ouvert.**
2. Terminal 2 : `npm start`
3. Terminal 3 : `npm run preflight` → **zéro blocage**, 2 avertissements attendus.
4. `npm run reset` si vous avez répété juste avant.
5. Onglets, dans cet ordre : slide d'ouverture · `/` · `/espace` · `/bord` · `/ops` ·
   Dashboard moyens de paiement · Dashboard paiements/recherche · Dashboard Radar → Rules.
6. **`/ops` ouvert dès maintenant** : il accumule les événements, il ne démarrera pas vide.
7. Notifications coupées, gestionnaire de mots de passe coupé, autofill coupé.
8. Téléphone : 4G activée (pas le Wi-Fi de la salle), luminosité à fond.
9. Faire défiler `/paiement` jusqu'au bouton « Payer » une fois, pour savoir où il est.

---

## 00:00 → 02:00 — Ouvrir sur la thèse

**FAIRE** Slide d'ouverture. Rien d'autre à l'écran.

**DIRE** Velvet lance un opérateur en 2028 avec Sqills comme système de réservation. La
question du comité n'est pas « est-ce que Stripe encaisse une carte » — tout le monde sait
faire ça. La question est : **est-ce que le paiement reste raccroché au dossier de
réservation, de la page de vente jusqu'au rapprochement comptable ?** C'est ce qu'on va
suivre, sur une seule réservation, pendant vingt minutes. Annoncez le PNR à voix haute :
**VLT-2028-PAR-BDX-0042**. Demandez-leur de le retenir.

---

## 02:00 → 04:30 — La page de réservation et les moyens de paiement

**FAIRE** Onglet `/` → montrer l'itinéraire et les 75 €. Cliquer **Payer mon billet**.
Laisser le formulaire se charger, montrer les moyens affichés.

**DIRE** Le paiement reste dans l'expérience Velvet — même typographie, même vert, même
rose. Les moyens affichés sont adaptés au pays, à la devise et à l'appareil, et Velvet les
pilote depuis Stripe **sans retoucher le parcours**. Nommez ce qui est activé : cartes,
Cartes Bancaires, Apple Pay, Google Pay, PayPal, Link.

**À dire avant qu'on le remarque :** Apple Pay ne s'affiche pas ici parce que la démo
tourne sur `localhost` et que les portefeuilles exigent un domaine HTTPS enregistré. Il
apparaîtra sur la page hébergée du beat à bord, dans quinze minutes. Sur Wero : validation
au cas par cas, en aperçu — ne promettez rien de plus.

**SI ÇA CASSE** Le formulaire ne charge pas → basculez sur l'onglet Dashboard « moyens de
paiement » et racontez la configuration depuis là.

---

## 04:30 → 07:00 — Le refus, et le dossier qui survit

**FAIRE** Carte **`4000 0000 0000 9995`**, expiration `12/34`, CVC `123`. Payer. Montrer le
message d'erreur en français. **Pointer l'identifiant `cs_…` dans le panneau de droite.**

**DIRE** Un refus, c'est le cas normal, pas l'exception — plusieurs pour cent du trafic.
Deux choses à regarder. La première : le message est en français et il est actionnable, le
voyageur sait quoi faire. La seconde, et c'est celle qui compte pour Sqills :
**l'identifiant de la session de paiement n'a pas changé.** On ne crée pas une deuxième
réservation, on
ne dédouble pas le dossier. Le voyageur change de carte **dans le même dossier**.

**SI ÇA CASSE** Refus non déclenché → `4000 0000 0000 0002`. Trop de tentatives sur la même
session → rechargez `/` pour repartir sur une session neuve.

---

## 07:00 → 10:00 — L'authentification, et le consentement d'enregistrement

**FAIRE** Remplacer par **`4000 0025 0000 3155`**. **Cocher « Enregistrer les informations
de paiement »** — elle est juste au-dessus du bloc Link. Payer. Le défi 3-D Secure s'ouvre
**dans la page**. Choisir le chemin qui réussit. Arriver sur `/confirmation`.

**DIRE** Deux messages. **L'authentification** : Stripe la déclenche quand elle est
nécessaire, et elle reste **à l'intérieur du parcours** — pas de redirection vers une page
tierce qui casse la conversion. **Le consentement** : le voyageur a coché, explicitement,
avant qu'on enregistre quoi que ce soit. Et Velvet ne stocke jamais le numéro de carte —
seul un identifiant de moyen de paiement est rattaché au dossier.

⚠️ **Ne dites pas que c'est la règle Radar qui a demandé l'authentification.** Ce billet est
à 75 €, sous le seuil de la règle. Ici c'est l'intégration qui la force, exprès, pour que la
démonstration soit reproductible. La règle, on la montre à 12:30.

⚠️ La case de consentement affiche « auprès de **Velvet sandbox** ». Si le comité le
relève : c'est le nom de l'environnement de test, le champ est derrière l'activation du
compte. Prenez-le de front en une phrase, ne le laissez pas flotter.

**SI ÇA CASSE** Pas de défi → `4242 4242 4242 4242`, et vous perdez le beat 3-D Secure mais
pas le reste. Un dialogue « quitter la page ? » apparaît pendant le défi → acceptez-le,
c'est Stripe.js, ne cliquez pas ailleurs.

---

## 10:00 → 12:30 — Le voyageur revient : un geste, pas de formulaire

**FAIRE** Sur `/confirmation`, déplier le bloc opérateur : les 7 clés de métadonnées.
Puis onglet **`/espace`** → cliquer **« Ajouter un bagage — 15 € »**.

**DIRE** La carte est là, en ligne native Velvet — marque, quatre derniers chiffres,
expiration. Le voyageur clique une fois : **pas de formulaire, pas de nouvelle
authentification, l'argent bouge.** Techniquement c'est un débit hors session déclenché par
Velvet contre le moyen de paiement enregistré. Et il porte **le même
`booking_reference`**, plus `ancillary_type: baggage` : la prestation complémentaire se
rapproche du même dossier, automatiquement.

**Si on vous demande** pourquoi on ne montre pas le sélecteur de cartes de Stripe : c'est un
choix. Un débit déclenché par le marchand supprime le formulaire, ce qui démontre mieux ce
que vaut la carte enregistrée. Le Payment Element reste la voie quand le voyageur doit
choisir entre plusieurs cartes.

**`setup_future_usage` vaut `off_session`** sur le paiement : la session Checkout le pose
via `payment_intent_data`. L'autre preuve de l'enregistrement est `allow_redisplay: always`
sur le moyen de paiement.

---

## 12:30 → 16:00 — Le Dashboard : retrouver le dossier

**FAIRE** Onglet Dashboard → recherche globale → coller **`VLT-2028-PAR-BDX-0042`**. Ouvrir
le paiement à 75 €. Montrer les métadonnées, la section 3-D Secure, la section Radar.
Puis onglet **Radar → Rules**, montrer la règle en haut de liste.

**DIRE** Une équipe d'exploitation Velvet tape la référence de réservation — pas un
identifiant technique Stripe — et retrouve le paiement, l'authentification, l'évaluation du
risque. C'est ça, « le paiement raccroché au dossier ».

Sur la règle : `Request 3DS if ::booking_channel:: = 'web' and :amount_in_eur: > 150`. Le
point à faire passer : **la politique s'écrit dans le vocabulaire de Velvet** — le canal de
réservation — pas dans celui d'un score opaque. Web, à bord, agence, revendeur : chaque
canal peut avoir sa règle.

**Bonus si vous avez la minute** (Add rule → Request 3DS → coller la condition → **Test
rule**) : Radar rejoue la règle sur l'historique **avant** de l'activer. Sur ce compte :
**12 839 € de volume concerné**, ventilés en litiges, remboursements, paiements refusés et
réussis. On mesure l'impact d'une politique avant de la mettre en production. Puis
**Annuler** — la règle existe déjà.

**SI ÇA CASSE** Recherche vide → l'indexation prend 45 à 60 secondes. Collez directement
l'identifiant `pi_…` que vous avez sous la main. Ne restez pas sur un écran vide plus de
quinze secondes.

---

## 16:00 → 18:30 — La console d'exploitation

**FAIRE** Onglet **`/ops`**. Montrer le flux : il est déjà rempli depuis le premier
paiement. Chercher le PNR. Montrer le tableau : brut / commission / net / net après
remboursement. Cliquer **Export CSV**.

**DIRE** Tout ce que vous voyez arrive par **webhook**, en direct, sans rafraîchir la page.
C'est le même mécanisme qui alimenterait Sqills et l'ERP de Velvet. Et chaque ligne porte
la référence de réservation : le rapprochement n'est pas un travail de fin de mois, il est
déjà fait.

⚠️ **Dites-le avant qu'on le demande :** la commission affichée est une commission simulée
d'environnement de test. **Ce n'est pas la tarification Interchange++ de Velvet.** La forme
du rapprochement est réelle, le chiffre ne l'est pas.

---

## 18:30 → 21:00 — À bord : le QR vivant

**FAIRE** Onglet **`/bord`**. Montrer le QR. **Le scanner avec votre téléphone, en 4G**,
devant le comité. La page Checkout s'ouvre en français à 25 €. Payer sur le téléphone.
Revenir sur **`/ops`** : l'événement arrive.

**DIRE** Ce QR n'est pas un lien de paiement statique imprimé une fois pour toutes. C'est
une session de paiement **créée à l'instant pour ce dossier-là**, avec le PNR dedans. Donc
la régularisation encaissée par le contrôleur se rapproche du même dossier, sans ressaisie.
Un lien statique ne peut pas faire ça. Notez aussi qu'**Apple Pay apparaît ici** — page
hébergée, domaine HTTPS.

Après le paiement, le voyageur reste sur la page Stripe — pas de redirection vers `localhost`.
**La preuve du paiement, c'est la console** — et on y va tout de suite.

**SI ÇA CASSE** Le téléphone ne scanne pas → le lien de paiement de secours. Pas de réseau
du tout → montrez le QR, expliquez, et payez depuis le navigateur du poste.

---

## 21:00 → 23:00 — Le remboursement et l'automatisation sans code

**FAIRE** Sur `/ops`, cliquer **Rembourser 25 €**. Regarder arriver `charge.refunded`,
`refund.created`, `refund.updated`. **Attendre 5 à 15 secondes.** Une quatrième ligne
apparaît : `Workflow sans code — ops_status = refund_processed`.

**DIRE** Le remboursement part depuis l'outil de Velvet, il porte les métadonnées du
dossier, et le tableau recalcule le net tout seul.

Ensuite, la ligne qui compte : **un workflow que j'ai construit à la souris dans le
Dashboard**, sans une ligne de code, déclenché par le remboursement, qui remet le dossier à
jour avec un statut d'exploitation. C'est le genre de tâche qu'une équipe Velvet automatise
elle-même, sans ticket auprès de l'IT.

⚠️ **Précision d'honnêteté, faites-la, elle vous crédibilise :** cette écriture ne produit
pas d'événement webhook. La console **relit** le dossier et constate le changement — la
ligne est marquée `source: lecture`, à l'écran. Ne dites pas « Stripe nous envoie un
événement » : dites « la console relit le dossier et voit le changement ».

**FAIRE** Cliquer **Déclencher le workflow** → le JSON de l'exécution s'affiche.

**DIRE** Et le même mécanisme s'invoque à la demande depuis les outils de Velvet.

**SI ÇA CASSE** La quatrième ligne ne vient pas dans les 20 secondes → passez à la suite
sans commenter. Le remboursement, lui, est visible et suffit.

---

## 23:00 → 25:00 — Fermer

**FAIRE** Revenir sur `/ops`, PNR filtré à l'écran. Rien d'autre.

**DIRE** Récapitulez en pointant l'écran, dans cet ordre : une réservation · un refus
récupéré dans le même dossier · une authentification dans le parcours · une carte
enregistrée avec consentement · un achat en un geste · une régularisation à bord · un
remboursement · un rapprochement brut/commission/net · une automatisation sans code. **Une
seule référence de réservation les traverse tous.**

Puis la question qui rend la main au comité :

> « Sur quel point voulez-vous qu'on aille plus loin — l'intégration avec Sqills, la
> gouvernance du risque, ou le rapprochement financier ? »

---

## Les trois phrases à ne pas prononcer

1. « Radar a demandé l'authentification » sur le billet à 75 € — c'est l'intégration.
2. « Stripe envoie un événement quand le workflow écrit » — non, la console relit.
3. « Voici votre commission » — c'est une commission simulée de test.

## Les trois choses à dire avant qu'on les remarque

1. Apple Pay absent sur `localhost`, présent sur la page hébergée à 18:30.
2. « Velvet sandbox » dans la case de consentement, si le compte n'est pas activé d'ici là.
