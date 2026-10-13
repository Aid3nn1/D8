// ================================================================
//  DB — connexion MongoDB (une seule connexion réutilisée partout)
// ================================================================
require('dotenv').config({ path: 'key.env' });
const { MongoClient } = require('mongodb');

let client = null;
let db = null;

async function connectMongo() {
  if (db) return db;
  if (!process.env.MONGODB_URI) {
    console.error('❌ MONGODB_URI manquant dans key.env — arrêt du serveur.');
    process.exit(1);
  }
  client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  db = client.db('dynasty8');
  console.log('✅ Connecté à MongoDB');

  // Index utiles — évite les doublons et accélère les recherches courantes
  await db.collection('membres').createIndex({ discord_id: 1 }, { unique: true });
  await db.collection('ventes').createIndex({ id: 1 }, { unique: true });
  await db.collection('encheres').createIndex({ id: 1 }, { unique: true });
  await db.collection('logs').createIndex({ created_at: -1 });

  return db;
}

function getDb() {
  if (!db) throw new Error('DB non initialisée — appelle connectMongo() avant getDb().');
  return db;
}

module.exports = { connectMongo, getDb, mongoClient: () => client };