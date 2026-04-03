import { convertToBase64 } from '@onlook/utility';
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

export const NODE_FS_SANDBOX_PREFIX = 'nodefs:session:';

export function createNodeFsSandboxId(sessionId: string): string {
    return `${NODE_FS_SANDBOX_PREFIX}${sessionId}`;
}

export function parseNodeFsSandboxId(sandboxId: string): string | null {
    return sandboxId.startsWith(NODE_FS_SANDBOX_PREFIX)
        ? sandboxId.slice(NODE_FS_SANDBOX_PREFIX.length)
        : null;
}

interface NodeFsBridgeListFilesInput {
    sessionId: string;
    path: string;
}

interface NodeFsBridgePathInput extends NodeFsBridgeListFilesInput {}

interface NodeFsBridgeWriteFileInput extends NodeFsBridgePathInput {
    content: string | Uint8Array;
    overwrite?: boolean;
}

interface NodeFsBridgeRenameFileInput {
    sessionId: string;
    oldPath: string;
    newPath: string;
}

interface NodeFsBridgeDeleteFilesInput extends NodeFsBridgePathInput {
    recursive?: boolean;
}

interface NodeFsBridgeCopyFilesInput {
    sessionId: string;
    sourcePath: string;
    targetPath: string;
    recursive?: boolean;
    overwrite?: boolean;
}

interface NodeFsBridgeWatchFilesInput extends NodeFsBridgePathInput {
    recursive?: boolean;
    excludes?: string[];
}

interface NodeFsBridgeCommandInput {
    sessionId: string;
    command: string;
}

interface NodeFsBridgeTaskInput {
    sessionId: string;
    id: string;
}

interface NodeFsBridgeTaskDescriptor {
    taskId: string;
    name: string;
    command: string;
}

interface NodeFsBridgeTerminalDescriptor {
    terminalId: string;
    name: string;
}

interface NodeFsBridgeBackgroundCommandDescriptor {
    commandId: string;
    name?: string;
    command: string;
}

export interface NodeFsDesktopProviderBridge {
    writeFile(input: NodeFsBridgeWriteFileInput): Promise<WriteFileOutput>;
    renameFile(input: NodeFsBridgeRenameFileInput): Promise<RenameFileOutput>;
    statFile(input: NodeFsBridgePathInput): Promise<StatFileOutput>;
    deleteFiles(input: NodeFsBridgeDeleteFilesInput): Promise<DeleteFilesOutput>;
    listFiles(input: NodeFsBridgeListFilesInput): Promise<ListFilesOutput>;
    readFile(input: NodeFsBridgePathInput): Promise<ReadFileOutput>;
    downloadFiles(input: NodeFsBridgePathInput): Promise<DownloadFilesOutput>;
    copyFiles(input: NodeFsBridgeCopyFilesInput): Promise<CopyFileOutput>;
    createDirectory(input: NodeFsBridgePathInput): Promise<CreateDirectoryOutput>;
    watchFiles(input: NodeFsBridgeWatchFilesInput): Promise<{ watcherId: string }>;
    unwatchFiles(watcherId: string): Promise<void>;
    onWatchEvent(watcherId: string, callback: (event: WatchEvent) => void): () => void;
    createTerminal(input: { sessionId: string }): Promise<NodeFsBridgeTerminalDescriptor>;
    terminalOpen(input: { terminalId: string; dimensions?: ProviderTerminalShellSize }): Promise<string>;
    terminalWrite(input: { terminalId: string; value: string; dimensions?: ProviderTerminalShellSize }): Promise<void>;
    terminalRun(input: { terminalId: string; value: string; dimensions?: ProviderTerminalShellSize }): Promise<void>;
    terminalKill(input: { terminalId: string }): Promise<void>;
    onTerminalOutput(terminalId: string, callback: (data: string) => void): () => void;
    getTask(input: NodeFsBridgeTaskInput): Promise<NodeFsBridgeTaskDescriptor>;
    taskOpen(input: { taskId: string; dimensions?: ProviderTerminalShellSize }): Promise<string>;
    taskRun(input: { taskId: string }): Promise<void>;
    taskRestart(input: { taskId: string }): Promise<void>;
    taskStop(input: { taskId: string }): Promise<void>;
    onTaskOutput(taskId: string, callback: (data: string) => void): () => void;
    runCommand(input: NodeFsBridgeCommandInput): Promise<TerminalCommandOutput>;
    runBackgroundCommand(
        input: NodeFsBridgeCommandInput,
    ): Promise<NodeFsBridgeBackgroundCommandDescriptor>;
    backgroundCommandOpen(input: { commandId: string }): Promise<string>;
    backgroundCommandRestart(input: { commandId: string }): Promise<void>;
    backgroundCommandKill(input: { commandId: string }): Promise<void>;
    onBackgroundCommandOutput(commandId: string, callback: (data: string) => void): () => void;
    gitStatus(input: { sessionId: string }): Promise<GitStatusOutput>;
    reload(input: { sessionId: string }): Promise<boolean>;
    reconnect(input: { sessionId: string }): Promise<void>;
    ping(input: { sessionId: string }): Promise<boolean>;
    pauseProject(input: { sessionId: string }): Promise<PauseProjectOutput>;
    stopProject(input: { sessionId: string }): Promise<StopProjectOutput>;
    listProjects(): Promise<ListProjectsOutput>;
}

declare global {
    interface OnlookDesktopBridge {
        provider: NodeFsDesktopProviderBridge;
    }

    interface Window {
        onlookDesktop?: OnlookDesktopBridge;
    }
}

function getBridge(): NodeFsDesktopProviderBridge {
    const bridge = typeof window !== 'undefined' ? window.onlookDesktop?.provider : undefined;
    if (!bridge) {
        throw new Error('Desktop provider bridge is not available in this renderer');
    }
    return bridge;
}

function getSessionId(sandboxId: string | undefined): string {
    if (!sandboxId) {
        throw new Error('NodeFs provider requires a sandboxId');
    }
    const sessionId = parseNodeFsSandboxId(sandboxId);
    if (!sessionId) {
        throw new Error(`Invalid NodeFs sandbox id: ${sandboxId}`);
    }
    return sessionId;
}

export interface NodeFsProviderOptions {
    sandboxId?: string;
}

export class NodeFsProvider extends Provider {
    private readonly options: NodeFsProviderOptions;
    private readonly sessionId: string;

    constructor(options: NodeFsProviderOptions) {
        super();
        this.options = options;
        this.sessionId = getSessionId(options.sandboxId);
    }

    async initialize(_input: InitializeInput): Promise<InitializeOutput> {
        await getBridge().ping({ sessionId: this.sessionId });
        return {};
    }

    async writeFile(input: WriteFileInput): Promise<WriteFileOutput> {
        return getBridge().writeFile({
            sessionId: this.sessionId,
            path: input.args.path,
            content: input.args.content,
            overwrite: input.args.overwrite,
        });
    }

    async renameFile(input: RenameFileInput): Promise<RenameFileOutput> {
        return getBridge().renameFile({
            sessionId: this.sessionId,
            oldPath: input.args.oldPath,
            newPath: input.args.newPath,
        });
    }

    async statFile(input: StatFileInput): Promise<StatFileOutput> {
        return getBridge().statFile({
            sessionId: this.sessionId,
            path: input.args.path,
        });
    }

    async deleteFiles(input: DeleteFilesInput): Promise<DeleteFilesOutput> {
        return getBridge().deleteFiles({
            sessionId: this.sessionId,
            path: input.args.path,
            recursive: input.args.recursive,
        });
    }

    async listFiles(input: ListFilesInput): Promise<ListFilesOutput> {
        return getBridge().listFiles({
            sessionId: this.sessionId,
            path: input.args.path,
        });
    }

    async readFile(input: ReadFileInput): Promise<ReadFileOutput> {
        const result = await getBridge().readFile({
            sessionId: this.sessionId,
            path: input.args.path,
        });

        return {
            file: {
                ...result.file,
                toString: () => {
                    return typeof result.file.content === 'string'
                        ? result.file.content
                        : result.file.content
                            ? convertToBase64(result.file.content)
                            : '';
                },
            },
        };
    }

    async downloadFiles(input: DownloadFilesInput): Promise<DownloadFilesOutput> {
        return getBridge().downloadFiles({
            sessionId: this.sessionId,
            path: input.args.path,
        });
    }

    async copyFiles(input: CopyFilesInput): Promise<CopyFileOutput> {
        return getBridge().copyFiles({
            sessionId: this.sessionId,
            sourcePath: input.args.sourcePath,
            targetPath: input.args.targetPath,
            recursive: input.args.recursive,
            overwrite: input.args.overwrite,
        });
    }

    async createDirectory(input: CreateDirectoryInput): Promise<CreateDirectoryOutput> {
        return getBridge().createDirectory({
            sessionId: this.sessionId,
            path: input.args.path,
        });
    }

    async watchFiles(input: WatchFilesInput): Promise<WatchFilesOutput> {
        const { watcherId } = await getBridge().watchFiles({
            sessionId: this.sessionId,
            path: input.args.path,
            recursive: input.args.recursive,
            excludes: input.args.excludes,
        });

        return {
            watcher: new NodeFsFileWatcher(watcherId, input.onFileChange),
        };
    }

    async createTerminal(_input: CreateTerminalInput): Promise<CreateTerminalOutput> {
        const terminal = await getBridge().createTerminal({ sessionId: this.sessionId });
        return {
            terminal: new NodeFsTerminal(terminal.terminalId, terminal.name),
        };
    }

    async getTask(input: GetTaskInput): Promise<GetTaskOutput> {
        const task = await getBridge().getTask({
            sessionId: this.sessionId,
            id: input.args.id,
        });
        return {
            task: new NodeFsTask(task.taskId, task.name, task.command),
        };
    }

    async runCommand(input: TerminalCommandInput): Promise<TerminalCommandOutput> {
        return getBridge().runCommand({
            sessionId: this.sessionId,
            command: input.args.command,
        });
    }

    async runBackgroundCommand(
        input: TerminalBackgroundCommandInput,
    ): Promise<TerminalBackgroundCommandOutput> {
        const command = await getBridge().runBackgroundCommand({
            sessionId: this.sessionId,
            command: input.args.command,
        });
        return {
            command: new NodeFsCommand(command.commandId, command.command, command.name),
        };
    }

    async gitStatus(_input: GitStatusInput): Promise<GitStatusOutput> {
        return getBridge().gitStatus({ sessionId: this.sessionId });
    }

    async setup(_input: SetupInput): Promise<SetupOutput> {
        return {};
    }

    async createSession(_input: CreateSessionInput): Promise<CreateSessionOutput> {
        return {};
    }

    async reload(): Promise<boolean> {
        return getBridge().reload({ sessionId: this.sessionId });
    }

    async reconnect(): Promise<void> {
        await getBridge().reconnect({ sessionId: this.sessionId });
    }

    async ping(): Promise<boolean> {
        return getBridge().ping({ sessionId: this.sessionId });
    }

    static async createProject(input: CreateProjectInput): Promise<CreateProjectOutput> {
        return {
            id: input.id,
        };
    }

    static async createProjectFromGit(_input: {
        repoUrl: string;
        branch: string;
    }): Promise<CreateProjectOutput> {
        throw new Error('createProjectFromGit not implemented for NodeFs provider');
    }

    async pauseProject(_input: PauseProjectInput): Promise<PauseProjectOutput> {
        return getBridge().pauseProject({ sessionId: this.sessionId });
    }

    async stopProject(_input: StopProjectInput): Promise<StopProjectOutput> {
        return getBridge().stopProject({ sessionId: this.sessionId });
    }

    async listProjects(_input: ListProjectsInput): Promise<ListProjectsOutput> {
        return getBridge().listProjects();
    }

    async destroy(): Promise<void> {}
}

export class NodeFsFileWatcher extends ProviderFileWatcher {
    private unsubscribe: (() => void) | null = null;
    private callback: ((event: WatchEvent) => Promise<void>) | null = null;

    constructor(
        private readonly watcherId: string,
        initialCallback?: (event: WatchEvent) => Promise<void>,
    ) {
        super();
        this.callback = initialCallback ?? null;
    }

    async start(_input: WatchFilesInput): Promise<void> {
        if (this.unsubscribe) {
            return;
        }
        this.unsubscribe = getBridge().onWatchEvent(this.watcherId, (event) => {
            void this.callback?.(event);
        });
    }

    async stop(): Promise<void> {
        this.unsubscribe?.();
        this.unsubscribe = null;
        await getBridge().unwatchFiles(this.watcherId);
    }

    registerEventCallback(callback: (event: WatchEvent) => Promise<void>): void {
        this.callback = callback;
        void this.start({
            args: {
                path: './',
            },
        });
    }
}

export class NodeFsTerminal extends ProviderTerminal {
    constructor(
        private readonly terminalId: string,
        private readonly terminalName: string,
    ) {
        super();
    }

    get id(): string {
        return this.terminalId;
    }

    get name(): string {
        return this.terminalName;
    }

    open(dimensions?: ProviderTerminalShellSize): Promise<string> {
        return getBridge().terminalOpen({
            terminalId: this.terminalId,
            dimensions,
        });
    }

    write(input: string, dimensions?: ProviderTerminalShellSize): Promise<void> {
        return getBridge().terminalWrite({
            terminalId: this.terminalId,
            value: input,
            dimensions,
        });
    }

    run(input: string, dimensions?: ProviderTerminalShellSize): Promise<void> {
        return getBridge().terminalRun({
            terminalId: this.terminalId,
            value: input,
            dimensions,
        });
    }

    kill(): Promise<void> {
        return getBridge().terminalKill({
            terminalId: this.terminalId,
        });
    }

    onOutput(callback: (data: string) => void): () => void {
        return getBridge().onTerminalOutput(this.terminalId, callback);
    }
}

export class NodeFsTask extends ProviderTask {
    constructor(
        private readonly taskId: string,
        private readonly taskName: string,
        private readonly taskCommand: string,
    ) {
        super();
    }

    get id(): string {
        return this.taskId;
    }

    get name(): string {
        return this.taskName;
    }

    get command(): string {
        return this.taskCommand;
    }

    open(dimensions?: ProviderTerminalShellSize): Promise<string> {
        return getBridge().taskOpen({
            taskId: this.taskId,
            dimensions,
        });
    }

    run(): Promise<void> {
        return getBridge().taskRun({
            taskId: this.taskId,
        });
    }

    restart(): Promise<void> {
        return getBridge().taskRestart({
            taskId: this.taskId,
        });
    }

    stop(): Promise<void> {
        return getBridge().taskStop({
            taskId: this.taskId,
        });
    }

    onOutput(callback: (data: string) => void): () => void {
        return getBridge().onTaskOutput(this.taskId, callback);
    }
}

export class NodeFsCommand extends ProviderBackgroundCommand {
    constructor(
        private readonly commandId: string,
        private readonly commandValue: string,
        private readonly commandName?: string,
    ) {
        super();
    }

    get name(): string | undefined {
        return this.commandName;
    }

    get command(): string {
        return this.commandValue;
    }

    open(): Promise<string> {
        return getBridge().backgroundCommandOpen({
            commandId: this.commandId,
        });
    }

    restart(): Promise<void> {
        return getBridge().backgroundCommandRestart({
            commandId: this.commandId,
        });
    }

    kill(): Promise<void> {
        return getBridge().backgroundCommandKill({
            commandId: this.commandId,
        });
    }

    onOutput(callback: (data: string) => void): () => void {
        return getBridge().onBackgroundCommandOutput(this.commandId, callback);
    }
}
