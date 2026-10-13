// ================================================================
//  DEPLOY-COMMANDS — enregistre les slash commands sur le serveur.
//  ⚠️ Ce fichier vit dans backend/discord/. Le require('dotenv') ci-
//  dessous charge 'key.env' relativement au dossier d'exécution
//  (process.cwd()), donc lance-le TOUJOURS depuis backend/ :
//    cd /root/dynasty8/backend && node discord/deploy-commands.js
// ================================================================
require('dotenv').config({ path: 'key.env' });
const { REST, Routes, SlashCommandBuilder } = require('discord.js');

const commands = [
  new SlashCommandBuilder()
    .setName('service')
    .setDescription('Ouvre le panneau de prise / fin de service'),

  new SlashCommandBuilder()
    .setName('finservice')
    .setDescription("Clôture de force le service d'un agent (staff+)")
    .addStringOption(option =>
      option.setName('id')
        .setDescription("ID Discord de l'agent à clôturer")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Vérifie que le bot Dynasty 8 répond'),

  new SlashCommandBuilder()
    .setName('uptime')
    .setDescription('Affiche depuis combien de temps le bot tourne'),

  new SlashCommandBuilder()
    .setName('stats')
    .setDescription("Résumé rapide de l'agence"),

  new SlashCommandBuilder()
    .setName('statsglobal')
    .setDescription("Statistiques complètes de l'agence (ventes, volume, commissions, membres...)"),

  new SlashCommandBuilder()
    .setName('agent')
    .setDescription("Affiche les statistiques d'un agent précis")
    .addStringOption(option =>
      option.setName('nom')
        .setDescription('Nom RP de l\'agent')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('derniere-vente')
    .setDescription('Affiche la dernière vente enregistrée'),

  new SlashCommandBuilder()
    .setName('service-liste')
    .setDescription('Liste les agents actuellement en service'),

  new SlashCommandBuilder()
    .setName('encheres')
    .setDescription('Liste les ventes aux enchères en cours'),

  new SlashCommandBuilder()
    .setName('blacklist-check')
    .setDescription('Vérifie si un ID Discord / nom est blacklisté (villa et/ou déco)')
    .addStringOption(option =>
      option.setName('id')
        .setDescription('ID Discord (villa) ou nom (déco) à vérifier')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('bl-resa-villa')
    .setDescription('Blacklist un membre pour la réservation villa (hg+)')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('Membre Discord à blacklister')
        .setRequired(false)
    )
    .addStringOption(option =>
      option.setName('id')
        .setDescription('ID Discord (si le membre n\'est plus sur le serveur)')
        .setRequired(false)
    )
    .addIntegerOption(option =>
      option.setName('semaines')
        .setDescription('Durée de la blacklist en semaines (défaut : 2)')
        .setRequired(false)
    )
    .addStringOption(option =>
      option.setName('raison')
        .setDescription('Raison de la blacklist')
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('unbl-resa-villa')
    .setDescription('Retire un membre de la blacklist villa (hg+)')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('Membre Discord à retirer de la blacklist')
        .setRequired(false)
    )
    .addStringOption(option =>
      option.setName('id')
        .setDescription('ID Discord (si le membre n\'est plus sur le serveur)')
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('bl-list')
    .setDescription('Affiche/actualise la liste des blacklists villa actives'),

  new SlashCommandBuilder()
    .setName('help')
    .setDescription('Affiche la liste de toutes les commandes disponibles'),
].map(cmd => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);

(async () => {
  try {
    if (!process.env.DISCORD_CLIENT_ID || !process.env.GUILD_ID) {
      console.error('❌ DISCORD_CLIENT_ID ou GUILD_ID manquant dans key.env');
      process.exit(1);
    }
    console.log('⏳ Enregistrement des commandes slash...');
    await rest.put(
      Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, process.env.GUILD_ID),
      { body: commands }
    );
    console.log(`✅ ${commands.length} commande(s) enregistrée(s) sur le serveur.`);
  } catch (e) {
    console.error('❌ Erreur déploiement commandes:', e);
  }
})();