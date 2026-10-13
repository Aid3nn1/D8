// ================================================================
//  ROUTES AUTH — connexion Discord OAuth2, session, /auth/me
// ================================================================
const express = require('express');
const axios = require('axios');
const router = express.Router();
const { getDb } = require('../db');
const { addLog } = require('../logger');
const { ROLE_MAP, ROLE_LEVELS } = require('../config');

router.get('/auth/discord', (_req, res) => {
  const params = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID,
    redirect_uri: process.env.REDIRECT_URI,
    response_type: 'code',
    scope: 'identify guilds.members.read',
  });
  res.redirect(`https://discord.com/oauth2/authorize?${params}`);
});

router.get('/auth/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.redirect(`${process.env.SITE_URL}?auth=error`);

  try {
    const tokenRes = await axios.post(
      'https://discord.com/api/oauth2/token',
      new URLSearchParams({
        client_id: process.env.DISCORD_CLIENT_ID,
        client_secret: process.env.DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: process.env.REDIRECT_URI,
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    const accessToken = tokenRes.data.access_token;

    const userRes = await axios.get('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const discordUser = userRes.data;

    // Rôles + pseudo serveur (nick) — absent si pas membre du serveur (= client)
    let memberRes = null;
    try {
      memberRes = await axios.get(
        `https://discord.com/api/users/@me/guilds/${process.env.GUILD_ID}/member`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
    } catch (e) {
      console.log(`${discordUser.username} n'est pas membre du serveur — connexion en tant que client.`);
    }

    const discordRoles = memberRes?.data?.roles || [];
    let role = 'decorateur'; // rôle le plus bas par défaut si aucun rôle de la hiérarchie n'est trouvé
    let aTrouveUnRole = false;
    for (const [discordRoleId, r] of Object.entries(ROLE_MAP)) {
      if (discordRoleId && discordRoles.includes(discordRoleId)) {
        aTrouveUnRole = true;
        if ((ROLE_LEVELS[r] ?? 0) > (ROLE_LEVELS[role] ?? 0)) role = r;
      }
    }
    if (!aTrouveUnRole) role = 'client'; // aucun rôle Dynasty 8 = simple visiteur

    const db = getDb();
    const membreExistant = await db.collection('membres').findOne({ discord_id: discordUser.id });

    const membre = {
      discord_id: discordUser.id,
      nom_rp: memberRes?.data?.nick || discordUser.global_name || discordUser.username,
      nom_hrp: discordUser.username,
      role,
      isDecorateur: membreExistant?.isDecorateurManuel || role === 'decorateur' || ['staff', 'co_patron', 'owner'].includes(role),
      actif: 1,
    };

    if (role === 'client') {
      if (membreExistant && membreExistant.role !== 'owner') {
        await db.collection('membres').deleteOne({ discord_id: discordUser.id });
        await addLog('MEMBRE_DEL', { membre: membreExistant.nom_rp, role: membreExistant.role }, discordUser.id, membre.nom_rp);
      }
    } else if (membreExistant) {
      await db.collection('membres').updateOne({ discord_id: discordUser.id }, { $set: membre });
    } else {
      await db.collection('membres').insertOne(membre);
    }

    req.session.user = {
      id: discordUser.id,
      nom_rp: membre.nom_rp,
      nom_hrp: membre.nom_hrp,
      avatar: discordUser.avatar
        ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png`
        : null,
      role: membre.role,
      isDecorateur: membre.isDecorateur,
    };

    await addLog('LOGIN', { message: `Connexion de ${req.session.user.nom_rp}` }, discordUser.id, req.session.user.nom_rp);
    res.redirect(`${process.env.SITE_URL}?auth=success`);
  } catch (err) {
    console.error('Erreur OAuth2:', err.response?.data || err.message);
    res.redirect(`${process.env.SITE_URL}?auth=error`);
  }
});

router.get('/auth/me', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Non connecté' });
  res.json(req.session.user);
});

router.get('/auth/logout', async (req, res) => {
  if (req.session.user) {
    await addLog('LOGOUT', { message: `Déconnexion de ${req.session.user.nom_rp}` }, req.session.user.id, req.session.user.nom_rp);
  }
  req.session.destroy(() => res.json({ ok: true }));
});

module.exports = router;