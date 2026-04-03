const args = process.argv.slice(2);
const command = args[0];

if (!command) {
    throw new Error('Expected a command to run');
}

const commandArgs = args.slice(1);

const port = process.env.PORT ?? '4100';
const hostname = process.env.HOSTNAME ?? 'localhost';
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? `http://${hostname}:${port}`;
const desktopUrl = process.env.ONLOOK_DESKTOP_WEB_URL ?? `${siteUrl}/desktop`;

const child = Bun.spawn([command, ...commandArgs], {
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
    env: {
        ...process.env,
        PORT: port,
        HOSTNAME: hostname,
        SKIP_ENV_VALIDATION: process.env.SKIP_ENV_VALIDATION ?? '1',
        ONLOOK_DESKTOP_MODE: 'true',
        ONLOOK_DESKTOP_WEB_URL: desktopUrl,
        SANDBOX_PROVIDER: process.env.SANDBOX_PROVIDER ?? 'node_fs',
        NEXT_PUBLIC_SANDBOX_PROVIDER: process.env.NEXT_PUBLIC_SANDBOX_PROVIDER ?? 'node_fs',
        SUPABASE_DATABASE_URL: process.env.SUPABASE_DATABASE_URL ?? 'https://desktop.onlook.invalid/db',
        SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ?? 'desktop',
        OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY ?? 'desktop',
        NEXT_PUBLIC_SITE_URL: siteUrl,
        NEXT_PUBLIC_SUPABASE_URL:
            process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://desktop.onlook.invalid',
        NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'desktop',
    },
});

process.exit(await child.exited);
