// Encrypts a value using the exact same scheme as lib/waEncryption.ts
// (AES-256-CBC, "iv_hex:ciphertext_hex"), so the output can be stored in
// clients.database_url_enc and decrypted correctly by the app.
//
// Usage:
//   ENCRYPTION_KEY=<your key> node scripts/encrypt-value.js "postgres://user:pass@host:5432/dbname"
//
// Then paste the printed value into:
//   UPDATE public.clients SET database_url_enc = '<printed value>' WHERE slug = 'candid-schools';

const crypto = require('crypto')

const plaintext = process.argv[2]
if (!plaintext) {
  console.error('Usage: node scripts/encrypt-value.js "<value to encrypt>"')
  process.exit(1)
}

const hexKey = process.env.ENCRYPTION_KEY
if (!hexKey) {
  console.error('ENCRYPTION_KEY env var is required (same value as in Vercel).')
  process.exit(1)
}
const key = Buffer.from(hexKey, 'hex')
if (key.length !== 32) {
  console.error('ENCRYPTION_KEY must be a 32-byte hex string (64 hex characters).')
  process.exit(1)
}

const iv = crypto.randomBytes(16)
const cipher = crypto.createCipheriv('aes-256-cbc', key, iv)
const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
const payload = iv.toString('hex') + ':' + encrypted.toString('hex')

console.log(payload)
