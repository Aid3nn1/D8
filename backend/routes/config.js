// ================================================================
//  ROUTES CONFIG — mode maintenance + bypass par ID Discord
// ================================================================
const express = require('express');
const router = express.Router();
const { getDb } = require('../db');
const { requireAuth, requireRole } = require('../middleware/permissions');

const MAINTENANCE_DOC_ID = 'maintenance';

// Publique — appelée par le gate au chargement du site.
// Renvoie active/message pour tout le monde, et calcule "bypass" pour
// l'utilisateur actuellement connecté (sans jamais exposer la liste
// des IDs autorisés, qui reste privée côté serveur).
router.get('/api/maintenance', async (req, res) => {
  try {
    const db = getDb();
    const doc = await db.collection('config').findOne({ _id: MAINTENANCE_DOC_ID });
    const bypassIds = doc?.bypassIds || [];
    const userId = req.session?.user?.id;
    const userRole = req.session?.user?.role;

    const bypass = !!userId && (userRole === 'owner' || bypassIds.includes(userId));

    res.json({
      active: doc?.active || false,
      message: doc?.message || '',
      bypass,
    });
  } catch (e) {
    console.error('Erreur lecture maintenance:', e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Protégée — réservée à owner (cf. PAGE_ACCESS.config dans config.js)
router.post('/api/maintenance', requireAuth, requireRole('owner'), async (req, res) => {
  const { active, message, bypassIds } = req.body;
  if (typeof active !== 'boolean') {
    return res.status(400).json({ error: '"active" doit être un booléen' });
  }
  if (bypassIds !== undefined && !Array.isArray(bypassIds)) {
    return res.status(400).json({ error: '"bypassIds" doit être un tableau' });
  }

  try {
    const db = getDb();
    const maj = {
      active,
      message: message || '',
      updated_at: new Date(),
      updated_by: req.session.user.id,
    };
    if (bypassIds !== undefined) {
      maj.bypassIds = bypassIds.map(id => String(id).trim()).filter(Boolean);
    }

    await db.collection('config').updateOne(
      { _id: MAINTENANCE_DOC_ID },
      { $set: maj },
      { upsert: true }
    );

    const updated = await db.collection('config').findOne({ _id: MAINTENANCE_DOC_ID });
    res.json({ active: updated.active, message: updated.message || '', bypassIds: updated.bypassIds || [] });
  } catch (e) {
    console.error('Erreur écriture maintenance:', e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Protégée — lecture de la liste des IDs bypass (owner uniquement),
// séparée du GET public pour ne jamais l'exposer sans authentification.
router.get('/api/maintenance/bypass', requireAuth, requireRole('owner'), async (req, res) => {
  try {
    const db = getDb();
    const doc = await db.collection('config').findOne({ _id: MAINTENANCE_DOC_ID });
    res.json({ bypassIds: doc?.bypassIds || [] });
  } catch (e) {
    console.error('Erreur lecture bypass maintenance:', e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;