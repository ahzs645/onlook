import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { OutputBuffer } from '../project-utils';

export type StreamKind = 'terminal' | 'task' | 'command';
export type RuntimeStreamSessionType = 'pty' | 'process';

export class ManagedProcess {
    readonly buffer = new OutputBuffer();
    readonly sessionType: RuntimeStreamSessionType = 'process';
    private child: ChildProcessWithoutNullStreams | null = null;
    private expectedStop = false;
    private exitCallbacks = new Set<(code: number | null, signal: NodeJS.Signals | null) => void>();
    private outputCallbacks = new Set<(data: string) => void>();

    constructor(
        readonly id: string,
        readonly name: string,
        readonly command: string,
        private readonly cwd: string,
        private env: NodeJS.ProcessEnv,
        readonly kind: StreamKind,
    ) {}

    get isRunning() {
        return this.child !== null && !this.child.killed;
    }

    setEnv(nextEnv: NodeJS.ProcessEnv) {
        if (this.isRunning) {
            throw new Error('Cannot update process environment while the process is running');
        }

        this.env = nextEnv;
    }

    private emitOutput(data: string) {
        this.buffer.append(data);
        for (const callback of this.outputCallbacks) {
            callback(data);
        }
    }

    async start() {
        if (this.child) {
            return;
        }

        this.expectedStop = false;
        const child = spawn(this.command, {
            cwd: this.cwd,
            env: this.env,
            shell: true,
            stdio: 'pipe',
        });

        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');

        if (this.kind === 'command') {
            child.stdin.end();
        }

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
                        ? `Process terminated with signal ${signal}\n`
                        : `Process exited with code ${code ?? 'unknown'}\n`;
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

    async open() {
        await this.start();
        return this.buffer.value;
    }

    async write(input: string) {
        await this.start();
        this.child?.stdin.write(input);
    }

    async run(input: string) {
        await this.write(`${input}\n`);
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

    async restart() {
        await this.kill();
        await this.start();
    }
}
