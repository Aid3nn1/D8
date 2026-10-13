// ================================================================
//  DYNASTY 8 — SERVER.JS
//  Point d'entrée : sessions, CORS, montage des routes.
//  La logique métier vit dans routes/*.js — ce fichier reste court.
// ================================================================
require('dotenv').config({ path: 'key.env' });
const express = require('express');
try { require('express-async-errors'); } catch (_) { console.warn('⚠️ express-async-errors absent — erreurs async des routes non interceptées'); } // 🐞 erreurs des routes async → errorHandler (retire cette ligne si tu es sur Express 5)
const session = require('express-session');
const MongoStore = require('connect-mongo');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');

const { connectMongo } = require('./db');
const { upload } = require('./cloudinary');
const bot = require('./discord/bot');
const { requestTracker, errorHandler, installProcessHandlers } = require('./errorTracker'); // 🐞

installProcessHandlers(); // 🐞 unhandledRejection / uncaughtException (bot, timers, sockets...)

async function start() {
  await connectMongo();

  const app = express();
  app.use(cors({ origin: [process.env.SITE_URL], credentials: true }));
  app.use(express.json({ limit: '20mb' }));
  app.set('trust proxy', 1);

  if (!process.env.SESSION_SECRET) {
    console.error('❌ SESSION_SECRET manquant dans key.env — arrêt du serveur.');
    process.exit(1);
  }

  app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
      mongoUrl: process.env.MONGODB_URI,
      dbName: 'dynasty8',
      collectionName: 'sessions',
      ttl: 24 * 60 * 60,
      touchAfter: 15 * 60, // secondes : la session n'est réécrite en base qu'une fois toutes les 15 min
    }),
    cookie: { secure: true, httpOnly: true, maxAge: 24 * 60 * 60 * 1000, sameSite: 'none' },
  }));

  app.use(requestTracker); // 🐞 enregistre toute réponse 5xx (sauf 502) — après la session, avant les routes

  // ---- Santé du serveur (utilisé par monitor.js) ----
  app.get('/ping', (_req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

  // ---- Upload générique de photos (Cloudinary) ----
  // Utilisé par : créer un bien, une enchère, une décoration, un avatar décorateur.
  app.post('/api/upload-photos', upload.array('photos'), (req, res) => {
    if (!req.session?.user) return res.status(401).json({ error: 'Non connecté' });
    const urls = req.files.map(f => f.path);
    res.json({ urls });
  });

  // ---- Routes ----
  app.use(require('./routes/auth'));
  app.use(require('./routes/membres'));
  app.use(require('./routes/ventes'));
  app.use(require('./routes/config'));
  app.use(require('./routes/config-agence'));
  app.use(require('./routes/config-deco'));
  app.use(require('./routes/logs'));
  app.use(require('./routes/encheres'));
  app.use(require('./routes/service'));
  app.use(require('./routes/errors')); // 🐞 journal d'erreurs (page Config)

  app.use(errorHandler); // 🐞 TOUJOURS en dernier, après toutes les routes

  const httpServer = http.createServer(app);
  const io = new Server(httpServer, { cors: { origin: [process.env.SITE_URL], credentials: true } });
  bot.setSocketIO(io);

  io.on('connection', (socket) => {
    console.log('🔌 Client connecté:', socket.id);
    socket.on('disconnect', () => console.log('🔌 Client déconnecté:', socket.id));
  });

  const PORT = process.env.PORT || 3000;
  httpServer.listen(PORT, async () => {
    console.log('✅ Dynasty 8 backend — port', PORT);
    console.log('   OAuth2 callback :', process.env.REDIRECT_URI);
    console.log('   Site autorisé   :', process.env.SITE_URL);
    await bot.login();
  });
}

start().catch(err => {
  console.error('❌ Erreur au démarrage du serveur:', err);
  process.exit(1);
});