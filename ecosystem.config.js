/**
 * PM2 Configuration for Yield Rewind
 *
 * Usage:
 *   pm2 start ecosystem.config.js
 *   pm2 status
 *   pm2 logs
 *   pm2 restart all
 */

module.exports = {
  apps: [
    {
      name: 'yield-rewind',
      script: 'npm',
      args: 'start',
      instances: 'max',
      exec_mode: 'cluster',
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      error_file: './logs/error.log',
      out_file: './logs/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    },
    {
      name: 'yield-rewind-sync',
      script: 'npx',
      args: 'ts-node sync/scheduler.ts',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      autorestart: true,
      max_restarts: 10,
      env: {
        NODE_ENV: 'production',
        DB_SERVER: '10.34.145.21',
        DB_NAME: 'adv_hc',
        DB_USER: 'DataAnalysis-ReadOnly',
        // DB_PASSWORD should be set via environment
      },
      error_file: './logs/sync-error.log',
      out_file: './logs/sync-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    },
  ],
};
