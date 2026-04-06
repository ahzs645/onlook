import {
    FileType,
    type FilesystemEvent,
    type ProcessInfo,
    Sandbox,
    type CommandHandle,
} from 'e2b';

import {
    Provider,
    ProviderBackgroundCommand,
    ProviderFileWatcher,
    ProviderTask,
    ProviderTerminal,
    type CopyFileOutput,
    type CopyFilesInput,
    type CreateDirectoryInput,
    type CreateDirectoryOutput,
    type CreateProjectInput,
    type CreateProjectOutput,
    type CreateSessionInput,
    type CreateSessionOutput,
    type CreateTerminalInput,
    type CreateTerminalOutput,
    type DeleteFilesInput,
    type DeleteFilesOutput,
    type DownloadFilesInput,
    type DownloadFilesOutput,
    type GetTaskInput,
    type GetTaskOutput,
    type GitStatusInput,
    type GitStatusOutput,
    type InitializeInput,
    type InitializeOutput,
    type ListFilesInput,
    type ListFilesOutput,
    type ListProjectsInput,
    type ListProjectsOutput,
    type PauseProjectInput,
    type PauseProjectOutput,
    type ProviderTerminalShellSize,
    type ReadFileInput,
    type ReadFileOutput,
    type RenameFileInput,
    type RenameFileOutput,
    type SetupInput,
    type SetupOutput,
    type StatFileInput,
    type StatFileOutput,
    type StopProjectInput,
    type StopProjectOutput,
    type TerminalBackgroundCommandInput,
    type TerminalBackgroundCommandOutput,
    type TerminalCommandInput,
    type TerminalCommandOutput,
    type WatchEvent,
    type WatchFilesInput,
    type WatchFilesOutput,
    type WriteFileInput,
    type WriteFileOutput,
} from '../../types';
import type { E2BProviderOptions, E2BSession } from './shared';

const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;
const textDecoder = new TextDecoder();

function mapFileType(type?: string): 'file' | 'directory' {
    return type === FileType.DIR ? 'directory' : 'file';
}

function mapWatchEvent(event: FilesystemEvent): WatchEvent {
    const eventType =
        event.type === 'write'
            ? 'change'
            : event.type === 'remove'
              ? 'remove'
              : 'add';

    return {
        type: eventType,
        paths: [event.name],
    };
}

function buildProcessCommand(process: ProcessInfo): string {
    return [process.cmd, ...process.args].filter(Boolean).join(' ');
}

function looksLikeDevProcess(process: ProcessInfo): boolean {
    if (process.tag === 'start_cmd' || process.tag === 'dev') {
        return true;
    }

    const command = buildProcessCommand(process);
    return /\b(next|vite|bun|npm|pnpm|yarn)\b.*\bdev\b/.test(command);
}

class OutputBuffer {
    private readonly callbacks = new Set<(data: string) => void>();
    private output = '';

    append(data: string) {
        if (!data) {
            return;
        }
        this.output += data;
        for (const callback of this.callbacks) {
            callback(data);
        }
    }

    get value() {
        return this.output;
    }

    onOutput(callback: (data: string) => void) {
        this.callbacks.add(callback);
        return () => {
            this.callbacks.delete(callback);
        };
    }
}

export class E2BProvider extends Provider {
    private readonly options: E2BProviderOptions;
    private sandbox: Sandbox | null = null;

    constructor(options: E2BProviderOptions) {
        super();
        this.options = options;
    }

    private static get apiKey() {
        return process.env.E2B_API_KEY;
    }

    private static get domain() {
        return process.env.E2B_DOMAIN;
    }

    private static get timeoutMs() {
        const timeout = process.env.E2B_TIMEOUT_MS;
        return timeout ? Number(timeout) : DEFAULT_TIMEOUT_MS;
    }

    private ensureSandbox() {
        if (!this.sandbox) {
            throw new Error('Sandbox not initialized');
        }
        return this.sandbox;
    }

    async initialize(input: InitializeInput): Promise<InitializeOutput> {
        if (!this.options.sandboxId) {
            return {};
        }

        const baseOptions = {
            apiKey: this.options.apiKey ?? E2BProvider.apiKey,
            domain: this.options.domain ?? E2BProvider.domain,
            accessToken: this.options.accessToken,
        };

        if (this.options.getSession) {
            const session = await this.options.getSession(
                this.options.sandboxId,
                this.options.userId,
            );
            if (!session) {
                throw new Error(`Failed to create E2B session for sandbox ${this.options.sandboxId}`);
            }
            this.sandbox = await Sandbox.connect(this.options.sandboxId, {
                domain: session.domain ?? baseOptions.domain,
                accessToken: session.accessToken ?? baseOptions.accessToken,
                apiKey: baseOptions.apiKey,
            });
            return {};
        }

        this.sandbox = await Sandbox.connect(this.options.sandboxId, baseOptions);
        return {};
    }

    async writeFile(input: WriteFileInput): Promise<WriteFileOutput> {
        const sandbox = this.ensureSandbox();
        const content =
            typeof input.args.content === 'string'
                ? input.args.content
                : input.args.content.slice().buffer;
        await sandbox.files.write(input.args.path, content);
        return {
            success: true,
        };
    }

    async renameFile(input: RenameFileInput): Promise<RenameFileOutput> {
        const sandbox = this.ensureSandbox();
        await sandbox.files.rename(input.args.oldPath, input.args.newPath);
        return {};
    }

    async statFile(input: StatFileInput): Promise<StatFileOutput> {
        const sandbox = this.ensureSandbox();
        const info = await sandbox.files.getInfo(input.args.path);
        return {
            type: mapFileType(info.type),
            isSymlink: !!info.symlinkTarget,
            size: info.size,
            mtime: info.modifiedTime?.getTime(),
        };
    }

    async deleteFiles(input: DeleteFilesInput): Promise<DeleteFilesOutput> {
        const sandbox = this.ensureSandbox();
        await sandbox.files.remove(input.args.path);
        return {};
    }

    async listFiles(input: ListFilesInput): Promise<ListFilesOutput> {
        const sandbox = this.ensureSandbox();
        const files = await sandbox.files.list(input.args.path);
        return {
            files: files.map((file) => ({
                name: file.name,
                type: mapFileType(file.type),
                isSymlink: !!file.symlinkTarget,
            })),
        };
    }

    async readFile(input: ReadFileInput): Promise<ReadFileOutput> {
        const sandbox = this.ensureSandbox();
        const content = await sandbox.files.read(input.args.path);
        return {
            file: {
                path: input.args.path,
                content,
                type: 'text',
                toString: () => content,
            },
        };
    }

    async downloadFiles(input: DownloadFilesInput): Promise<DownloadFilesOutput> {
        const sandbox = this.ensureSandbox();
        return {
            url: await sandbox.downloadUrl(input.args.path),
        };
    }

    async copyFiles(input: CopyFilesInput): Promise<CopyFileOutput> {
        const sandbox = this.ensureSandbox();
        const recursive = input.args.recursive ? '-R' : '';
        const overwrite = input.args.overwrite === false ? '-n' : '';
        await sandbox.commands.run(
            `cp ${recursive} ${overwrite} "${input.args.sourcePath}" "${input.args.targetPath}"`,
        );
        return {};
    }

    async createDirectory(input: CreateDirectoryInput): Promise<CreateDirectoryOutput> {
        const sandbox = this.ensureSandbox();
        await sandbox.files.makeDir(input.args.path);
        return {};
    }

    async watchFiles(input: WatchFilesInput): Promise<WatchFilesOutput> {
        const sandbox = this.ensureSandbox();
        return {
            watcher: new E2BFileWatcher(sandbox, input),
        };
    }

    async createTerminal(input: CreateTerminalInput): Promise<CreateTerminalOutput> {
        const sandbox = this.ensureSandbox();
        return {
            terminal: new E2BTerminal(sandbox),
        };
    }

    async getTask(input: GetTaskInput): Promise<GetTaskOutput> {
        const sandbox = this.ensureSandbox();
        const processes = await sandbox.commands.list();
        const pid = Number(input.args.id);
        const process =
            processes.find((entry) => entry.tag === input.args.id) ??
            processes.find((entry) => !Number.isNaN(pid) && entry.pid === pid) ??
            (input.args.id === 'dev' ? processes.find(looksLikeDevProcess) : undefined);

        if (!process) {
            throw new Error(`Task ${input.args.id} not found`);
        }

        return {
            task: new E2BTask(sandbox, process),
        };
    }

    async runCommand({ args }: TerminalCommandInput): Promise<TerminalCommandOutput> {
        const sandbox = this.ensureSandbox();
        const result = await sandbox.commands.run(args.command);
        return {
            output: [result.stdout, result.stderr].filter(Boolean).join(''),
        };
    }

    async runBackgroundCommand(
        input: TerminalBackgroundCommandInput,
    ): Promise<TerminalBackgroundCommandOutput> {
        const sandbox = this.ensureSandbox();
        return {
            command: await E2BBackgroundCommand.create(sandbox, input.args.command),
        };
    }

    async gitStatus(input: GitStatusInput): Promise<GitStatusOutput> {
        const sandbox = this.ensureSandbox();
        const status = await sandbox.git.status('.');
        return {
            changedFiles: status.fileStatus.map((file) => file.name),
        };
    }

    async setup(input: SetupInput): Promise<SetupOutput> {
        return {};
    }

    async createSession(input: CreateSessionInput): Promise<E2BSession> {
        const sandbox = this.ensureSandbox();
        return {
            sandboxId: sandbox.sandboxId,
            domain: sandbox.sandboxDomain,
            accessToken: (sandbox as unknown as { envdAccessToken?: string }).envdAccessToken,
        };
    }

    async reload(): Promise<boolean> {
        const sandbox = this.ensureSandbox();
        try {
            const task = new E2BTask(
                sandbox,
                (await sandbox.commands.list()).find(looksLikeDevProcess) ??
                    (() => {
                        throw new Error('Dev process not found');
                    })(),
            );
            await task.restart();
            return true;
        } catch {
            return false;
        }
    }

    async reconnect(): Promise<void> {
        if (!this.options.sandboxId) {
            throw new Error('Sandbox ID is required for reconnect');
        }
        await this.destroy();
        await this.initialize({});
    }

    async ping(): Promise<boolean> {
        try {
            const sandbox = this.ensureSandbox();
            await sandbox.commands.run('echo "ping"');
            return true;
        } catch {
            return false;
        }
    }

    static async createProject(input: CreateProjectInput): Promise<CreateProjectOutput> {
        const sandbox = await Sandbox.create(input.id, {
            apiKey: E2BProvider.apiKey,
            domain: E2BProvider.domain,
            timeoutMs: E2BProvider.timeoutMs,
        });
        return {
            id: sandbox.sandboxId,
        };
    }

    static async createProjectFromGit(input: {
        repoUrl: string;
        branch: string;
    }): Promise<CreateProjectOutput> {
        const templateId =
            process.env.E2B_TEMPLATE_GIT_REPO ??
            process.env.E2B_TEMPLATE_EMPTY_NEXTJS ??
            process.env.E2B_TEMPLATE_BLANK;
        if (!templateId) {
            throw new Error('E2B template is not configured for GitHub imports');
        }

        const sandbox = await Sandbox.create(templateId, {
            apiKey: E2BProvider.apiKey,
            domain: E2BProvider.domain,
            timeoutMs: E2BProvider.timeoutMs,
        });
        await sandbox.git.clone(input.repoUrl, {
            branch: input.branch,
        });
        return {
            id: sandbox.sandboxId,
        };
    }

    async pauseProject(input: PauseProjectInput): Promise<PauseProjectOutput> {
        const sandbox = this.ensureSandbox();
        await sandbox.pause();
        return {};
    }

    async stopProject(input: StopProjectInput): Promise<StopProjectOutput> {
        const sandbox = this.ensureSandbox();
        await sandbox.kill();
        return {};
    }

    async listProjects(input: ListProjectsInput): Promise<ListProjectsOutput> {
        const projects = await Sandbox.list({
            apiKey: this.options.apiKey ?? E2BProvider.apiKey,
            domain: this.options.domain ?? E2BProvider.domain,
        }).nextItems();

        return {
            projects: projects.map((project) => ({
                id: project.sandboxId,
                name: project.templateId,
                description: project.templateId,
                createdAt: project.startedAt,
                updatedAt: project.endAt,
            })),
        } as ListProjectsOutput;
    }

    async destroy(): Promise<void> {
        this.sandbox = null;
    }
}

export class E2BFileWatcher extends ProviderFileWatcher {
    private callback: ((event: WatchEvent) => Promise<void>) | null = null;
    private watchHandle: { stop: () => Promise<void> } | null = null;

    constructor(
        private readonly sandbox: Sandbox,
        private readonly input: WatchFilesInput,
    ) {
        super();
    }

    async start(): Promise<void> {
        this.watchHandle = await this.sandbox.files.watchDir(
            this.input.args.path,
            async (event) => {
                if (this.callback) {
                    await this.callback(mapWatchEvent(event));
                }
            },
            {
                recursive: this.input.args.recursive,
            },
        );
    }

    async stop(): Promise<void> {
        await this.watchHandle?.stop();
        this.watchHandle = null;
    }

    registerEventCallback(callback: (event: WatchEvent) => Promise<void>): void {
        this.callback = callback;
        void this.start();
    }
}

export class E2BTerminal extends ProviderTerminal {
    private readonly buffer = new OutputBuffer();
    private pid: number | null = null;

    constructor(private readonly sandbox: Sandbox) {
        super();
    }

    get id(): string {
        return this.pid?.toString() ?? 'pty';
    }

    get sessionType() {
        return 'pty' as const;
    }

    get name(): string {
        return 'terminal';
    }

    async open(dimensions?: ProviderTerminalShellSize): Promise<string> {
        if (this.pid === null) {
            const handle = await this.sandbox.pty.create({
                cols: dimensions?.cols ?? 80,
                rows: dimensions?.rows ?? 24,
                onData: async (data) => {
                    this.buffer.append(textDecoder.decode(data));
                },
            });
            this.pid = handle.pid;
        }
        return this.buffer.value;
    }

    async write(input: string): Promise<void> {
        if (this.pid === null) {
            await this.open();
        }
        await this.sandbox.pty.sendInput(this.pid!, new TextEncoder().encode(input));
    }

    async run(input: string): Promise<void> {
        await this.write(`${input}\n`);
    }

    async kill(): Promise<void> {
        if (this.pid !== null) {
            await this.sandbox.pty.kill(this.pid);
            this.pid = null;
        }
    }

    resize(cols: number, rows: number): Promise<void> {
        if (this.pid === null) {
            return Promise.resolve();
        }
        return this.sandbox.pty.resize(this.pid, { cols, rows });
    }

    onOutput(callback: (data: string) => void): () => void {
        return this.buffer.onOutput(callback);
    }
}

export class E2BTask extends ProviderTask {
    private readonly buffer = new OutputBuffer();
    private handle: CommandHandle | null = null;
    private pid: number;
    private commandLine: string;

    constructor(
        private readonly sandbox: Sandbox,
        private process: ProcessInfo,
    ) {
        super();
        this.pid = process.pid;
        this.commandLine = buildProcessCommand(process);
    }

    get id(): string {
        return this.process.tag ?? this.pid.toString();
    }

    get name(): string {
        return this.process.tag ?? this.process.cmd;
    }

    get command(): string {
        return this.commandLine;
    }

    private async connect() {
        if (this.handle) {
            return this.handle;
        }
        this.handle = await this.sandbox.commands.connect(this.pid, {
            onStdout: async (data) => this.buffer.append(data),
            onStderr: async (data) => this.buffer.append(data),
        });
        return this.handle;
    }

    async open(): Promise<string> {
        await this.connect();
        return this.buffer.value;
    }

    async run(): Promise<void> {
        const handle = await this.sandbox.commands.run(this.commandLine, {
            background: true,
            cwd: this.process.cwd,
            envs: this.process.envs,
            onStdout: async (data) => this.buffer.append(data),
            onStderr: async (data) => this.buffer.append(data),
        });
        this.handle = handle;
        this.pid = handle.pid;
    }

    async restart(): Promise<void> {
        await this.stop();
        await this.run();
    }

    async stop(): Promise<void> {
        if (this.handle) {
            await this.handle.kill();
            this.handle = null;
            return;
        }
        await this.sandbox.commands.kill(this.pid);
    }

    onOutput(callback: (data: string) => void): () => void {
        return this.buffer.onOutput(callback);
    }
}

export class E2BBackgroundCommand extends ProviderBackgroundCommand {
    private readonly buffer = new OutputBuffer();
    private constructor(
        private readonly sandbox: Sandbox,
        private readonly cmd: string,
        private handle: CommandHandle,
    ) {
        super();
    }

    static async create(sandbox: Sandbox, command: string) {
        const handle = await sandbox.commands.run(command, {
            background: true,
        });
        return new E2BBackgroundCommand(sandbox, command, handle);
    }

    get name(): string | undefined {
        return undefined;
    }

    get command(): string {
        return this.cmd;
    }

    private async ensureConnected() {
        this.handle = await this.sandbox.commands.connect(this.handle.pid, {
            onStdout: async (data) => this.buffer.append(data),
            onStderr: async (data) => this.buffer.append(data),
        });
    }

    async open(): Promise<string> {
        await this.ensureConnected();
        return this.buffer.value;
    }

    async restart(): Promise<void> {
        await this.kill();
        this.handle = await this.sandbox.commands.run(this.cmd, {
            background: true,
            onStdout: async (data) => this.buffer.append(data),
            onStderr: async (data) => this.buffer.append(data),
        });
    }

    async kill(): Promise<void> {
        await this.handle.kill();
    }

    onOutput(callback: (data: string) => void): () => void {
        return this.buffer.onOutput(callback);
    }
}
