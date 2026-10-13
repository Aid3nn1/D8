// ================================================================
//  ROUTES JOURNAL D'ERREURS — réception, liste, export JSON, statut
//  À placer dans routes/errors.js
// ================================================================
const express = require('express');
const router = express.Router();
const { getDb } = require('../db');
const { addLog } = require('../logger');
const { requireAuth, requireRole } = require('../middleware/permissions');
const { logError } = require('../errorTracker');

function filtreStatut(req) {
  // "tout" = tout le journal, sinon uniquement ce qui reste à traiter
  return req.query.statut === 'tout' ? {} : { statut: { $ne: 'corrige' } };
}

// ---------------------------------------------------------------
// RÉCEPTION DES ERREURS DU NAVIGATEUR (tout utilisateur connecté)
// Limité à 30 rapports / minute / utilisateur pour éviter le spam.
// ---------------------------------------------------------------
const compteurs = new Map();
function trop(userId) {
  const maintenant = Date.now();
  let c = compteurs.get(userId);
  if (!c || maintenant - c.debut > 60000) {
    c = { debut: maintenant, n: 0 };
    compteurs.set(userId, c);
  }
  c.n++;
  return c.n > 30;
}

router.post('/api/errors/client', requireAuth, async (req, res) => {
  const u = req.session.user;
  if (trop(u.id)) return res.status(429).json({ error: 'Trop de rapports' });

  const { type, message, stack, page, url, fichier, ligne, colonne } = req.body || {};
  if (!message) return res.status(400).json({ error: 'message requis' });

  await logError({
    source: 'navigateur',
    type: String(type || 'client').slice(0, 40),
    message,
    stack,
    page,
    route: page ? `page:${page}` : '',
    user: { id: u.id, nom_rp: u.nom_rp, role: u.role },
    userAgent: req.get('user-agent'),
    contexte: { url, fichier, ligne, colonne },
  });
  res.json({ ok: true });
});

// ---------------------------------------------------------------
// LISTE (résumé, sans stack) — owner
// ---------------------------------------------------------------
router.get('/api/errors', requireAuth, requireRole('owner'), async (req, res) => {
  const liste = await getDb().collection('erreurs')
    .find(filtreStatut(req), { projection: { stack: 0, contexte: 0 } })
    .sort({ last_seen: -1 })
    .limit(300)
    .toArray();
  res.json(liste);
});

// ---------------------------------------------------------------
// EXPORT JSON COMPLET — owner
// ---------------------------------------------------------------
router.get('/api/errors/export', requireAuth, requireRole('owner'), async (req, res) => {
  const docs = await getDb().collection('erreurs')
    .find(filtreStatut(req))
    .sort({ last_seen: -1 })
    .limit(500)
    .toArray();

  const erreurs = docs.map(({ _id, ...e }) => ({
    ...e,
    reapparue_apres_correction: !!(e.corrige_le && e.last_seen > e.corrige_le),
  }));

  const payload = {
    _lisez_moi:
      "Journal d'erreurs Dynasty 8 exporté depuis la page Config. Chaque entrée regroupe les occurrences identiques " +
      "(count, first_seen, last_seen). source = 'serveur' (Node/Express, stack avec fichier:ligne) ou 'navigateur' " +
      "(main.js, page = onglet actif). 'contexte' contient body/query/params nettoyés (webhooks, tokens, photos masqués). " +
      "Les 502 sont volontairement ignorés (redémarrage du VPS).",
    site: 'Dynasty 8',
    exporte_le: new Date().toISOString(),
    exporte_par: req.session.user.nom_rp,
    filtre: req.query.statut === 'tout' ? 'toutes les erreurs' : 'erreurs à traiter uniquement',
    nb_erreurs: erreurs.length,
    serveur: { node: process.version, uptime_secondes: Math.round(process.uptime()) },
    erreurs,
  };

  await addLog('ERREURS_EXPORT', { message: `${erreurs.length} erreur(s) exportée(s)` }, req.session.user.id, req.session.user.nom_rp);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="erreurs_dynasty8_${new Date().toISOString().split('T')[0]}.json"`);
  res.send(JSON.stringify(payload, null, 2));
});

// ---------------------------------------------------------------
// STATUT (à traiter / corrigé) — owner
// ---------------------------------------------------------------
router.patch('/api/errors/:id', requireAuth, requireRole('owner'), async (req, res) => {
  const id = Number(req.params.id);
  const { statut } = req.body;
  if (!['nouveau', 'corrige'].includes(statut)) return res.status(400).json({ error: 'Statut invalide' });

  const maj = statut === 'corrige'
    ? { $set: { statut, corrige_le: new Date() } }
    : { $set: { statut }, $unset: { corrige_le: '' } };

  const result = await getDb().collection('erreurs').updateOne({ id }, maj);
  if (result.matchedCount === 0) return res.status(404).json({ error: 'Introuvable' });
  res.json({ ok: true });
});

// ---------------------------------------------------------------
// SUPPRESSION — owner
// ---------------------------------------------------------------
router.delete('/api/errors/:id', requireAuth, requireRole('owner'), async (req, res) => {
  const id = Number(req.params.id);
  const result = await getDb().collection('erreurs').deleteOne({ id });
  if (result.deletedCount === 0) return res.status(404).json({ error: 'Introuvable' });
  res.json({ ok: true });
});

router.delete('/api/errors', requireAuth, requireRole('owner'), async (req, res) => {
  const seulementCorrigees = req.query.corriges === '1';
  const result = await getDb().collection('erreurs').deleteMany(seulementCorrigees ? { statut: 'corrige' } : {});
  await addLog(
    'ERREURS_CLEAR',
    { message: `${result.deletedCount} erreur(s) supprimée(s)${seulementCorrigees ? ' (corrigées)' : ''}` },
    req.session.user.id,
    req.session.user.nom_rp
  );
  res.json({ ok: true, supprimees: result.deletedCount });
});

module.exports = router;