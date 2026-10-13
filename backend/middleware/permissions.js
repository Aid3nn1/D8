// ================================================================
//  MIDDLEWARE — protège les routes selon la session + le rôle.
//  Usage dans une route :
//    router.get('/api/ventes', requireAuth, requireRole('agent'), handler)
// ================================================================
const { hasServerPermission } = require('../config');

function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'Non connecté' });
  next();
}

function requireRole(minRole) {
  return (req, res, next) => {
    if (!req.session.user) return res.status(401).json({ error: 'Non connecté' });
    if (!hasServerPermission(req.session.user.role, minRole)) {
      return res.status(403).json({ error: 'Accès refusé' });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole };