// ================================================================
//  ROUTES CONFIG AGENCE — taxes, biens, catégories, zones, blacklist,
//  backup, exports, webhooks, zones-shapes (carte)
// ================================================================
const express = require('express');
const router = express.Router();
const { getDb } = require('../db');
const { addLog } = require('../logger');
const { requireAuth, requireRole } = require('../middleware/permissions');

// ---------------------------------------------------------------
// TAXES
// ---------------------------------------------------------------
router.get('/api/config/taxes', requireAuth, requireRole('agent'), async (req, res) => {
  const doc = await getDb().collection('config').findOne({ _id: 'taxes' });
  res.json({ achat: doc?.achat ?? 20, location: doc?.location ?? 10 });
});

router.post('/api/config/taxes', requireAuth, requireRole('owner'), async (req, res) => {
  const { achat, location } = req.body;
  if (typeof achat !== 'number' || typeof location !== 'number') {
    return res.status(400).json({ error: 'achat et location doivent être des nombres' });
  }
  await getDb().collection('config').updateOne(
    { _id: 'taxes' },
    { $set: { achat, location, updated_at: new Date(), updated_by: req.session.user.id } },
    { upsert: true }
  );
  await addLog('CONFIG_TAXES', { achat, location }, req.session.user.id, req.session.user.nom_rp);
  res.json({ ok: true, achat, location });
});

// ---------------------------------------------------------------
// BLOCAGE D'ACCÈS AUX CLIENTS (rôle "client" uniquement — staff/agents jamais concernés)
// ---------------------------------------------------------------
router.get('/api/config/access-clients', requireAuth, requireRole('client'), async (req, res) => {
  const doc = await getDb().collection('config').findOne({ _id: 'access_clients' });
  res.json({ bloque: doc?.bloque ?? false, message: doc?.message || '' });
});

router.post('/api/config/access-clients', requireAuth, requireRole('owner'), async (req, res) => {
  const { bloque, message } = req.body;
  await getDb().collection('config').updateOne(
    { _id: 'access_clients' },
    { $set: { bloque: !!bloque, message: message || '', updated_at: new Date(), updated_by: req.session.user.id } },
    { upsert: true }
  );
  await addLog('CONFIG_ACCESS_CLIENTS', { bloque: !!bloque }, req.session.user.id, req.session.user.nom_rp);
  res.json({ ok: true, bloque: !!bloque, message: message || '' });
});

// ---------------------------------------------------------------
// BIENS DYNAMIQUES
// Collection: biens { id, nom, categorie, prixAchat, prixLoc, coffre, images[], zones[] }
// ---------------------------------------------------------------
router.get('/api/biens', requireAuth, requireRole('client'), async (req, res) => {
  const biens = await getDb().collection('biens').find().toArray();
  res.json(biens);
});

router.post('/api/biens', requireAuth, requireRole('owner'), async (req, res) => {
  const { nom, categorie, prixAchat, prixLoc, coffre, images, zones } = req.body; // ← zones ajouté
  if (!nom || !images || images.length === 0) {
    return res.status(400).json({ error: 'Nom et au moins une photo requis' });
  }
  const bien = {
    id: Date.now(),
    nom, categorie: categorie || 'Autres',
    prixAchat: Number(prixAchat) || 0,
    prixLoc: Number(prixLoc) || 0,
    coffre: Number(coffre) || 0,
    images, zones: Array.isArray(zones) ? zones : [] // ← utilise les zones envoyées
  };
  await getDb().collection('biens').insertOne(bien);
  await addLog('BIEN_ADD', { bien: nom }, req.session.user.id, req.session.user.nom_rp);
  res.json(bien);
});

router.patch('/api/biens/:id', requireAuth, requireRole('owner'), async (req, res) => {
  const id = Number(req.params.id);
  const { nom, categorie, prixAchat, prixLoc, coffre, images, zones } = req.body;
  const maj = {};
  if (nom !== undefined) maj.nom = nom;
  if (categorie !== undefined) maj.categorie = categorie;
  if (prixAchat !== undefined) maj.prixAchat = Number(prixAchat);
  if (prixLoc !== undefined) maj.prixLoc = Number(prixLoc);
  if (coffre !== undefined) maj.coffre = Number(coffre);
  if (images !== undefined) maj.images = images;
  if (zones !== undefined) maj.zones = zones;

  const result = await getDb().collection('biens').updateOne({ id }, { $set: maj });
  if (result.matchedCount === 0) return res.status(404).json({ error: 'Introuvable' });
  await addLog('BIEN_EDIT', { bien: maj.nom || `#${id}` }, req.session.user.id, req.session.user.nom_rp);
  res.json({ ok: true });
});

router.delete('/api/biens/:id', requireAuth, requireRole('owner'), async (req, res) => {
  const id = Number(req.params.id);
  const bien = await getDb().collection('biens').findOne({ id });
  if (!bien) return res.status(404).json({ error: 'Introuvable' });
  await getDb().collection('biens').deleteOne({ id });
  await addLog('BIEN_DEL', { bien: bien.nom }, req.session.user.id, req.session.user.nom_rp);
  res.json({ ok: true });
});

// ---------------------------------------------------------------
// CATÉGORIES DE BIENS
// ---------------------------------------------------------------
const CATEGORIES_BASE = [];

router.get('/api/config/categories', requireAuth, requireRole('client'), async (req, res) => {
  const doc = await getDb().collection('config').findOne({ _id: 'categories' });
  res.json({ base: CATEGORIES_BASE, custom: doc?.liste || [] });
});

router.post('/api/config/categories', requireAuth, requireRole('owner'), async (req, res) => {
  const { nom } = req.body;
  if (!nom || !nom.trim()) return res.status(400).json({ error: 'Nom requis' });
  const trimmed = nom.trim();
  if (CATEGORIES_BASE.includes(trimmed)) return res.status(409).json({ error: 'Catégorie de base déjà existante' });

  const db = getDb();
  const doc = await db.collection('config').findOne({ _id: 'categories' });
  const liste = doc?.liste || [];
  if (liste.includes(trimmed)) return res.status(409).json({ error: 'Cette catégorie existe déjà' });

  liste.push(trimmed);
  await db.collection('config').updateOne({ _id: 'categories' }, { $set: { liste } }, { upsert: true });
  await addLog('CATEGORIE_ADD', { categorie: trimmed }, req.session.user.id, req.session.user.nom_rp);
  res.json({ ok: true, base: CATEGORIES_BASE, custom: liste });
});

router.delete('/api/config/categories/:nom', requireAuth, requireRole('owner'), async (req, res) => {
  const nom = decodeURIComponent(req.params.nom);
  if (CATEGORIES_BASE.includes(nom)) return res.status(400).json({ error: 'Impossible de supprimer une catégorie de base' });

  const db = getDb();
  const doc = await db.collection('config').findOne({ _id: 'categories' });
  const liste = (doc?.liste || []).filter(c => c !== nom);
  await db.collection('config').updateOne({ _id: 'categories' }, { $set: { liste } }, { upsert: true });
  await addLog('CATEGORIE_DEL', { categorie: nom }, req.session.user.id, req.session.user.nom_rp);
  res.json({ ok: true, base: CATEGORIES_BASE, custom: liste });
});

// ---------------------------------------------------------------
// ZONES DE COHÉRENCE (liste simple de noms — page Config)
// ---------------------------------------------------------------
router.get('/api/config/zones', requireAuth, requireRole('agent'), async (req, res) => {
  const doc = await getDb().collection('config').findOne({ _id: 'zones' });
  res.json({ liste: doc?.liste || [] });
});

router.post('/api/config/zones', requireAuth, requireRole('owner'), async (req, res) => {
  const { nom } = req.body;
  if (!nom || !nom.trim()) return res.status(400).json({ error: 'Nom requis' });
  const trimmed = nom.trim();

  const db = getDb();
  const doc = await db.collection('config').findOne({ _id: 'zones' });
  const liste = doc?.liste || [];
  if (liste.includes(trimmed)) return res.status(409).json({ error: 'Cette zone existe déjà' });

  liste.push(trimmed);
  await db.collection('config').updateOne({ _id: 'zones' }, { $set: { liste } }, { upsert: true });
  await addLog('ZONE_ADD', { zone: trimmed }, req.session.user.id, req.session.user.nom_rp);
  res.json({ ok: true, liste });
});

router.delete('/api/config/zones/:nom', requireAuth, requireRole('owner'), async (req, res) => {
  const nom = decodeURIComponent(req.params.nom);
  const db = getDb();
  const doc = await db.collection('config').findOne({ _id: 'zones' });
  const liste = (doc?.liste || []).filter(z => z !== nom);
  await db.collection('config').updateOne({ _id: 'zones' }, { $set: { liste } }, { upsert: true });

  await db.collection('biens').updateMany({}, { $pull: { zones: nom } });

  await addLog('ZONE_DEL', { zone: nom }, req.session.user.id, req.session.user.nom_rp);
  res.json({ ok: true, liste });
});

// ---------------------------------------------------------------
// BLACKLIST VILLA
// ---------------------------------------------------------------
router.get('/api/blacklist-villa', requireAuth, requireRole('agent'), async (req, res) => {
  const liste = await getDb().collection('blacklist_villa').find().toArray();
  res.json(liste);
});

router.post('/api/blacklist-villa', requireAuth, requireRole('hg'), async (req, res) => {
  const { nom, discord_id, semaines, raison } = req.body;
  if (!nom || !discord_id) return res.status(400).json({ error: 'Nom et ID Discord requis' });

  const finDate = new Date(Date.now() + (Number(semaines) || 2) * 7 * 24 * 60 * 60 * 1000);
  const entry = { id: Date.now(), nom, discord_id, raison: raison || '', fin: finDate.toLocaleDateString('fr-FR'), fin_ts: finDate.getTime() };
  await getDb().collection('blacklist_villa').insertOne(entry);
  await addLog('BL_VILLA_ADD', { nom, raison }, req.session.user.id, req.session.user.nom_rp);
  res.json(entry);
});

router.delete('/api/blacklist-villa/:id', requireAuth, requireRole('hg'), async (req, res) => {
  const id = Number(req.params.id);
  const entry = await getDb().collection('blacklist_villa').findOne({ id });
  if (!entry) return res.status(404).json({ error: 'Introuvable' });
  await getDb().collection('blacklist_villa').deleteOne({ id });
  await addLog('BL_VILLA_DEL', { nom: entry.nom }, req.session.user.id, req.session.user.nom_rp);
  res.json({ ok: true });
});

// ---------------------------------------------------------------
// ACCÈS RESTREINT INDIVIDUEL (choix manuel du owner, indépendant du rôle)
// ---------------------------------------------------------------
router.get('/api/config/access-individuel', requireAuth, requireRole('agent'), async (req, res) => {
  const doc = await getDb().collection('config').findOne({ _id: 'access_individuel' });
  res.json({ liste: doc?.liste || [] });
});

router.post('/api/config/access-individuel', requireAuth, requireRole('owner'), async (req, res) => {
  const { discord_id, nom, raison } = req.body;
  if (!discord_id) return res.status(400).json({ error: 'ID Discord requis' });

  const db = getDb();
  const doc = await db.collection('config').findOne({ _id: 'access_individuel' });
  const liste = doc?.liste || [];
  if (liste.some(e => e.discord_id === discord_id)) {
    return res.status(409).json({ error: 'Ce membre est déjà restreint' });
  }

  const entry = {
    discord_id, nom: nom || '', raison: raison || '',
    ajoute_le: new Date().toLocaleDateString('fr-FR'),
    ajoute_par: req.session.user.nom_rp
  };
  liste.push(entry);
  await db.collection('config').updateOne({ _id: 'access_individuel' }, { $set: { liste } }, { upsert: true });
  await addLog('ACCESS_INDIV_ADD', { nom: nom || discord_id, raison }, req.session.user.id, req.session.user.nom_rp);
  res.json({ ok: true, liste });
});

router.delete('/api/config/access-individuel/:discordId', requireAuth, requireRole('owner'), async (req, res) => {
  const discordId = req.params.discordId;
  const db = getDb();
  const doc = await db.collection('config').findOne({ _id: 'access_individuel' });
  const entry = (doc?.liste || []).find(e => e.discord_id === discordId);
  const liste = (doc?.liste || []).filter(e => e.discord_id !== discordId);
  await db.collection('config').updateOne({ _id: 'access_individuel' }, { $set: { liste } }, { upsert: true });
  await addLog('ACCESS_INDIV_DEL', { nom: entry?.nom || discordId }, req.session.user.id, req.session.user.nom_rp);
  res.json({ ok: true, liste });
});

// ---------------------------------------------------------------
// BANS DISCORD — cache local + sync depuis l'API Discord
// Collection: config, doc unique { _id: 'discord_bans', liste: [...] }
// ---------------------------------------------------------------
router.get('/api/config/discord-bans', requireAuth, requireRole('agent'), async (req, res) => {
  const doc = await getDb().collection('config').findOne({ _id: 'discord_bans' });
  res.json({ liste: doc?.liste || [], derniere_sync: doc?.derniere_sync || null });
});

router.post('/api/config/discord-bans/sync', requireAuth, requireRole('owner'), async (req, res) => {
  try {
    const botToken = process.env.BOT_TOKEN;
    const guildId = process.env.GUILD_ID; // ← corrigé (était DISCORD_GUILD_ID)
    if (!botToken || !guildId) {
      return res.status(400).json({ error: 'BOT_TOKEN ou GUILD_ID manquant côté serveur' });
    }

    const axios = require('axios');
    const bans = [];
    let after = null;

    do {
      const url = `https://discord.com/api/v10/guilds/${guildId}/bans?limit=1000${after ? `&after=${after}` : ''}`;
      const resp = await axios.get(url, { headers: { Authorization: `Bot ${botToken}` } });
      bans.push(...resp.data);
      after = resp.data.length === 1000 ? resp.data[resp.data.length - 1].user.id : null;
    } while (after);

    const liste = bans.map(b => ({
      discord_id: b.user.id,
      pseudo_discord: b.user.username,
      raison: b.reason || '',
    }));

    await getDb().collection('config').updateOne(
      { _id: 'discord_bans' },
      { $set: { liste, derniere_sync: new Date() } },
      { upsert: true }
    );
    await addLog('DISCORD_BANS_SYNC', { count: liste.length }, req.session.user.id, req.session.user.nom_rp);
    res.json({ ok: true, liste, count: liste.length });
  } catch (e) {
    console.error('Erreur sync bans Discord:', e.response?.data || e.message);
    res.status(500).json({ error: "Échec de la synchro — vérifie BOT_TOKEN, GUILD_ID et la permission 'Bannir des membres' du bot" });
  }
});

// ---------------------------------------------------------------
// VÉRIFICATION D'ACCÈS RESTREINT (appelée au chargement du site)
// ---------------------------------------------------------------
router.get('/api/config/acces-restreint', requireAuth, async (req, res) => {
  if (req.session.user.role === 'owner') return res.json({ bloque: false });

  const db = getDb();
  const discordId = req.session.user.id;
  const [docIndiv, docBans] = await Promise.all([
    db.collection('config').findOne({ _id: 'access_individuel' }),
    db.collection('config').findOne({ _id: 'discord_bans' }),
  ]);

  const entryIndiv = (docIndiv?.liste || []).find(e => e.discord_id === discordId);
  if (entryIndiv) {
    return res.json({ bloque: true, source: 'individuel', raison: entryIndiv.raison || "Accès restreint par l'agence." });
  }

  const entryBan = (docBans?.liste || []).find(e => e.discord_id === discordId);
  if (entryBan) {
    return res.json({ bloque: true, source: 'discord_ban', raison: entryBan.raison || 'Banni du serveur Discord.' });
  }

  res.json({ bloque: false });
});

// ---------------------------------------------------------------
// SAUVEGARDE
// ---------------------------------------------------------------
router.post('/api/config/backup', requireAuth, requireRole('co_patron'), async (req, res) => {
  try {
    const db = getDb();
    const [ventes, membres, biens, decorateurs, blacklistVilla, blacklistDeco] = await Promise.all([
      db.collection('ventes').find().toArray(),
      db.collection('membres').find().toArray(),
      db.collection('biens').find().toArray(),
      db.collection('decorateurs').find().toArray(),
      db.collection('blacklist_villa').find().toArray(),
      db.collection('blacklist_deco').find().toArray(),
    ]);

    const snapshot = { date: new Date().toISOString(), ventes, membres, biens, decorateurs, blacklistVilla, blacklistDeco };

    await addLog('BACKUP_MANUEL', { message: 'Backup déclenché manuellement' }, req.session.user.id, req.session.user.nom_rp);
    res.json(snapshot);
  } catch (e) {
    console.error('Erreur backup:', e);
    res.status(500).json({ error: 'Erreur lors de la génération du backup' });
  }
});

// ---------------------------------------------------------------
// EXPORT DE DONNÉES
// ---------------------------------------------------------------
function toCsv(entetes, lignes) {
  const escape = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [entetes, ...lignes].map(l => l.map(escape).join(';'));
  return '\uFEFF' + rows.join('\r\n');
}

router.get('/api/export/ventes', requireAuth, requireRole('hg'), async (req, res) => {
  const ventes = await getDb().collection('ventes').find().toArray();
  const entetes = ['Date','Bien','Type','Prix','Commission','Semaines','Client','Tél','Agent'];
  const lignes = ventes.map(v => [v.date, v.bien, v.type, v.prix, v.commission, v.semaines, v.client, v.tel, v.agent_nom]);
  const csv = toCsv(entetes, lignes);

  await addLog('EXPORT_VENTES', { count: ventes.length }, req.session.user.id, req.session.user.nom_rp);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="ventes_dynasty8_${new Date().toISOString().split('T')[0]}.csv"`);
  res.send(csv);
});

router.get('/api/export/membres', requireAuth, requireRole('hg'), async (req, res) => {
  const membres = await getDb().collection('membres').find().toArray();
  const entetes = ['Nom RP','Nom HRP','ID Discord','Rôle'];
  const lignes = membres.map(m => [m.nom_rp, m.nom_hrp, m.discord_id, m.role]);
  const csv = toCsv(entetes, lignes);

  await addLog('EXPORT_MEMBRES', { count: membres.length }, req.session.user.id, req.session.user.nom_rp);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="membres_dynasty8_${new Date().toISOString().split('T')[0]}.csv"`);
  res.send(csv);
});

// ---------------------------------------------------------------
// WEBHOOKS & BOT DISCORD
// ---------------------------------------------------------------
router.get('/api/config/webhooks', requireAuth, requireRole('owner'), async (req, res) => {
  const doc = await getDb().collection('config').findOne({ _id: 'webhooks' });
  res.json({
    ventes: doc?.ventes || process.env.WEBHOOK_VENTES || '',
    compta: doc?.compta || process.env.WEBHOOK_COMPTA || '',
    logs: doc?.logs || process.env.WEBHOOK_LOGS || '',
    botTokenDefini: !!(doc?.botToken || process.env.BOT_TOKEN),
  });
});

router.post('/api/config/webhooks', requireAuth, requireRole('owner'), async (req, res) => {
  const { ventes, compta, logs, botToken } = req.body;
  const maj = { updated_at: new Date(), updated_by: req.session.user.id };
  if (ventes !== undefined) maj.ventes = ventes;
  if (compta !== undefined) maj.compta = compta;
  if (logs !== undefined) maj.logs = logs;
  if (botToken) maj.botToken = botToken;

  await getDb().collection('config').updateOne({ _id: 'webhooks' }, { $set: maj }, { upsert: true });
  await addLog('CONFIG_WEBHOOKS', { message: 'Webhooks mis à jour' }, req.session.user.id, req.session.user.nom_rp);
  res.json({ ok: true });
});

router.post('/api/config/webhooks/test', requireAuth, requireRole('owner'), async (req, res) => {
  const { cible } = req.body;
  if (!['ventes', 'compta', 'logs'].includes(cible)) {
    return res.status(400).json({ error: 'Cible invalide' });
  }
  try {
    const doc = await getDb().collection('config').findOne({ _id: 'webhooks' });
    const url = doc?.[cible] || process.env[`WEBHOOK_${cible.toUpperCase()}`];
    if (!url) return res.status(400).json({ error: 'Aucune URL configurée pour ce webhook' });

    const axios = require('axios');
    await axios.post(url, { content: `🔌 Test webhook "${cible}" déclenché par ${req.session.user.nom_rp}` });
    res.json({ ok: true });
  } catch (e) {
    console.error('Erreur test webhook:', e.response?.data || e.message);
    res.status(500).json({ error: "Échec de l'envoi — vérifie l'URL du webhook" });
  }
});

// ---------------------------------------------------------------
// ZONES SHAPES (éditeur svg.html → carte.html)
// Collection: config, doc unique { _id: 'zones_shapes', zones: [...] }
// ---------------------------------------------------------------
router.get('/api/zones-shapes', async (req, res) => {
  // ⚠️ Publique volontairement : carte.html doit être visible sans connexion owner
  const doc = await getDb().collection('config').findOne({ _id: 'zones_shapes' });
  res.json(doc?.zones || []);
});

router.put('/api/zones-shapes', requireAuth, requireRole('owner'), async (req, res) => {
  const { zones } = req.body;
  if (!Array.isArray(zones)) return res.status(400).json({ error: 'zones doit être un tableau' });

  await getDb().collection('config').updateOne(
    { _id: 'zones_shapes' },
    { $set: { zones, updated_at: new Date(), updated_by: req.session.user.id } },
    { upsert: true }
  );
  await addLog('ZONES_SHAPES_MAJ', { count: zones.length }, req.session.user.id, req.session.user.nom_rp);
  res.json({ ok: true, zones });
});

// ---------------------------------------------------------------
// VIDÉOS / PHOTOS DE DÉCORATION SUR LES BIENS
// Collection: biens_videos { id, bien, nom, url, tel, prix, type, photos[], ajoute_par_id, ajoute_par }
// ---------------------------------------------------------------
router.get('/api/biens-videos', requireAuth, requireRole('client'), async (req, res) => {
  const liste = await getDb().collection('biens_videos').find().toArray();
  const parBien = {};
  liste.forEach(d => {
    if (!parBien[d.bien]) parBien[d.bien] = [];
    parBien[d.bien].push(d);
  });
  res.json(parBien);
});

router.post('/api/biens-videos', requireAuth, requireRole('decorateur'), async (req, res) => {
  const { bien, nom, url, tel, prix, type, photos } = req.body;
  if (!bien || !nom || !url) return res.status(400).json({ error: 'Bien, nom et url/photo requis' });

  const peutGerer = ['staff', 'co_patron', 'owner'].includes(req.session.user.role) || req.session.user.isDecorateur;
  if (!peutGerer) return res.status(403).json({ error: 'Accès refusé' });

  const entry = {
    id: Date.now(), bien, nom, url,
    tel: tel || '', prix: prix != null ? Number(prix) : null,
    type: type === 'photo' ? 'photo' : 'video',
    photos: Array.isArray(photos) ? photos : null,
    ajoute_par_id: req.session.user.id,
    ajoute_par: req.session.user.nom_rp
  };
  await getDb().collection('biens_videos').insertOne(entry);
  await addLog('DECO_ADD', { nom, bien }, req.session.user.id, req.session.user.nom_rp);
  res.json(entry);
});

router.patch('/api/biens-videos/:bien/:id', requireAuth, requireRole('decorateur'), async (req, res) => {
  const bien = decodeURIComponent(req.params.bien);
  const id = Number(req.params.id);
  const doc = await getDb().collection('biens_videos').findOne({ id, bien });
  if (!doc) return res.status(404).json({ error: 'Introuvable' });

  const peutGerer = ['staff', 'co_patron', 'owner'].includes(req.session.user.role) || String(doc.ajoute_par_id) === String(req.session.user.id);
  if (!peutGerer) return res.status(403).json({ error: 'Accès refusé' });

  const { nom, url, tel, prix, photos } = req.body;
  const maj = {};
  if (nom !== undefined) maj.nom = nom;
  if (url !== undefined) maj.url = url;
  if (tel !== undefined) maj.tel = tel;
  if (prix !== undefined) maj.prix = prix != null ? Number(prix) : null;
  if (photos !== undefined) maj.photos = photos;

  await getDb().collection('biens_videos').updateOne({ id, bien }, { $set: maj });
  const updated = await getDb().collection('biens_videos').findOne({ id, bien });
  await addLog('DECO_EDIT', { nom: updated.nom, bien }, req.session.user.id, req.session.user.nom_rp);
  res.json(updated);
});

router.delete('/api/biens-videos/:bien/:id', requireAuth, requireRole('decorateur'), async (req, res) => {
  const bien = decodeURIComponent(req.params.bien);
  const id = Number(req.params.id);
  const doc = await getDb().collection('biens_videos').findOne({ id, bien });
  if (!doc) return res.status(404).json({ error: 'Introuvable' });

  const peutGerer = ['staff', 'co_patron', 'owner'].includes(req.session.user.role) || String(doc.ajoute_par_id) === String(req.session.user.id);
  if (!peutGerer) return res.status(403).json({ error: 'Accès refusé' });

  await getDb().collection('biens_videos').deleteOne({ id, bien });
  await addLog('DECO_DEL', { nom: doc.nom, bien }, req.session.user.id, req.session.user.nom_rp);
  res.json({ ok: true });
});

module.exports = router;