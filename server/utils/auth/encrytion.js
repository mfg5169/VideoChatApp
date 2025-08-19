const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');

const filePath = path.join(__dirname, '../../config/env.encrytion.json');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '../../.env') });


// 🔐 1. Generate and Save a New JWT Secret
function generateAndSaveJWTSecret(passphrase) {
  const secret = crypto.randomBytes(64).toString('base64');
  console.log('✅ Generated new JWT secret');
  encryptSecret(secret, passphrase);
}

// 🔒 2. Encrypt a secret and save it
function encryptSecret(secret, passphrase) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12); // AES-GCM standard IV size

  // console.log("salt: ", salt.toString('hex'));
  // console.log("iv: ", iv.toString('hex'));
  // console.log("passphrase: ", passphrase);
  // console.log("passphrase type: ", typeof passphrase);

  const key = crypto.pbkdf2Sync(passphrase, salt, 100_000, 32, 'sha256');

  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  let encrypted = cipher.update(secret, 'utf8');
  encrypted = Buffer.concat([encrypted, cipher.final()]);

  const authTag = cipher.getAuthTag();

  const payload = {
    salt: salt.toString('hex'),
    iv: iv.toString('hex'),
    tag: authTag.toString('hex'),
    ciphertext: encrypted.toString('hex')
  };

  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
  console.log(`🔐 Encrypted and saved JWT_SECRET to ${filePath}`);
}

// 🔓 3. Decrypt and return the secret
function decryptSecret(passphrase) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`❌ Encrypted file not found: ${filePath}`);
  }

  const encryptedData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const salt = Buffer.from(encryptedData.salt, 'hex');
  const iv = Buffer.from(encryptedData.iv, 'hex');
  const authTag = Buffer.from(encryptedData.tag, 'hex');
  const ciphertext = Buffer.from(encryptedData.ciphertext, 'hex');

  const key = crypto.pbkdf2Sync(passphrase, salt, 100_000, 32, 'sha256');

  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(ciphertext, null, 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (e) {
    throw new Error('❌ Decryption failed: Invalid passphrase or data.');
  }
}

// 🧪 Example usage (uncomment to run manually)
/*
const passphrase = 'your-strong-passphrase';

// generateAndSaveJWTSecret(passphrase);
// console.log('Decrypted:', decryptSecret(passphrase));
*/
async function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const accessToken = authHeader && authHeader.split(' ')[1];
  const refreshToken = req.cookies && req.cookies.refreshToken; // Expect refresh token in cookies

  if (!accessToken) {
    return res.status(401).json({ error: 'Access token required' });
  }
  const JWT_SECRET = decryptSecret(process.env.JWT_PASSPHRASE);


  jwt.verify(accessToken, JWT_SECRET, async (err, user) => {
    if (!err) {
      req.user = user;
      return next();
    }

    // If token expired, try to use refresh token
    if (err.name === 'TokenExpiredError' && refreshToken) {
      try {
        // Verify refresh token
        jwt.verify(refreshToken, JWT_SECRET, (refreshErr, refreshUser) => {
          if (refreshErr) {
            return res.status(403).json({ error: 'Invalid or expired refresh token' });
          }

          // Optionally: check refresh token validity in DB here

          // Issue new access token
          const newAccessToken = jwt.sign(
            { userId: refreshUser.userId, username: refreshUser.username },
            JWT_SECRET,
            { expiresIn: '15m' }
          );

          // Attach new access token to response header
          res.setHeader('Authorization', `Bearer ${newAccessToken}`);
          req.user = refreshUser;
          next();
        });
      } catch (refreshError) {
        return res.status(403).json({ error: 'Invalid or expired refresh token' });
      }
    } else {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
  });
}


module.exports = {
  generateAndSaveJWTSecret,
  encryptSecret,
  decryptSecret,
  authenticateToken
};
