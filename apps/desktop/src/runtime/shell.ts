import { spawn } from 'node:child_process';

export function quoteShellArg(value: string) {
    return `'${value.replaceAll("'", "'\\''")}'`;
}

export async function runShellCommand(
    command: string,
    options?: {
        cwd?: string;
        env?: NodeJS.ProcessEnv;
        allowFailure?: boolean;
    },
) {
    const child = spawn(command, {
        cwd: options?.cwd,
        env: options?.env,
        shell: true,
        stdio: 'pipe',
    });

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdin.end();

    let output = '';
    child.stdout.on('data', (chunk: string) => {
        output += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
        output += chunk;
    });

    const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
        child.once('error', reject);
        child.once('close', (code, signal) => resolve({ code, signal }));
    });

    if (!options?.allowFailure && (exit.code !== 0 || exit.signal)) {
        throw new Error(output.trim() || `Command failed: ${command}`);
    }

    return {
        output,
        code: exit.code,
        signal: exit.signal,
    };
}

