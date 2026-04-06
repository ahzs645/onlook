import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import {
    DEFAULT_LOOPBACK_HOST,
    DEFAULT_SHELL,
    type DesktopProjectSummary,
} from '../types';
import {
    detectPortFromOutput,
    findAvailablePort,
    isPortAvailable,
    scriptSpecifiesPort,
    waitForPreview,
} from '../project-utils';
import type { RuntimeBackend } from './backend';
import { ManagedProcess } from './managed-process';
import { ManagedTerminal } from './managed-terminal';

export class LocalRuntimeBackend implements RuntimeBackend {
    readonly kind = 'local' as const;
    readonly task: ManagedProcess;
    private summary: DesktopProjectSummary;
    private readonly terminals = new Map<string, ManagedTerminal>();
    private readonly commands = new Map<string, ManagedProcess>();

    constructor(
        private readonly runtimeId: string,
        summary: DesktopProjectSummary,
    ) {
        this.summary = summary;
        this.task = new ManagedProcess(
            `task:${runtimeId}:dev`,
            'server',
            this.summary.devCommand ?? '',
            this.summary.folderPath,
            this.createProcessEnv(),
            'task',
        );
        this.task.onOutput((chunk) => {
            const detectedPort = detectPortFromOutput(chunk) ?? detectPortFromOutput(this.task.buffer.tail());
            if (!detectedPort || detectedPort === this.summary.port) {
                return;
            }

            this.updatePreviewPort(detectedPort);
        });
    }

    get port() {
        return this.summary.port;
    }

    get previewUrl() {
        return this.summary.previewUrl;
    }

    setSummary(summary: DesktopProjectSummary) {
        this.summary = {
            ...summary,
            port: this.summary.port,
            previewUrl: this.summary.previewUrl,
            hasNodeModules: this.summary.hasNodeModules || summary.hasNodeModules,
        };
        if (!this.task.isRunning) {
            this.task.setEnv(this.createProcessEnv());
        }
    }

    toProjectSummary() {
        return {
            ...this.summary,
        };
    }

    private createProcessEnv(): NodeJS.ProcessEnv {
        return {
            ...process.env,
            PORT: this.summary.port.toString(),
            HOST: DEFAULT_LOOPBACK_HOST,
            HOSTNAME: DEFAULT_LOOPBACK_HOST,
            BROWSER: 'none',
            FORCE_COLOR: '1',
        };
    }

    private updatePreviewPort(port: number) {
        this.summary = {
            ...this.summary,
            port,
            previewUrl: `http://${DEFAULT_LOOPBACK_HOST}:${port}`,
        };
        if (!this.task.isRunning) {
            this.task.setEnv(this.createProcessEnv());
        }
    }

    private async ensureLaunchPort() {
        if (await isPortAvailable(this.summary.port)) {
            return;
        }

        if (scriptSpecifiesPort(this.summary.scripts.dev)) {
            throw new Error(
                `Port ${this.summary.port} is already in use by another process. Stop that process or change the project's configured dev port before launching it in desktop mode.`,
            );
        }

        const availablePort = await findAvailablePort(this.summary.port + 1);
        this.updatePreviewPort(availablePort);
    }

    async start() {
        if (!this.summary.isValid) {
            throw new Error(this.summary.error ?? 'Project is not a valid Next.js app');
        }

        if (!this.summary.devCommand) {
            throw new Error('No dev command was detected for this project');
        }

        await this.ensureLaunchPort();

        if (!this.summary.hasNodeModules && this.summary.installCommand) {
            await this.installDependencies();
        }

        if (!this.task.isRunning) {
            await this.task.start();
        }

        await waitForPreview(() => this.previewUrl, async () => !this.task.isRunning, this.task.buffer);
    }

    async restart() {
        if (!this.summary.devCommand) {
            throw new Error('No dev command was detected for this project');
        }

        await this.task.restart();
        await waitForPreview(() => this.previewUrl, async () => !this.task.isRunning, this.task.buffer);
    }

    async stop() {
        await Promise.all([
            this.task.kill(),
            ...Array.from(this.terminals.values()).map((terminal) => terminal.kill()),
            ...Array.from(this.commands.values()).map((command) => command.kill()),
        ]);
        this.terminals.clear();
        this.commands.clear();
    }

    async createTerminal() {
        const terminalId = `terminal:${this.runtimeId}:${randomUUID()}`;
        const terminal = new ManagedTerminal(
            terminalId,
            'terminal',
            DEFAULT_SHELL,
            ['-l'],
            this.summary.folderPath,
            this.createProcessEnv(),
        );
        await terminal.start();
        this.terminals.set(terminalId, terminal);
        return terminal;
    }

    getTerminal(id: string) {
        const terminal = this.terminals.get(id);
        if (!terminal) {
            throw new Error(`Terminal not found: ${id}`);
        }
        return terminal;
    }

    async runCommand(command: string) {
        const proc = new ManagedProcess(
            `exec:${this.runtimeId}:${randomUUID()}`,
            'command',
            command,
            this.summary.folderPath,
            this.createProcessEnv(),
            'command',
        );
        await proc.start();
        await new Promise<void>((resolve) => {
            proc.onExit(() => {
                resolve();
            });
        });
        return {
            output: proc.buffer.value,
        };
    }

    async createBackgroundCommand(command: string) {
        const commandId = `command:${this.runtimeId}:${randomUUID()}`;
        const proc = new ManagedProcess(
            commandId,
            'command',
            command,
            this.summary.folderPath,
            this.createProcessEnv(),
            'command',
        );
        this.commands.set(commandId, proc);
        return proc;
    }

    getBackgroundCommand(id: string) {
        const command = this.commands.get(id);
        if (!command) {
            throw new Error(`Background command not found: ${id}`);
        }
        return command;
    }

    private async installDependencies() {
        if (!this.summary.installCommand) {
            return;
        }

        const install = await this.runCommand(this.summary.installCommand);
        try {
            await fs.access(path.join(this.summary.folderPath, 'node_modules'));
            this.summary = {
                ...this.summary,
                hasNodeModules: true,
            };
        } catch {
            throw new Error(
                install.output || 'Failed to install dependencies for the local project',
            );
        }
    }
}
