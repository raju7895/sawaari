/* Database integrity report: migrations applied, foreign keys valid,
   orphan rows, index coverage and row counts per table. */
const { query, pool } = require('../db');

(async () => {
  console.log('── Migrations ──');
  const applied = await query('SELECT name, applied_at FROM schema_migrations ORDER BY name');
  for (const m of applied.rows) console.log(`  ✔ ${m.name} (${m.applied_at.toISOString().slice(0, 19)}Z)`);

  console.log('\n── Tables and row counts ──');
  const tables = await query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name`
  );
  for (const t of tables.rows) {
    const { rows } = await query(`SELECT count(*)::int AS c FROM "${t.table_name}"`);
    console.log(`  ${String(rows[0].c).padStart(6)}  ${t.table_name}`);
  }

  console.log('\n── Foreign keys (unvalidated = orphan risk) ──');
  const fks = await query(
    `SELECT conname, conrelid::regclass::text AS tbl, confrelid::regclass::text AS ref, convalidated
       FROM pg_constraint WHERE contype='f' ORDER BY tbl`
  );
  const unvalidated = fks.rows.filter((f) => !f.convalidated);
  console.log(`  ${fks.rows.length} foreign keys, ${unvalidated.length} unvalidated`);
  unvalidated.forEach((f) => console.log(`  ! ${f.conname} on ${f.tbl} → ${f.ref}`));

  console.log('\n── Orphan check (rows whose parent is missing) ──');
  const orphanQueries = [
    ['bookings.passenger_id → users', 'SELECT count(*)::int AS c FROM bookings b LEFT JOIN users u ON u.id=b.passenger_id WHERE u.id IS NULL'],
    ['bookings.driver_profile_id → driver_profiles', 'SELECT count(*)::int AS c FROM bookings b LEFT JOIN driver_profiles dp ON dp.id=b.driver_profile_id WHERE b.driver_profile_id IS NOT NULL AND dp.id IS NULL'],
    ['payments.booking_id → bookings', 'SELECT count(*)::int AS c FROM payments p LEFT JOIN bookings b ON b.id=p.booking_id WHERE b.id IS NULL'],
    ['driver_earnings.booking_id → bookings', 'SELECT count(*)::int AS c FROM driver_earnings de LEFT JOIN bookings b ON b.id=de.booking_id WHERE b.id IS NULL'],
    ['reviews.booking_id → bookings', 'SELECT count(*)::int AS c FROM reviews r LEFT JOIN bookings b ON b.id=r.booking_id WHERE b.id IS NULL'],
    ['admin_profiles.user_id → users', 'SELECT count(*)::int AS c FROM admin_profiles ap LEFT JOIN users u ON u.id=ap.user_id WHERE u.id IS NULL'],
    ['notifications.user_id → users', 'SELECT count(*)::int AS c FROM notifications n LEFT JOIN users u ON u.id=n.user_id WHERE u.id IS NULL'],
    ['support_tickets.user_id → users', 'SELECT count(*)::int AS c FROM support_tickets t LEFT JOIN users u ON u.id=t.user_id WHERE u.id IS NULL'],
    ['user_reports.reporter_id → users', 'SELECT count(*)::int AS c FROM user_reports r LEFT JOIN users u ON u.id=r.reporter_id WHERE u.id IS NULL'],
    ['user_reports.against_user_id → users', 'SELECT count(*)::int AS c FROM user_reports r LEFT JOIN users u ON u.id=r.against_user_id WHERE u.id IS NULL'],
    ['sos_alerts.user_id → users', 'SELECT count(*)::int AS c FROM sos_alerts s LEFT JOIN users u ON u.id=s.user_id WHERE u.id IS NULL'],
    ['admin_audit_log.admin_id → users', 'SELECT count(*)::int AS c FROM admin_audit_log a LEFT JOIN users u ON u.id=a.admin_id WHERE a.admin_id IS NOT NULL AND u.id IS NULL'],
  ];
  let orphanTotal = 0;
  for (const [label, sql] of orphanQueries) {
    const { rows } = await query(sql);
    const c = rows[0].c;
    orphanTotal += c;
    console.log(`  ${c === 0 ? '✔' : '✖'} ${label}: ${c} orphan(s)`);
  }

  console.log('\n── Indexes ──');
  const idx = await query(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE indexdef IS NOT NULL)::int AS defined
       FROM pg_indexes WHERE schemaname='public'`
  );
  console.log(`  ${idx.rows[0].total} indexes defined on public tables`);

  console.log('\n── Data integrity ──');
  const checks = [
    ['users without a password hash', 'SELECT count(*)::int AS c FROM users WHERE password_hash IS NULL OR password_hash NOT LIKE \'$2%\' AND password_hash NOT LIKE \'$argon2%\''],
    ['drivers without a profile', 'SELECT count(*)::int AS c FROM users u WHERE u.role=\'driver\' AND NOT EXISTS (SELECT 1 FROM driver_profiles dp WHERE dp.user_id=u.id)'],
    ['passengers without a profile', 'SELECT count(*)::int AS c FROM users u WHERE u.role=\'passenger\' AND NOT EXISTS (SELECT 1 FROM passenger_profiles pp WHERE pp.user_id=u.id)'],
    ['admins without an admin profile', 'SELECT count(*)::int AS c FROM users u WHERE u.role IN (\'admin\',\'super_admin\',\'finance_admin\',\'support_admin\',\'driver_manager\',\'moderator\') AND NOT EXISTS (SELECT 1 FROM admin_profiles ap WHERE ap.user_id=u.id)'],
    ['completed rides without a fare', 'SELECT count(*)::int AS c FROM bookings WHERE status=\'completed\' AND final_fare IS NULL'],
    ['paid payments without an amount', 'SELECT count(*)::int AS c FROM payments WHERE status=\'paid\' AND amount IS NULL'],
    ['earnings rows missing from bookings', 'SELECT count(*)::int AS c FROM driver_earnings de LEFT JOIN bookings b ON b.id=de.booking_id WHERE b.id IS NULL'],
  ];
  for (const [label, sql] of checks) {
    const { rows } = await query(sql);
    console.log(`  ${rows[0].c === 0 ? '✔' : '✖'} ${label}: ${rows[0].c}`);
  }

  console.log(`\n  orphan rows total: ${orphanTotal}`);
  await pool.end();
  process.exit(orphanTotal ? 1 : 0);
})();
