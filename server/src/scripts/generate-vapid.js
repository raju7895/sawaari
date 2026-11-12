/* Prints a fresh VAPID keypair for web push. Put values in server/.env */
const webpush = require('web-push');

const keys = webpush.generateVAPIDKeys();
console.log('\nAdd these to server/.env:\n');
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}\n`);
