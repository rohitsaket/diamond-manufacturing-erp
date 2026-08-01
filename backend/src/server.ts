import app from './app';
import { env } from './config/env';

app.listen(env.port, () => {
  console.log(`\n  🚀 Harene Diamond ERP Backend`);
  console.log(`  ──────────────────────────`);
  console.log(`  Environment: ${env.nodeEnv}`);
  console.log(`  Port:        ${env.port}`);
  console.log(`  Database:    ${env.db.name} @ ${env.db.host}:${env.db.port}`);
  console.log(`  CORS Origin: ${env.corsOrigin}`);
  console.log(`\n  Server running at http://localhost:${env.port}\n`);
});
