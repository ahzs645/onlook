import { createDesktopRuntimeError } from '../errors';
import { NODE_FS_SANDBOX_PREFIX } from '../types';
import type { ManagedProcess } from './managed-process';
import type { ManagedTerminal } from './managed-terminal';
import { DesktopProjectRuntime } from './runtime';

interface RuntimeResources {
    tasks: Set<string>;
    terminals: Set<string>;
    commands: Set<string>;
    watchers: Set<string>;
}

function createResources(): RuntimeResources {
    return {
        tasks: new Set<string>(),
        terminals: new Set<string>(),
        commands: new Set<string>(),
        watchers: new Set<string>(),
    };
}

export class RuntimeRegistry {
    private readonly runtimesById = new Map<string, DesktopProjectRuntime>();
    private readonly runtimeIdByFolderPath = new Map<string, string>();
    private readonly runtimeIdByProjectId = new Map<string, string>();
    private readonly resourcesByRuntimeId = new Map<string, RuntimeResources>();
    private readonly tasksById = new Map<string, string>();
    private readonly terminalsById = new Map<string, string>();
    private readonly commandsById = new Map<string, string>();
    private readonly watchersById = new Map<string, string>();

    registerRuntime(runtime: DesktopProjectRuntime) {
        this.runtimesById.set(runtime.id, runtime);
        this.runtimeIdByFolderPath.set(runtime.folderPath, runtime.id);
        this.runtimeIdByProjectId.set(runtime.projectId, runtime.id);
        this.ensureResources(runtime.id);
    }

    registerTask(runtime: DesktopProjectRuntime, taskId: string) {
        const resources = this.ensureResources(runtime.id);
        resources.tasks.add(taskId);
        this.tasksById.set(taskId, runtime.id);
    }

    registerTerminal(runtime: DesktopProjectRuntime, terminal: ManagedTerminal) {
        const resources = this.ensureResources(runtime.id);
        resources.terminals.add(terminal.id);
        this.terminalsById.set(terminal.id, runtime.id);
        terminal.onExit(() => {
            this.unregisterTerminal(terminal.id);
        });
    }

    registerCommand(runtime: DesktopProjectRuntime, command: ManagedProcess) {
        const resources = this.ensureResources(runtime.id);
        resources.commands.add(command.id);
        this.commandsById.set(command.id, runtime.id);
        command.onExit(() => {
            this.unregisterCommand(command.id);
        });
    }

    registerWatcher(runtime: DesktopProjectRuntime, watcherId: string) {
        const resources = this.ensureResources(runtime.id);
        resources.watchers.add(watcherId);
        this.watchersById.set(watcherId, runtime.id);
    }

    unregisterTask(taskId: string) {
        const runtimeId = this.tasksById.get(taskId);
        if (!runtimeId) {
            return;
        }
        this.tasksById.delete(taskId);
        this.resourcesByRuntimeId.get(runtimeId)?.tasks.delete(taskId);
    }

    unregisterTerminal(terminalId: string) {
        const runtimeId = this.terminalsById.get(terminalId);
        if (!runtimeId) {
            return;
        }
        this.terminalsById.delete(terminalId);
        this.resourcesByRuntimeId.get(runtimeId)?.terminals.delete(terminalId);
    }

    unregisterCommand(commandId: string) {
        const runtimeId = this.commandsById.get(commandId);
        if (!runtimeId) {
            return;
        }
        this.commandsById.delete(commandId);
        this.resourcesByRuntimeId.get(runtimeId)?.commands.delete(commandId);
    }

    unregisterWatcher(watcherId: string) {
        const runtimeId = this.watchersById.get(watcherId);
        if (!runtimeId) {
            return;
        }
        this.watchersById.delete(watcherId);
        this.resourcesByRuntimeId.get(runtimeId)?.watchers.delete(watcherId);
    }

    clearRuntimeResources(runtimeId: string) {
        const resources = this.resourcesByRuntimeId.get(runtimeId);
        if (!resources) {
            return;
        }

        for (const taskId of resources.tasks) {
            this.tasksById.delete(taskId);
        }
        for (const terminalId of resources.terminals) {
            this.terminalsById.delete(terminalId);
        }
        for (const commandId of resources.commands) {
            this.commandsById.delete(commandId);
        }
        for (const watcherId of resources.watchers) {
            this.watchersById.delete(watcherId);
        }

        this.resourcesByRuntimeId.set(runtimeId, createResources());
    }

    deleteRuntime(runtimeId: string) {
        const runtime = this.runtimesById.get(runtimeId);
        if (!runtime) {
            return;
        }

        this.clearRuntimeResources(runtimeId);
        this.resourcesByRuntimeId.delete(runtimeId);
        this.runtimesById.delete(runtimeId);
        this.runtimeIdByFolderPath.delete(runtime.folderPath);
        this.runtimeIdByProjectId.delete(runtime.projectId);
    }

    listRuntimes() {
        return Array.from(this.runtimesById.values());
    }

    listActiveRuntimes() {
        return this.listRuntimes().filter(
            (runtime) => runtime.status === 'starting' || runtime.status === 'running',
        );
    }

    getRuntimeByFolderPath(folderPath: string) {
        const runtimeId = this.runtimeIdByFolderPath.get(folderPath);
        if (!runtimeId) {
            return null;
        }
        return this.runtimesById.get(runtimeId) ?? null;
    }

    getRuntimeByProjectId(projectId: string) {
        const runtimeId = this.runtimeIdByProjectId.get(projectId);
        if (!runtimeId) {
            return null;
        }
        return this.runtimesById.get(runtimeId) ?? null;
    }

    getRuntimeBySessionId(sessionId: string) {
        return this.runtimesById.get(sessionId) ?? null;
    }

    getRuntimeBySandboxId(sandboxId: string) {
        if (!sandboxId.startsWith(NODE_FS_SANDBOX_PREFIX)) {
            throw createDesktopRuntimeError('DESKTOP_SANDBOX_INVALID', `Invalid desktop sandbox id: ${sandboxId}`);
        }

        const runtimeId = sandboxId.slice(NODE_FS_SANDBOX_PREFIX.length);
        const runtime = this.runtimesById.get(runtimeId);
        if (!runtime) {
            throw createDesktopRuntimeError('DESKTOP_SESSION_EXPIRED', `Desktop project session not found: ${runtimeId}`);
        }
        return runtime;
    }

    getRuntimeByTaskId(taskId: string) {
        const runtimeId = this.tasksById.get(taskId);
        if (runtimeId) {
            const runtime = this.runtimesById.get(runtimeId);
            if (runtime) {
                return runtime;
            }
        }

        const parsedRuntimeId = /^task:([^:]+):/.exec(taskId)?.[1] ?? null;
        if (parsedRuntimeId) {
            const runtime = this.runtimesById.get(parsedRuntimeId);
            if (runtime) {
                this.registerTask(runtime, taskId);
                return runtime;
            }
        }

        throw createDesktopRuntimeError('DESKTOP_TASK_EXPIRED', `Task not found: ${taskId}`);
    }

    getRuntimeByTerminalId(terminalId: string) {
        const runtimeId = this.terminalsById.get(terminalId);
        if (!runtimeId) {
            throw createDesktopRuntimeError('DESKTOP_TERMINAL_EXPIRED', `Terminal session not found: ${terminalId}`);
        }
        const runtime = this.runtimesById.get(runtimeId);
        if (!runtime) {
            throw createDesktopRuntimeError('DESKTOP_TERMINAL_EXPIRED', `Terminal session not found: ${terminalId}`);
        }
        return runtime;
    }

    getRuntimeByCommandId(commandId: string) {
        const runtimeId = this.commandsById.get(commandId);
        if (!runtimeId) {
            throw createDesktopRuntimeError('DESKTOP_COMMAND_EXPIRED', `Background command not found: ${commandId}`);
        }
        const runtime = this.runtimesById.get(runtimeId);
        if (!runtime) {
            throw createDesktopRuntimeError('DESKTOP_COMMAND_EXPIRED', `Background command not found: ${commandId}`);
        }
        return runtime;
    }

    getRuntimeByWatcherId(watcherId: string) {
        const runtimeId = this.watchersById.get(watcherId);
        if (!runtimeId) {
            return null;
        }
        return this.runtimesById.get(runtimeId) ?? null;
    }

    private ensureResources(runtimeId: string) {
        const existing = this.resourcesByRuntimeId.get(runtimeId);
        if (existing) {
            return existing;
        }
        const created = createResources();
        this.resourcesByRuntimeId.set(runtimeId, created);
        return created;
    }
}
