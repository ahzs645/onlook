import type { StreamKind } from '../runtime/managed-process';

export const desktopIpcChannels = {
    pickDirectory: 'desktop:pick-directory',
    inspectProject: 'desktop:inspect-project',
    saveProject: 'desktop:save-project',
    getProject: 'desktop:get-project',
    readChatStore: 'desktop:read-chat-store',
    writeChatStore: 'desktop:write-chat-store',
    saveProjectPreview: 'desktop:save-project-preview',
    launchProject: 'desktop:launch-project',
    launchProjectById: 'desktop:launch-project-by-id',
    getProjectSession: 'desktop:get-project-session',
    listProjects: 'desktop:list-projects',
    removeProject: 'desktop:remove-project',
    getSettings: 'desktop:get-settings',
    updateSettings: 'desktop:update-settings',
    updateProjectRuntime: 'desktop:update-project-runtime',
    openPath: 'desktop:open-path',
    openExternal: 'desktop:open-external',
    provider: {
        writeFile: 'desktop:provider:write-file',
        renameFile: 'desktop:provider:rename-file',
        statFile: 'desktop:provider:stat-file',
        deleteFiles: 'desktop:provider:delete-files',
        listFiles: 'desktop:provider:list-files',
        readFile: 'desktop:provider:read-file',
        downloadFiles: 'desktop:provider:download-files',
        copyFiles: 'desktop:provider:copy-files',
        createDirectory: 'desktop:provider:create-directory',
        watchFiles: 'desktop:provider:watch-files',
        unwatchFiles: 'desktop:provider:unwatch-files',
        createTerminal: 'desktop:provider:create-terminal',
        terminalOpen: 'desktop:provider:terminal-open',
        terminalWrite: 'desktop:provider:terminal-write',
        terminalRun: 'desktop:provider:terminal-run',
        terminalResize: 'desktop:provider:terminal-resize',
        terminalKill: 'desktop:provider:terminal-kill',
        getTask: 'desktop:provider:get-task',
        taskOpen: 'desktop:provider:task-open',
        taskRun: 'desktop:provider:task-run',
        taskRestart: 'desktop:provider:task-restart',
        taskStop: 'desktop:provider:task-stop',
        runCommand: 'desktop:provider:run-command',
        runBackgroundCommand: 'desktop:provider:run-background-command',
        backgroundCommandOpen: 'desktop:provider:background-command-open',
        backgroundCommandRestart: 'desktop:provider:background-command-restart',
        backgroundCommandKill: 'desktop:provider:background-command-kill',
        gitStatus: 'desktop:provider:git-status',
        reload: 'desktop:provider:reload',
        reconnect: 'desktop:provider:reconnect',
        ping: 'desktop:provider:ping',
        pauseProject: 'desktop:provider:pause-project',
        stopProject: 'desktop:provider:stop-project',
        listProjects: 'desktop:provider:list-projects',
    },
    events: {
        projectsUpdated: 'desktop:projects:updated',
        prepareToQuit: 'desktop:app:prepare-to-quit',
    },
} as const;

export function getProviderStreamChannel(kind: StreamKind, id: string) {
    return `desktop:provider:${kind}:${id}:output`;
}

export function getProviderWatchChannel(watcherId: string) {
    return `desktop:provider:watch:${watcherId}:event`;
}
