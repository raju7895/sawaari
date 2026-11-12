/* Confirms that the password the .env parser produced is exactly the one
   stored for the platform owner (guards against silent .env truncation). */
const bcrypt = require('bcryptjs');
const config = require('../config');
const { one } = require('../db');

(async () => {
  const email = config.admin.superAdmin.email;
  const envPassword = config.admin.superAdmin.password || '';
  const user = await one('SELECT id, password_hash FROM users WHERE lower(email) = lower($1)', [email]);
  if (!user) {
    console.log('✖ owner account missing');
    process.exit(1);
  }
  const matches = await bcrypt.compare(envPassword, user.password_hash);
  console.log(`env value length seen by dotenv : ${envPassword.length}`);
  console.log(`stored hash is bcrypt cost ${user.password_hash.split('$')[2]} : ${/^\$2[aby]\$\d{2}\$.{53}$/.test(user.password_hash)}`);
  console.log(`env password matches the stored hash : ${matches}`);
  if (!matches) process.exit(1);
  await require('../db').pool.end();
})();
