'use strict';
const QRCode = require('qrcode-svg');

// Le QR code est rendu côté serveur en SVG inline : aucun script client, aucun
// CDN, aucune dépendance réseau au moment de la présentation. Il reste net
// quelle que soit la taille de projection.
function toSvg(text, { size = 420 } = {}) {
  return new QRCode({
    content: text,
    padding: 2,
    width: size,
    height: size,
    color: '#003E40',
    background: '#FFFFFF',
    // L'URL de session Checkout fait ~150 caractères : en correction « M » le
    // code passe en version 11 et devient trop dense pour être scanné depuis la
    // salle. « L » réduit le nombre de modules, et un écran projeté n'a pas les
    // défauts d'impression qui justifieraient une correction plus forte.
    ecl: 'L',
    join: true,
    container: 'svg-viewbox',
  }).svg();
}

module.exports = { toSvg };
