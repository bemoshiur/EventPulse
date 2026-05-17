/**
 * PM2 ecosystem for Event Pulse on a single EC2 (CLAUDE.md §17.5).
 *
 * Apps and workers all co-locate on the same instance per the MVP
 * architecture. The web app runs Next.js in "next start" mode (built
 * artifact); the api runs the Hono entrypoint via Node directly.
 *
 * Workers are slimmed down for staging: 1 instance per queue. Bump to
 * cluster mode in production by changing `instances` + `exec_mode`.
 *
 * Reload (zero-downtime) is the default:
 *   pm2 reload pm2/ecosystem.config.cjs
 */

module.exports = {
  apps: [
    {
      name: 'web',
      cwd: '/home/eventpulse/app/apps/web',
      script: 'node_modules/next/dist/bin/next',
      args: 'start --port 3000',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        PORT: '3000',
      },
      out_file: '/home/eventpulse/logs/web.out.log',
      error_file: '/home/eventpulse/logs/web.err.log',
      merge_logs: true,
      time: true,
    },
    {
      name: 'api',
      cwd: '/home/eventpulse/app/apps/api',
      script: 'dist/index.js',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '256M',
      env: {
        NODE_ENV: 'production',
        PORT: '4000',
      },
      out_file: '/home/eventpulse/logs/api.out.log',
      error_file: '/home/eventpulse/logs/api.err.log',
      merge_logs: true,
      time: true,
    },
    // Workers are stubs until the BullMQ queues land in Sprint 2;
    // listed here so the deploy template stays stable.
    // {
    //   name: 'worker-settlement',
    //   cwd: '/home/eventpulse/app/apps/api',
    //   script: 'dist/workers/settlement.js',
    //   instances: 1,
    //   exec_mode: 'fork',
    // },
  ],
}
