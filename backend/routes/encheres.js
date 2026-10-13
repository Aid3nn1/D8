// ================================================================
//  ROUTES ENCHÈRES — CRUD + attribution du gagnant
// ================================================================
const express = require('express');
const router = express.Router();
const { getDb } = require('../db');
const { addLog } = require('../logger');
const { requireAuth, requireRole } = require('../middleware/permissions');

// GET /api/encheres — liste complète
router.get('/api/encheres', requireAuth, requireRole('hg'), async (req, res) => {
  const encheres = await getDb().collection('encheres').find().toArray();
  res.json(encheres);
});

// POST /api/encheres — création
router.post('/api/encheres', requireAuth, requireRole('hg'), async (req, res) => {
  const { nom, images, prixDepart, coffre } = req.body;
  if (!nom || !Array.isArray(images) || images.length === 0) {
    return res.status(400).json({ error: 'Champs manquants' });
  }
  const enchere = {
    id: Date.now(),
    nom,
    images,
    prixDepart: Number(prixDepart) || 0,
    coffre: Number(coffre) || 0,
    statut: 'en_cours',
    vendu: null,
    ajoute_par: req.session.user.nom_rp,
    createdAt: new Date().toISOString(),
  };
  await getDb().collection('encheres').insertOne(enchere);
  await addLog('ENCHERE_ADD', { nom, prixDepart: enchere.prixDepart }, req.session.user.id, req.session.user.nom_rp);
  res.json(enchere);
});

// PATCH /api/encheres/:id — modification
router.patch('/api/encheres/:id', requireAuth, requireRole('hg'), async (req, res) => {
  const id = Number(req.params.id);
  const { nom, images, prixDepart, coffre } = req.body;
  const maj = {};
  if (nom !== undefined) maj.nom = nom;
  if (images !== undefined && images.length) maj.images = images;
  if (prixDepart !== undefined) maj.prixDepart = Number(prixDepart) || 0;
  if (coffre !== undefined) maj.coffre = Number(coffre) || 0;

  const db = getDb();
  // ⚠️ MongoDB driver v6 : findOneAndUpdate renvoie le document directement
  // (et non plus { value: doc } comme en v4/v5).
  const result = await db.collection('encheres').findOneAndUpdate(
    { id },
    { $set: maj },
    { returnDocument: 'after' }
  );
  if (!result) return res.status(404).json({ error: 'Introuvable' });
  await addLog('ENCHERE_EDIT', { nom: result.nom }, req.session.user.id, req.session.user.nom_rp);
  res.json(result);
});

// DELETE /api/encheres/:id
router.delete('/api/encheres/:id', requireAuth, requireRole('hg'), async (req, res) => {
  const id = Number(req.params.id);
  const enchere = await getDb().collection('encheres').findOne({ id });
  if (!enchere) return res.status(404).json({ error: 'Introuvable' });
  await getDb().collection('encheres').deleteOne({ id });
  await addLog('ENCHERE_DEL', { nom: enchere.nom }, req.session.user.id, req.session.user.nom_rp);
  res.json({ ok: true });
});

// POST /api/encheres/:id/vendre — attribution du gagnant
router.post('/api/encheres/:id/vendre', requireAuth, requireRole('hg'), async (req, res) => {
  const id = Number(req.params.id);
  const { client, tel, discord, prixFinal } = req.body;
  if (!client || !discord || !prixFinal) {
    return res.status(400).json({ error: 'Client, ID Discord et prix final requis' });
  }

  const db = getDb();
  const vendu = {
    client, tel, discord,
    prixFinal: Number(prixFinal) || 0,
    date: new Date().toLocaleDateString('fr-FR'),
    agent_nom: req.session.user.nom_rp,
  };

  const result = await db.collection('encheres').findOneAndUpdate(
    { id },
    { $set: { statut: 'vendue', vendu } },
    { returnDocument: 'after' }
  );
  if (!result) return res.status(404).json({ error: 'Introuvable' });

  await addLog('ENCHERE_VENDUE', { nom: result.nom, client, prixFinal: vendu.prixFinal }, req.session.user.id, req.session.user.nom_rp);
  res.json({ ok: true, enchere: result });
});

module.exports = router;