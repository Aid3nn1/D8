// ================================================================
//  CONFIG — hiérarchie des rôles & accès aux pages.
//  IMPORTANT : ces valeurs doivent rester identiques à ROLE_CONFIG
//  et ROLE_LEVELS dans main.js (frontend), sinon front et back ne
//  seront plus d'accord sur qui peut faire quoi.
// ================================================================
require('dotenv').config({ path: 'key.env' });

// owner > co_patron > staff > hg > agent > décorateur
const ROLE_LEVELS = {
  client: 0,
  decorateur: 0.5,
  agent: 1,
  hg: 2,
  staff: 3,
  co_patron: 4,
  owner: 5,
};

const ROLE_LABEL = {
  decorateur: 'DÉCORATEUR',
  agent: 'AGENT IMMO',
  hg: 'HG',
  staff: 'STAFF',
  co_patron: 'CO-PATRON',
  owner: 'OWNER',
};

// ID de rôle Discord -> rôle interne du site (rempli depuis key.env)
const ROLE_MAP = {
  [process.env.ROLE_ID_OWNER]: 'owner',
  [process.env.ROLE_ID_CO_PATRON]: 'co_patron',
  [process.env.ROLE_ID_STAFF]: 'staff',
  [process.env.ROLE_ID_HG]: 'hg',
  [process.env.ROLE_ID_AGENT]: 'agent',
  [process.env.ROLE_ID_DECORATEUR]: 'decorateur',
};

// Rôle minimum requis par page — reflète MATRICE_PERMISSIONS du frontend.
const PAGE_ACCESS = {
  ventes: 'agent',
  ressources: 'agent',
  monEspace: 'agent',
  statistiques: 'hg',
  encheres: 'staff',
  permissions: 'staff',
  config: 'owner',
  // logs : cas particulier, géré à part (décorateur voit un sous-ensemble)
};

function hasServerPermission(role, requiredRole) {
  return (ROLE_LEVELS[role] ?? 0) >= (ROLE_LEVELS[requiredRole] ?? 99);
}

module.exports = {
  ROLE_LEVELS,
  ROLE_LABEL,
  ROLE_MAP,
  PAGE_ACCESS,
  hasServerPermission,
};