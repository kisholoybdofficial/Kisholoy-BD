/**
 * Demo data seeding CLI.
 *
 *   npm run seed          → seed when the store is empty
 *   npm run seed:demo     → re-apply demo rows even if the store has data
 *   npm run seed -- --allow-demo   → permit writing demo data while
 *                                    NODE_ENV=production (demo deployments)
 *
 * Seeds into whichever durable store the environment describes:
 * MONGODB_URI for production, or the local file store for development.
 *
 * @license Apache-2.0
 */

import 'dotenv/config';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const allowDemo = args.includes('--allow-demo') || process.env.KISHOLOY_ALLOW_DEMO_DATA === 'true';

  const { persistence } = await import('../server/persistence/store');
  const { serverDb } = await import('../server/db');
  const { seedDemoData } = await import('../server/seed/seedDemoData');

  await persistence.ensureReady();
  await serverDb.hydrateFromStore();

  const report = await seedDemoData({ force, allowProduction: allowDemo });

  const summary = report.ran
    ? `seeded ${report.products} products, ${report.categories} categories, ${report.vendors} vendors, ${report.coupons} coupons, ${report.customers} demo shoppers → ${report.mode} store`
    : `skipped: ${report.skippedReason}`;

  console.log(`\n  KISHOLOY seed\n  ─────────────\n  ${summary}\n`);

  if (report.ran && report.mode === 'memory') {
    console.log('  ! The store is VOLATILE: configure MONGODB_URI (or run in development so the');
    console.log('    file driver is used) to persist this data across restarts.\n');
  }

  await persistence.close();
  process.exit(0);
}

main().catch((err) => {
  console.error('Seed failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
