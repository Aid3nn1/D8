// ================================================================
//  ROUTES MEMBRES — alimente la page Permissions ET la table
//  "Membres & Rôles" de la page Config (même source de données).
// ================================================================
const express = require('express');
const router = express.Router();
const { getDb } = require('../db');
const { addLog } = require('../logger');
const { requireAuth, requireRole } = require('../middleware/permissions');
const { ROLE_LEVELS, ROLE_MAP } = require('../config');

// GET /api/membres — liste (page Permissions + Config)
router.get('/api/membres', requireAuth, requireRole('hg'), async (req, res) => {
  const membres = await getDb().collection('membres').find({ actif: { $ne: 0 } }).toArray();
  res.json(membres);
});

// POST /api/membres — ajout manuel (modal "Ajouter un membre")
router.post('/api/membres', requireAuth, requireRole('hg'), async (req, res) => {
  const { nom_rp, nom_hrp, discord_id, role } = req.body;
  if (!nom_rp || !discord_id) return res.status(400).json({ error: 'Champs manquants' });

  const db = getDb();
  const existant = await db.collection('membres').findOne({ discord_id });
  if (existant) return res.status(409).json({ error: 'Cet ID Discord est déjà enregistré.' });

  const membre = { discord_id, nom_rp, nom_hrp: nom_hrp || nom_rp, role: role || 'agent', isDecorateur: false, actif: 1 };
  await db.collection('membres').insertOne(membre);
  await addLog('MEMBRE_ADD', { membre: nom_rp, role: membre.role }, req.session.user.id, req.session.user.nom_rp);
  res.json(membre);
});

// PATCH /api/membres/:discord_id/role — changement de rôle
// Réservé owner : on ne peut pas modifier quelqu'un de rang >= au sien,
// ni attribuer un rôle >= au sien (même logique que l'ancien site).
router.patch('/api/membres/:discord_id/role', requireAuth, requireRole('hg'), async (req, res) => {
  const { role: newRole } = req.body;
  const db = getDb();
  const cible = await db.collection('membres').findOne({ discord_id: req.params.discord_id });
  if (!cible) return res.status(404).json({ error: 'Introuvable' });

  const niveauActeur = ROLE_LEVELS[req.session.user.role] ?? 0;
  const niveauCible = ROLE_LEVELS[cible.role] ?? 0;
  const niveauNewRole = ROLE_LEVELS[newRole] ?? 0;

  if (niveauActeur <= niveauCible) return res.status(403).json({ error: 'Impossible de modifier ce membre.' });
  if (niveauNewRole >= niveauActeur) return res.status(403).json({ error: "Impossible d'attribuer un rôle supérieur ou égal au vôtre." });

  await db.collection('membres').updateOne({ discord_id: req.params.discord_id }, { $set: { role: newRole } });
  await addLog('ROLE_CHANGE', { membre: cible.nom_rp, old_role: cible.role, new_role: newRole }, req.session.user.id, req.session.user.nom_rp);
  res.json({ ok: true });
});

// PATCH /api/membres/:discord_id/decorateur — bascule statut décorateur (page Config)
router.patch('/api/membres/:discord_id/decorateur', requireAuth, requireRole('owner'), async (req, res) => {
  const { isDecorateur } = req.body;
  const db = getDb();
  const cible = await db.collection('membres').findOne({ discord_id: req.params.discord_id });
  if (!cible) return res.status(404).json({ error: 'Introuvable' });

  await db.collection('membres').updateOne(
    { discord_id: req.params.discord_id },
    { $set: { isDecorateur: !!isDecorateur, isDecorateurManuel: !!isDecorateur } }
  );
  await addLog(
    'ROLE_CHANGE',
    { membre: cible.nom_rp, old_role: cible.isDecorateur ? 'décorateur' : 'non-décorateur', new_role: isDecorateur ? 'décorateur' : 'non-décorateur' },
    req.session.user.id, req.session.user.nom_rp
  );
  res.json({ ok: true });
});

// DELETE /api/membres/:discord_id — révocation
router.delete('/api/membres/:discord_id', requireAuth, requireRole('hg'), async (req, res) => {
  const db = getDb();
  const cible = await db.collection('membres').findOne({ discord_id: req.params.discord_id });
  if (!cible) return res.status(404).json({ error: 'Introuvable' });
  if ((ROLE_LEVELS[req.session.user.role] ?? 0) <= (ROLE_LEVELS[cible.role] ?? 0)) {
    return res.status(403).json({ error: 'Impossible de révoquer ce membre.' });
  }

  await db.collection('membres').deleteOne({ discord_id: req.params.discord_id });
  await addLog('MEMBRE_DEL', { membre: cible.nom_rp, role: cible.role }, req.session.user.id, req.session.user.nom_rp);
  res.json({ ok: true });
});

function calculerRoleDepuisDiscord(discordRoleIds) {
  let role = null;
  for (const [discordRoleId, r] of Object.entries(ROLE_MAP)) {
    if (discordRoleId && discordRoleId !== 'undefined' && discordRoleIds.includes(discordRoleId)) {
      if (!role || (ROLE_LEVELS[r] ?? 0) > (ROLE_LEVELS[role] ?? 0)) role = r;
    }
  }
  return role; // null = aucun rôle Dynasty 8
}

// POST /api/membres/sync — resynchronise tous les membres avec leurs rôles Discord actuels.
// Retire ceux qui n'ont plus (ou plus aucun) rôle Dynasty 8, met à jour les rôles changés.
router.post('/api/membres/sync', requireAuth, requireRole('owner'), async (req, res) => {
  const db = getDb();
  const { getRolesDiscordMembre } = require('../discord/bot');
  const membres = await db.collection('membres').find({}).toArray();

  let supprimes = 0, misAJour = 0;

  for (const m of membres) {
    if (m.role === 'owner') continue; // jamais toucher au owner

    const rolesDiscord = await getRolesDiscordMembre(m.discord_id);

    if (rolesDiscord === null) {
      await db.collection('membres').deleteOne({ discord_id: m.discord_id });
      await addLog('MEMBRE_DEL', { membre: m.nom_rp, role: m.role }, req.session.user.id, req.session.user.nom_rp);
      supprimes++;
      continue;
    }

    const nouveauRole = calculerRoleDepuisDiscord(rolesDiscord);

    if (!nouveauRole) {
      await db.collection('membres').deleteOne({ discord_id: m.discord_id });
      await addLog('MEMBRE_DEL', { membre: m.nom_rp, role: m.role }, req.session.user.id, req.session.user.nom_rp);
      supprimes++;
    } else if (nouveauRole !== m.role) {
      await db.collection('membres').updateOne({ discord_id: m.discord_id }, { $set: { role: nouveauRole } });
      await addLog('ROLE_CHANGE', { membre: m.nom_rp, old_role: m.role, new_role: nouveauRole }, req.session.user.id, req.session.user.nom_rp);
      misAJour++;
    }
  }

  res.json({ supprimes, misAJour });
});

// GET /api/stats/agence — compteurs publics pour l'accueil (tout utilisateur connecté)
router.get('/api/stats/agence', requireAuth, async (req, res) => {
  const db = getDb();
  const [agents, enService] = await Promise.all([
    db.collection('membres').countDocuments({
      actif: { $ne: 0 },
      role: { $in: ['agent', 'hg', 'co_patron', 'owner'] },
    }),
    db.collection('services').countDocuments({ fin: null }),
  ]);
  res.json({ agents, enService });
});

module.exports = router;