import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { OutputBuffer } from '../project-utils';
import type { RuntimeStreamSessionType } from './managed-process';
import { quoteShellArg } from './shell';

interface TerminalDimensions {
    cols: number;
    rows: number;
}

const DEFAULT_TERMINAL_DIMENSIONS: TerminalDimensions = {
    cols: 80,
    rows: 24,
};

let hasScriptCommand: boolean | null = null;

function supportsPtyShell() {
    if (process.platform === 'win32') {
        return false;
    }

    if (hasScriptCommand !== null) {
        return hasScriptCommand;
    }

    hasScriptCommand = spawnSync('sh', ['-lc', 'command -v script >/dev/null 2>&1']).status === 0;
    return hasScriptCommand;
}

function isBsdScriptPlatform() {
    return process.platform === 'darwin' ||
        process.platform === 'freebsd' ||
        process.platform === 'openbsd';
}

function buildCommandString(command: string, args: string[]) {
    return [command, ...args].map((part) => quoteShellArg(part)).join(' ');
}

function buildSizedCommand(command: string, args: string[], dimensions: TerminalDimensions) {
    return `stty cols ${dimensions.cols} rows ${dimensions.rows} && exec ${buildCommandString(command, args)}`;
}

function buildTerminalInvocation(
    command: string,
    args: string[],
    dimensions: TerminalDimensions,
): { command: string; args: string[]; sessionType: RuntimeStreamSessionType } {
    if (!supportsPtyShell()) {
        return {
            command,
            args,
            sessionType: 'process',
        };
    }

    const sizedCommand = buildSizedCommand(command, args, dimensions);
    if (isBsdScriptPlatform()) {
        return {
            command: 'script',
            args: ['-q', '/dev/null', 'sh', '-lc', sizedCommand],
            sessionType: 'pty',
        };
    }

    return {
        command: 'script',
        args: ['-qfec', sizedCommand, '/dev/null'],
        sessionType: 'pty',
    };
}

export class ManagedTerminal {
    readonly buffer = new OutputBuffer();
    readonly kind = 'terminal' as const;
    readonly sessionType: RuntimeStreamSessionType;
    private child: ChildProcessWithoutNullStreams | null = null;
    private expectedStop = false;
    private dimensions = DEFAULT_TERMINAL_DIMENSIONS;
    private exitCallbacks = new Set<(code: number | null, signal: NodeJS.Signals | null) => void>();
    private outputCallbacks = new Set<(data: string) => void>();

    constructor(
        readonly id: string,
        readonly name: string,
        readonly command: string,
        private readonly args: string[],
        private readonly cwd: string,
        private env: NodeJS.ProcessEnv,
    ) {
        this.sessionType = supportsPtyShell() ? 'pty' : 'process';
    }

    get isRunning() {
        return this.child !== null && !this.child.killed;
    }

    setEnv(nextEnv: NodeJS.ProcessEnv) {
        if (this.isRunning) {
            throw new Error('Cannot update terminal environment while the terminal is running');
        }

        this.env = nextEnv;
    }

    private createEnv() {
        return {
            ...this.env,
            TERM: this.env.TERM ?? 'xterm-256color',
            COLUMNS: this.dimensions.cols.toString(),
            LINES: this.dimensions.rows.toString(),
        };
    }

    private emitOutput(data: string) {
        this.buffer.append(data);
        for (const callback of this.outputCallbacks) {
            callback(data);
        }
    }

    private updateDimensions(dimensions?: TerminalDimensions) {
        if (!dimensions) {
            return;
        }

        this.dimensions = {
            cols: dimensions.cols > 0 ? dimensions.cols : DEFAULT_TERMINAL_DIMENSIONS.cols,
            rows: dimensions.rows > 0 ? dimensions.rows : DEFAULT_TERMINAL_DIMENSIONS.rows,
        };
    }

    async start(dimensions?: TerminalDimensions) {
        if (this.child) {
            this.updateDimensions(dimensions);
            return;
        }

        this.updateDimensions(dimensions);
        this.expectedStop = false;

        const invocation = buildTerminalInvocation(this.command, this.args, this.dimensions);
        const child = spawn(invocation.command, invocation.args, {
            cwd: this.cwd,
            env: this.createEnv(),
            stdio: 'pipe',
        });

        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stdout.on('data', (chunk: string) => this.emitOutput(chunk));
        child.stderr.on('data', (chunk: string) => this.emitOutput(chunk));
        child.on('close', (code, signal) => {
            this.child = null;
            for (const callback of this.exitCallbacks) {
                callback(code, signal);
            }

            if (!this.expectedStop && (code !== 0 || signal)) {
                const reason =
                    signal !== null
                        ? `Terminal terminated with signal ${signal}\n`
                        : `Terminal exited with code ${code ?? 'unknown'}\n`;
                this.emitOutput(reason);
            }
        });
        child.on('error', (error) => {
            this.emitOutput(`${error.message}\n`);
        });

        this.child = child;
    }

    onExit(callback: (code: number | null, signal: NodeJS.Signals | null) => void) {
        this.exitCallbacks.add(callback);
        return () => {
            this.exitCallbacks.delete(callback);
        };
    }

    onOutput(callback: (data: string) => void) {
        this.outputCallbacks.add(callback);
        return () => {
            this.outputCallbacks.delete(callback);
        };
    }

    async open(dimensions?: TerminalDimensions) {
        await this.start(dimensions);
        return this.buffer.value;
    }

    async write(input: string, dimensions?: TerminalDimensions) {
        await this.start(dimensions);
        this.child?.stdin.write(input);
    }

    async run(input: string, dimensions?: TerminalDimensions) {
        await this.write(`${input}\n`, dimensions);
    }

    async resize(cols: number, rows: number) {
        this.updateDimensions({ cols, rows });
    }

    async kill() {
        if (!this.child) {
            return;
        }

        this.expectedStop = true;
        const child = this.child;
        child.kill('SIGTERM');

        await new Promise<void>((resolve) => {
            const timeout = setTimeout(() => {
                if (!child.killed) {
                    child.kill('SIGKILL');
                }
                resolve();
            }, 3_000);

            child.once('close', () => {
                clearTimeout(timeout);
                resolve();
            });
        });
    }
}
