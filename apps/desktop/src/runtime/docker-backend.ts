import { randomUUID, createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    DEFAULT_DOCKER_IMAGE_TAG,
    DEFAULT_LOOPBACK_HOST,
    type DesktopContainerConfig,
    type DesktopProjectSummary,
} from '../types';
import {
    detectPortFromScript,
    findAvailablePort,
    isPortAvailable,
    waitForPreview,
} from '../project-utils';
import type { RuntimeBackend } from './backend';
import { ManagedProcess } from './managed-process';
import { ManagedTerminal } from './managed-terminal';
import { quoteShellArg, runShellCommand } from './shell';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ensuredDockerImages = new Set<string>();

function getDockerfilePath() {
    return path.join(__dirname, '../docker/runtime.Dockerfile');
}

function createNodeModulesVolumeName(folderPath: string) {
    const digest = createHash('sha1').update(folderPath).digest('hex').slice(0, 12);
    return `onlook-desktop-node-modules-${digest}`;
}

export class DockerRuntimeBackend implements RuntimeBackend {
    readonly kind = 'container' as const;
    readonly task: ManagedProcess;
    private summary: DesktopProjectSummary;
    private hostPort: number;
    private readonly containerPort: number;
    private readonly terminals = new Map<string, ManagedTerminal>();
    private readonly commands = new Map<string, ManagedProcess>();
    private readonly containerName: string;
    private readonly nodeModulesVolumeName: string;
    private containerReady = false;
    private readonly containerConfig: DesktopContainerConfig;

    constructor(
        private readonly runtimeId: string,
        summary: DesktopProjectSummary,
        containerConfig?: DesktopContainerConfig,
    ) {
        this.summary = summary;
        this.hostPort = summary.port;
        this.containerPort = detectPortFromScript(summary.scripts.dev);
        this.containerName = `onlook-desktop-${runtimeId}`;
        this.nodeModulesVolumeName = createNodeModulesVolumeName(summary.folderPath);
        this.containerConfig = containerConfig ?? {
            engine: 'docker',
            imageTag: DEFAULT_DOCKER_IMAGE_TAG,
        };
        this.task = new ManagedProcess(
            `task:${runtimeId}:dev`,
            'server',
            this.buildDockerExecCommand(summary.devCommand ?? '', {
                PORT: this.containerPort.toString(),
                HOST: '0.0.0.0',
                HOSTNAME: '0.0.0.0',
                BROWSER: 'none',
                FORCE_COLOR: '1',
            }),
            this.summary.folderPath,
            process.env,
            'task',
        );
        this.syncPreview();
    }

    get port() {
        return this.hostPort;
    }

    get previewUrl() {
        return `http://${DEFAULT_LOOPBACK_HOST}:${this.hostPort}`;
    }

    setSummary(summary: DesktopProjectSummary) {
        this.summary = {
            ...summary,
            port: this.hostPort,
            previewUrl: this.previewUrl,
            hasNodeModules: this.summary.hasNodeModules || summary.hasNodeModules,
        };
    }

    toProjectSummary() {
        return {
            ...this.summary,
            port: this.hostPort,
            previewUrl: this.previewUrl,
        };
    }

    async start() {
        if (process.platform === 'win32') {
            throw new Error('Container runtime is currently supported only on macOS and Linux.');
        }

        if (!this.summary.isValid) {
            throw new Error(this.summary.error ?? 'Project is not a valid Next.js app');
        }

        if (!this.summary.devCommand) {
            throw new Error('No dev command was detected for this project');
        }

        await this.ensureDockerAvailable();
        await this.ensureDockerImage();
        await this.ensureHostPort();
        await this.ensureContainer();
        await this.installDependenciesIfNeeded();

        if (!this.task.isRunning) {
            await this.task.start();
        }

        await waitForPreview(() => this.previewUrl, async () => !this.task.isRunning, this.task.buffer);
    }

    async restart() {
        await this.ensureDockerAvailable();
        await this.ensureDockerImage();
        await this.ensureHostPort();
        await this.ensureContainer();
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

        if (this.containerReady) {
            await runShellCommand(this.buildDockerRemoveCommand(), {
                cwd: this.summary.folderPath,
                allowFailure: true,
            });
            this.containerReady = false;
        }
    }

    async createTerminal() {
        await this.ensureInteractiveReady();
        const terminalId = `terminal:${this.runtimeId}:${randomUUID()}`;
        const terminal = new ManagedTerminal(
            terminalId,
            'terminal',
            'docker',
            ['exec', '-it', this.containerName, 'sh'],
            this.summary.folderPath,
            process.env,
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
        await this.ensureInteractiveReady();
        const proc = new ManagedProcess(
            `exec:${this.runtimeId}:${randomUUID()}`,
            'command',
            this.buildDockerExecCommand(command),
            this.summary.folderPath,
            process.env,
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
        await this.ensureInteractiveReady();
        const commandId = `command:${this.runtimeId}:${randomUUID()}`;
        const proc = new ManagedProcess(
            commandId,
            'command',
            this.buildDockerExecCommand(command),
            this.summary.folderPath,
            process.env,
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

    private syncPreview() {
        this.summary = {
            ...this.summary,
            port: this.hostPort,
            previewUrl: this.previewUrl,
        };
    }

    private async ensureDockerAvailable() {
        try {
            await runShellCommand('docker info >/dev/null 2>&1', {
                cwd: this.summary.folderPath,
            });
        } catch {
            throw new Error(
                'Docker is not available. Start Docker Desktop or install the Docker CLI before launching this project in container mode.',
            );
        }
    }

    private async ensureDockerImage() {
        if (ensuredDockerImages.has(this.containerConfig.imageTag)) {
            return;
        }

        const dockerfilePath = getDockerfilePath();
        const contextPath = path.dirname(dockerfilePath);
        await runShellCommand(
            `docker image inspect ${quoteShellArg(this.containerConfig.imageTag)} >/dev/null 2>&1 || docker build -t ${quoteShellArg(this.containerConfig.imageTag)} -f ${quoteShellArg(dockerfilePath)} ${quoteShellArg(contextPath)}`,
            {
                cwd: this.summary.folderPath,
            },
        );
        ensuredDockerImages.add(this.containerConfig.imageTag);
    }

    private async ensureHostPort() {
        if (await isPortAvailable(this.hostPort)) {
            this.syncPreview();
            return;
        }

        this.hostPort = await findAvailablePort(this.hostPort + 1);
        this.syncPreview();
    }

    private async ensureContainer() {
        if (this.containerReady) {
            return;
        }

        await runShellCommand(this.buildDockerRemoveCommand(), {
            cwd: this.summary.folderPath,
            allowFailure: true,
        });
        await runShellCommand(this.buildDockerRunCommand(), {
            cwd: this.summary.folderPath,
        });
        this.containerReady = true;
    }

    private async ensureInteractiveReady() {
        await this.ensureDockerAvailable();
        await this.ensureDockerImage();
        await this.ensureContainer();
    }

    private async installDependenciesIfNeeded() {
        if (!this.summary.installCommand) {
            return;
        }

        const hasNodeModules = await runShellCommand(
            this.buildDockerExecCommand(
                'if [ -d /workspace/node_modules ] && [ "$(find /workspace/node_modules -mindepth 1 -maxdepth 1 2>/dev/null | head -n 1)" ]; then exit 0; else exit 1; fi',
            ),
            {
                cwd: this.summary.folderPath,
                allowFailure: true,
            },
        );

        if (hasNodeModules.code === 0) {
            this.summary = {
                ...this.summary,
                hasNodeModules: true,
            };
            return;
        }

        const install = await this.runCommand(this.summary.installCommand);
        if (!install.output && !this.summary.installCommand) {
            return;
        }

        this.summary = {
            ...this.summary,
            hasNodeModules: true,
        };
    }

    private buildDockerExecCommand(command: string, env?: Record<string, string>) {
        const envFlags = Object.entries(env ?? {})
            .map(([key, value]) => `-e ${quoteShellArg(`${key}=${value}`)}`)
            .join(' ');
        const envPrefix = envFlags ? `${envFlags} ` : '';
        return `docker exec -i ${envPrefix}${quoteShellArg(this.containerName)} sh -lc ${quoteShellArg(command)}`;
    }

    private buildDockerRemoveCommand() {
        return `docker rm -f ${quoteShellArg(this.containerName)} >/dev/null 2>&1 || true`;
    }

    private buildDockerRunCommand() {
        return [
            'docker run -d --rm',
            `--name ${quoteShellArg(this.containerName)}`,
            `-p ${quoteShellArg(`127.0.0.1:${this.hostPort}:${this.containerPort}`)}`,
            `-v ${quoteShellArg(`${this.summary.folderPath}:/workspace`)}`,
            `-v ${quoteShellArg(`${this.nodeModulesVolumeName}:/workspace/node_modules`)}`,
            '-w /workspace',
            quoteShellArg(this.containerConfig.imageTag),
            'tail -f /dev/null',
        ].join(' ');
    }
}
