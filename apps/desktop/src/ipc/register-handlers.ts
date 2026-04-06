import { dialog, ipcMain, shell } from 'electron';
import { desktopIpcChannels, getProviderWatchChannel } from './channels';
import { DesktopRuntimeError } from '../errors';
import { NODE_FS_SANDBOX_PREFIX } from '../types';
import type { DesktopStorage } from '../storage';
import type { RuntimeRegistry } from '../runtime/registry';
import type { DesktopRecentProject } from '../types';
import type { StreamKind } from '../runtime/managed-process';
import type { ManagedProcess } from '../runtime/managed-process';
import type { ManagedTerminal } from '../runtime/managed-terminal';

interface DesktopIpcContext {
    getDesktopStorage: () => DesktopStorage;
    runtimeRegistry: RuntimeRegistry;
    inspectProject: (folderPath: string) => Promise<unknown>;
    listRecentProjects: () => Promise<DesktopRecentProject[]>;
    getRecentProject: (projectId: string) => Promise<DesktopRecentProject | null>;
    launchProjectByFolder: (folderPath: string) => Promise<unknown>;
    launchProjectById: (projectId: string) => Promise<unknown>;
    notifyProjectsUpdated: (projectId?: string) => void;
    updateRecentProjectPreview: (projectId: string, previewImageDataUrl: string) => Promise<void>;
    bindStreamOutput: (kind: StreamKind, process: ManagedProcess | ManagedTerminal) => void;
    sendToMainWindow: (channel: string, payload: unknown) => boolean;
    reconnectRuntime: (runtimeId: string) => Promise<unknown>;
}

function getRuntimeByInputSession(runtimeRegistry: RuntimeRegistry, input: { sessionId: string }) {
    return runtimeRegistry.getRuntimeBySandboxId(`${NODE_FS_SANDBOX_PREFIX}${input.sessionId}`);
}

function isTerminalExpiredError(error: unknown) {
    return error instanceof DesktopRuntimeError && error.code === 'DESKTOP_TERMINAL_EXPIRED';
}

export function registerDesktopIpcHandlers(context: DesktopIpcContext) {
    ipcMain.handle(desktopIpcChannels.pickDirectory, async () => {
        const result = await dialog.showOpenDialog({
            properties: ['openDirectory', 'createDirectory'],
        });

        if (result.canceled) {
            return null;
        }

        return result.filePaths[0] ?? null;
    });

    ipcMain.handle(desktopIpcChannels.inspectProject, async (_event, folderPath: string) => {
        if (!folderPath) {
            throw new Error('Folder path is required');
        }

        return context.inspectProject(folderPath);
    });

    ipcMain.handle(desktopIpcChannels.saveProject, async (_event, folderPath: string) => {
        if (!folderPath) {
            throw new Error('Folder path is required');
        }

        const summary = await context.inspectProject(folderPath);
        const record = await context.getDesktopStorage().upsertProjectRecord(summary as never, {
            markOpened: true,
        });
        context.notifyProjectsUpdated(record.id);
        return context.getRecentProject(record.id);
    });

    ipcMain.handle(desktopIpcChannels.getProject, async (_event, projectId: string) => {
        if (!projectId) {
            throw new Error('Project id is required');
        }

        return context.getRecentProject(projectId);
    });

    ipcMain.handle(desktopIpcChannels.readChatStore, async (_event, projectId: string) => {
        if (!projectId) {
            throw new Error('Project id is required');
        }

        return context.getDesktopStorage().readChat(projectId);
    });

    ipcMain.handle(
        desktopIpcChannels.writeChatStore,
        async (_event, projectId: string, content: string) => {
            if (!projectId) {
                throw new Error('Project id is required');
            }

            if (typeof content !== 'string') {
                throw new Error('Chat store content must be a string');
            }

            await context.getDesktopStorage().writeChat(projectId, content);
        },
    );

    ipcMain.handle(
        desktopIpcChannels.saveProjectPreview,
        async (_event, projectId: string, previewImageDataUrl: string) => {
            if (!projectId) {
                throw new Error('Project id is required');
            }

            if (!previewImageDataUrl || !previewImageDataUrl.startsWith('data:image/')) {
                throw new Error('A valid preview image is required');
            }

            const record = await context.getDesktopStorage().getProjectRecord(projectId);
            if (!record) {
                throw new Error('Desktop project not found');
            }

            await context.updateRecentProjectPreview(projectId, previewImageDataUrl);
        },
    );

    ipcMain.handle(desktopIpcChannels.launchProject, async (_event, folderPath: string) => {
        if (!folderPath) {
            throw new Error('Folder path is required');
        }

        return context.launchProjectByFolder(folderPath);
    });

    ipcMain.handle(desktopIpcChannels.launchProjectById, async (_event, projectId: string) => {
        if (!projectId) {
            throw new Error('Project id is required');
        }

        return context.launchProjectById(projectId);
    });

    ipcMain.handle(desktopIpcChannels.getProjectSession, async (_event, sessionId: string) => {
        const runtime = context.runtimeRegistry.getRuntimeBySessionId(sessionId);
        if (runtime?.status !== 'starting' && runtime?.status !== 'running') {
            return null;
        }
        return runtime.toSession();
    });

    ipcMain.handle(desktopIpcChannels.listProjects, async () => {
        return context.listRecentProjects();
    });

    ipcMain.handle(desktopIpcChannels.removeProject, async (_event, projectId: string) => {
        if (!projectId) {
            throw new Error('Project id is required');
        }

        const runtime = context.runtimeRegistry.getRuntimeByProjectId(projectId);
        if (runtime) {
            await runtime.stop();
            context.runtimeRegistry.deleteRuntime(runtime.id);
        }

        await context.getDesktopStorage().removeProjectRecord(projectId);
        context.notifyProjectsUpdated(projectId);
        return context.listRecentProjects();
    });

    ipcMain.handle(desktopIpcChannels.getSettings, async () => {
        return context.getDesktopStorage().getSettings();
    });

    ipcMain.handle(desktopIpcChannels.updateSettings, async (_event, input) => {
        const settings = await context.getDesktopStorage().updateSettings(input ?? {});
        context.notifyProjectsUpdated();
        return settings;
    });

    ipcMain.handle(desktopIpcChannels.updateProjectRuntime, async (_event, input) => {
        if (!input?.projectId) {
            throw new Error('Project id is required');
        }

        if (input.preferredBackend !== 'local' && input.preferredBackend !== 'container') {
            throw new Error('Preferred backend must be local or container');
        }

        const updated = await context.getDesktopStorage().updateProjectRecord(input.projectId, (record) => ({
            ...record,
            preferredBackend: input.preferredBackend,
            containerConfig: {
                engine: 'docker',
                imageTag: record.containerConfig?.imageTag ?? 'onlook-desktop-runtime:node20-bun1',
            },
        }));

        if (!updated) {
            throw new Error('Desktop project not found');
        }

        context.notifyProjectsUpdated(updated.id);
        return context.getRecentProject(updated.id);
    });

    ipcMain.handle(desktopIpcChannels.openPath, async (_event, targetPath: string) => {
        await shell.openPath(targetPath);
    });

    ipcMain.handle(desktopIpcChannels.openExternal, async (_event, targetUrl: string) => {
        await shell.openExternal(targetUrl);
    });

    ipcMain.handle(desktopIpcChannels.provider.writeFile, async (_event, input) => {
        return getRuntimeByInputSession(context.runtimeRegistry, input).writeFile(input);
    });

    ipcMain.handle(desktopIpcChannels.provider.renameFile, async (_event, input) => {
        return getRuntimeByInputSession(context.runtimeRegistry, input).renameFile(
            input.oldPath,
            input.newPath,
        );
    });

    ipcMain.handle(desktopIpcChannels.provider.statFile, async (_event, input) => {
        return getRuntimeByInputSession(context.runtimeRegistry, input).statFile(input.path);
    });

    ipcMain.handle(desktopIpcChannels.provider.deleteFiles, async (_event, input) => {
        return getRuntimeByInputSession(context.runtimeRegistry, input).deleteFiles(input);
    });

    ipcMain.handle(desktopIpcChannels.provider.listFiles, async (_event, input) => {
        return getRuntimeByInputSession(context.runtimeRegistry, input).listFiles(input.path);
    });

    ipcMain.handle(desktopIpcChannels.provider.readFile, async (_event, input) => {
        return getRuntimeByInputSession(context.runtimeRegistry, input).readFile(input.path);
    });

    ipcMain.handle(desktopIpcChannels.provider.downloadFiles, async () => {
        return {
            url: '',
        };
    });

    ipcMain.handle(desktopIpcChannels.provider.copyFiles, async (_event, input) => {
        return getRuntimeByInputSession(context.runtimeRegistry, input).copyFiles(input);
    });

    ipcMain.handle(desktopIpcChannels.provider.createDirectory, async (_event, input) => {
        return getRuntimeByInputSession(context.runtimeRegistry, input).createDirectory(input.path);
    });

    ipcMain.handle(desktopIpcChannels.provider.watchFiles, async (_event, input) => {
        const runtime = getRuntimeByInputSession(context.runtimeRegistry, input);
        const registration = await runtime.createWatcher(input, (watcherId, event) => {
            context.sendToMainWindow(getProviderWatchChannel(watcherId), event);
        });
        context.runtimeRegistry.registerWatcher(runtime, registration.id);
        return {
            watcherId: registration.id,
        };
    });

    ipcMain.handle(desktopIpcChannels.provider.unwatchFiles, async (_event, watcherId: string) => {
        const runtime = context.runtimeRegistry.getRuntimeByWatcherId(watcherId);
        if (!runtime) {
            return;
        }
        await runtime.removeWatcher(watcherId);
        context.runtimeRegistry.unregisterWatcher(watcherId);
    });

    ipcMain.handle(desktopIpcChannels.provider.createTerminal, async (_event, input) => {
        const runtime = getRuntimeByInputSession(context.runtimeRegistry, input);
        const terminal = await runtime.createTerminal();
        context.runtimeRegistry.registerTerminal(runtime, terminal);
        context.bindStreamOutput('terminal', terminal);
        return {
            terminalId: terminal.id,
            name: terminal.name,
            sessionType: terminal.sessionType,
        };
    });

    ipcMain.handle(desktopIpcChannels.provider.terminalOpen, async (_event, input) => {
        return context.runtimeRegistry
            .getRuntimeByTerminalId(input.terminalId)
            .getTerminal(input.terminalId)
            .open(input.dimensions);
    });

    ipcMain.handle(desktopIpcChannels.provider.terminalWrite, async (_event, input) => {
        await context.runtimeRegistry
            .getRuntimeByTerminalId(input.terminalId)
            .getTerminal(input.terminalId)
            .write(input.value, input.dimensions);
    });

    ipcMain.handle(desktopIpcChannels.provider.terminalRun, async (_event, input) => {
        await context.runtimeRegistry
            .getRuntimeByTerminalId(input.terminalId)
            .getTerminal(input.terminalId)
            .run(input.value, input.dimensions);
    });

    ipcMain.handle(desktopIpcChannels.provider.terminalResize, async (_event, input) => {
        if (!input?.dimensions) {
            return;
        }

        try {
            await context.runtimeRegistry
                .getRuntimeByTerminalId(input.terminalId)
                .getTerminal(input.terminalId)
                .resize(input.dimensions.cols, input.dimensions.rows);
        } catch (error) {
            if (isTerminalExpiredError(error)) {
                return;
            }
            throw error;
        }
    });

    ipcMain.handle(desktopIpcChannels.provider.terminalKill, async (_event, input) => {
        const runtime = context.runtimeRegistry.getRuntimeByTerminalId(input.terminalId);
        await runtime.getTerminal(input.terminalId).kill();
        context.runtimeRegistry.unregisterTerminal(input.terminalId);
    });

    ipcMain.handle(desktopIpcChannels.provider.getTask, async (_event, input) => {
        const runtime = getRuntimeByInputSession(context.runtimeRegistry, input);
        const task = runtime.getTask(input.id);
        context.runtimeRegistry.registerTask(runtime, task.id);
        return {
            taskId: task.id,
            name: task.name,
            command: task.command,
        };
    });

    ipcMain.handle(desktopIpcChannels.provider.taskOpen, async (_event, input) => {
        return context.runtimeRegistry.getRuntimeByTaskId(input.taskId).getTask('dev').open();
    });

    ipcMain.handle(desktopIpcChannels.provider.taskRun, async (_event, input) => {
        const runtime = context.runtimeRegistry.getRuntimeByTaskId(input.taskId);
        const session = await context.launchProjectById(runtime.projectId);
        context.notifyProjectsUpdated(runtime.projectId);
        return session;
    });

    ipcMain.handle(desktopIpcChannels.provider.taskRestart, async (_event, input) => {
        const runtime = context.runtimeRegistry.getRuntimeByTaskId(input.taskId);
        await runtime.restartDevServer();
        context.notifyProjectsUpdated(runtime.projectId);
    });

    ipcMain.handle(desktopIpcChannels.provider.taskStop, async (_event, input) => {
        const runtime = context.runtimeRegistry.getRuntimeByTaskId(input.taskId);
        await runtime.stop();
        context.runtimeRegistry.clearRuntimeResources(runtime.id);
        context.notifyProjectsUpdated(runtime.projectId);
    });

    ipcMain.handle(desktopIpcChannels.provider.runCommand, async (_event, input) => {
        return getRuntimeByInputSession(context.runtimeRegistry, input).runCommand(input.command);
    });

    ipcMain.handle(desktopIpcChannels.provider.runBackgroundCommand, async (_event, input) => {
        const runtime = getRuntimeByInputSession(context.runtimeRegistry, input);
        const command = await runtime.createBackgroundCommand(input.command);
        context.runtimeRegistry.registerCommand(runtime, command);
        context.bindStreamOutput('command', command);
        return {
            commandId: command.id,
            name: command.name,
            command: command.command,
        };
    });

    ipcMain.handle(desktopIpcChannels.provider.backgroundCommandOpen, async (_event, input) => {
        return context.runtimeRegistry
            .getRuntimeByCommandId(input.commandId)
            .getBackgroundCommand(input.commandId)
            .open();
    });

    ipcMain.handle(desktopIpcChannels.provider.backgroundCommandRestart, async (_event, input) => {
        await context.runtimeRegistry
            .getRuntimeByCommandId(input.commandId)
            .getBackgroundCommand(input.commandId)
            .restart();
    });

    ipcMain.handle(desktopIpcChannels.provider.backgroundCommandKill, async (_event, input) => {
        const runtime = context.runtimeRegistry.getRuntimeByCommandId(input.commandId);
        await runtime.getBackgroundCommand(input.commandId).kill();
        context.runtimeRegistry.unregisterCommand(input.commandId);
    });

    ipcMain.handle(desktopIpcChannels.provider.gitStatus, async (_event, input) => {
        return getRuntimeByInputSession(context.runtimeRegistry, input).gitStatus();
    });

    ipcMain.handle(desktopIpcChannels.provider.reload, async (_event, input) => {
        const runtime = getRuntimeByInputSession(context.runtimeRegistry, input);
        await runtime.restartDevServer();
        context.notifyProjectsUpdated(runtime.projectId);
        return true;
    });

    ipcMain.handle(desktopIpcChannels.provider.reconnect, async (_event, input) => {
        const runtime = getRuntimeByInputSession(context.runtimeRegistry, input);
        const result = await context.reconnectRuntime(runtime.id);
        if (result) {
            context.notifyProjectsUpdated(runtime.projectId);
        }
    });

    ipcMain.handle(desktopIpcChannels.provider.ping, async (_event, input) => {
        const runtime = getRuntimeByInputSession(context.runtimeRegistry, input);
        return runtime.status === 'running';
    });

    ipcMain.handle(desktopIpcChannels.provider.pauseProject, async () => {
        return {};
    });

    ipcMain.handle(desktopIpcChannels.provider.stopProject, async (_event, input) => {
        const runtime = getRuntimeByInputSession(context.runtimeRegistry, input);
        await runtime.stop();
        context.runtimeRegistry.clearRuntimeResources(runtime.id);
        context.notifyProjectsUpdated(runtime.projectId);
        return {};
    });

    ipcMain.handle(desktopIpcChannels.provider.listProjects, async () => {
        return {
            projects: await context.listRecentProjects(),
        };
    });
}
