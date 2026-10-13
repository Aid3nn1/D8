// ================================================================
//  ERROR TRACKER — journal d'erreurs Dynasty 8
//  Enregistre les erreurs serveur + navigateur dans la collection
//  Mongo "erreurs" (doublons regroupés via une empreinte + compteur)
//  pour pouvoir les exporter en JSON depuis la page Config.
//  Les 502 sont ignorés (VPS qui redémarre).
//
//  À placer à la racine du backend, à côté de logger.js et db.js.
// ================================================================
const crypto = require('crypto');
const { getDb } = require('./db');

const STATUS_IGNORES = [502];   // ← ajoute ici d'autres codes à ignorer si besoin (ex: 503, 504)
const TEXTES_IGNORES = [
  /EAI_AGAIN/,
  /connection <monitor> to .* (closed|timed out)/,
  /Connection to .* interrupted due to server monitor timeout/,
  /Connection pool for .* was cleared/,
  /Socket 'secureConnect' timed out/,
];
const RETENTION_JOURS = 30;     // une erreur non revue depuis 30 jours est supprimée automatiquement

let _indexesOk = false;

// ---------------------------------------------------------------
// Nettoyage : on ne stocke jamais de webhook, token, mot de passe, etc.
// ---------------------------------------------------------------
const URL_WEBHOOK = /https?:\/\/(?:[\w-]+\.)?discord(?:app)?\.com\/api\/webhooks\/\S+/gi;
const CLE_SENSIBLE = /pass|token|secret|webhook|authorization|cookie|pdf|base64|images|photos/i;

function tronquer(valeur, max) {
  const s = String(valeur ?? '');
  return s.length > max ? s.slice(0, max) + '…' : s;
}

function masquer(texte) {
  return String(texte ?? '').replace(URL_WEBHOOK, '[webhook masqué]');
}

function nettoyer(valeur, profondeur = 0) {
  if (valeur === null || valeur === undefined) return valeur ?? null;
  if (typeof valeur === 'string') return tronquer(masquer(valeur), 200);
  if (typeof valeur !== 'object') return valeur;
  if (profondeur >= 3) return '[…]';
  if (Array.isArray(valeur)) return valeur.slice(0, 5).map(v => nettoyer(v, profondeur + 1));

  const out = {};
  for (const [k, v] of Object.entries(valeur)) {
    out[k] = CLE_SENSIBLE.test(k) ? '[masqué]' : nettoyer(v, profondeur + 1);
  }
  return out;
}

// ---------------------------------------------------------------
// Empreinte : deux erreurs "identiques" = une seule ligne + compteur
// ---------------------------------------------------------------
function empreinte({ source, type, message, route, stack }) {
  const premiereLigne = String(stack || '').split('\n').find(l => l.trim().startsWith('at ')) || '';
  const msg = String(message || '').replace(/\d{4,}/g, '#').slice(0, 300);
  return crypto
    .createHash('sha1')
    .update([source, type, msg, route || '', premiereLigne.trim()].join('|'))
    .digest('hex');
}

async function assurerIndexes(db) {
  if (_indexesOk) return;
  _indexesOk = true;
  try {
    await db.collection('erreurs').createIndex({ fingerprint: 1 }, { unique: true });
    await db.collection('erreurs').createIndex({ last_seen: 1 }, { expireAfterSeconds: RETENTION_JOURS * 86400 });
  } catch (e) {
    console.error('[errorTracker] création des index impossible :', e.message);
  }
}

// ---------------------------------------------------------------
// Enregistrement (ne lève JAMAIS d'exception)
// ---------------------------------------------------------------
async function logError(e, tentative = 0) {
  try {
    if (e.status && STATUS_IGNORES.includes(e.status)) return;
    if (TEXTES_IGNORES.some(re => re.test(String(e.message || '')))) return;

    const db = getDb();
    await assurerIndexes(db);

    const source = e.source || 'serveur';
    const type = tronquer(e.type || 'Error', 60);
    const message = tronquer(masquer(e.message || 'Erreur inconnue'), 1000);
    const stack = tronquer(masquer(e.stack || ''), 4000);
    const route = tronquer(e.route || '', 200);
    const fingerprint = empreinte({ source, type, message, route, stack });
    const maintenant = new Date();

    await db.collection('erreurs').updateOne(
      { fingerprint },
      {
        $setOnInsert: {
          id: Date.now(),
          fingerprint,
          source,
          type,
          message,
          stack,
          route,
          method: e.method || '',
          status: e.status || null,
          first_seen: maintenant,
        },
        $set: {
          last_seen: maintenant,
          statut: 'nouveau', // une erreur qui réapparaît repasse "à traiter"
          page: tronquer(e.page || '', 60),
          utilisateur: e.user || null,
          user_agent: tronquer(e.userAgent || '', 200),
          contexte: nettoyer(e.contexte || null),
        },
        $inc: { count: 1 },
      },
      { upsert: true }
    );
  } catch (err) {
    // Deux erreurs identiques simultanées → clé dupliquée : on retente une fois
    if (err.code === 11000 && tentative < 1) return logError(e, tentative + 1);
    console.error("[errorTracker] impossible d'enregistrer l'erreur :", err.message);
  }
}

// ---------------------------------------------------------------
// Helpers Express
// ---------------------------------------------------------------
function routeDe(req) {
  const modele = req.route?.path;
  if (modele) return `${req.baseUrl || ''}${modele}`;
  return String(req.path || req.originalUrl || '').replace(/\d{4,}/g, ':id');
}

function utilisateurDe(req) {
  const u = req.session?.user;
  return u ? { id: u.id, nom_rp: u.nom_rp, role: u.role } : null;
}

function contexteRequete(req) {
  return { body: req.body, query: req.query, params: req.params };
}

// ---------------------------------------------------------------
// Middleware 1 — attrape toute réponse 5xx (sauf 502)
// À placer AVANT les routes.
// ---------------------------------------------------------------
function requestTracker(req, res, next) {
  res.on('finish', () => {
    if (res.statusCode < 500 || STATUS_IGNORES.includes(res.statusCode)) return;
    if (res.locals._erreurLoguee) return; // déjà enregistrée par errorHandler avec la stack

    logError({
      source: 'serveur',
      type: `HTTP_${res.statusCode}`,
      message: `${req.method} ${routeDe(req)} → ${res.statusCode}`,
      method: req.method,
      route: routeDe(req),
      status: res.statusCode,
      user: utilisateurDe(req),
      userAgent: req.get('user-agent'),
      contexte: contexteRequete(req),
    });
  });
  next();
}

// ---------------------------------------------------------------
// Middleware 2 — gestionnaire d'erreurs Express (avec la stack)
// À placer APRÈS toutes les routes.
// ---------------------------------------------------------------
function errorHandler(err, req, res, next) {
  res.locals._erreurLoguee = true;
  const status = err.status || err.statusCode || 500;

  if (status >= 500) {
    logError({
      source: 'serveur',
      type: err.name || 'Error',
      message: err.message,
      stack: err.stack,
      method: req.method,
      route: routeDe(req),
      status,
      user: utilisateurDe(req),
      userAgent: req.get('user-agent'),
      contexte: contexteRequete(req),
    });
  }

  if (res.headersSent) return next(err);
  res.status(status >= 400 ? status : 500).json({
    error: status >= 500 ? 'Erreur interne du serveur' : (err.message || 'Requête invalide'),
  });
}

// ---------------------------------------------------------------
// Erreurs hors requêtes (bot Discord, timers, sockets...)
// ---------------------------------------------------------------
function installProcessHandlers() {
  process.on('unhandledRejection', (raison) => {
    const err = raison instanceof Error ? raison : new Error(String(raison));
    console.error('[unhandledRejection]', err);
    logError({ source: 'serveur', type: 'unhandledRejection', message: err.message, stack: err.stack });
  });

  process.on('uncaughtException', async (err) => {
    console.error('[uncaughtException]', err);
    // On laisse 2 s max pour écrire en base, puis on quitte (comportement par défaut de Node → PM2 relance)
    await Promise.race([
      logError({ source: 'serveur', type: 'uncaughtException', message: err.message, stack: err.stack }),
      new Promise(r => setTimeout(r, 2000)),
    ]);
    process.exit(1);
  });
}

module.exports = { logError, requestTracker, errorHandler, installProcessHandlers };