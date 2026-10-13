// ================================================================
//  CLOUDINARY — upload des photos (biens, enchères, décorations,
//  avatars décorateurs). Un seul endpoint générique /api/upload-photos
//  est utilisé par tout le frontend (voir main.js: FileReader → puis,
//  une fois branché, remplacer par un vrai POST multipart ici).
// ================================================================
require('dotenv').config({ path: 'key.env' });
const cloudinary = require('cloudinary').v2;
const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'dynasty8',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
    transformation: [{ width: 1600, crop: 'limit', quality: 'auto' }],
  },
});

// upload.array('photos') → req.files[].path contient l'URL Cloudinary finale
const upload = multer({ storage, limits: { fileSize: 15 * 1024 * 1024 } }); // 15 Mo max/photo

module.exports = { cloudinary, upload };