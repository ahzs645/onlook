import { contextBridge, ipcRenderer } from 'electron';

const getStreamChannel = (kind: 'terminal' | 'task' | 'command', id: string) => {
    return `desktop:provider:${kind}:${id}:output`;
};

const getWatchChannel = (watcherId: string) => {
    return `desktop:provider:watch:${watcherId}:event`;
};

function subscribe<T>(channel: string, callback: (payload: T) => void) {
    const listener = (_event: Electron.IpcRendererEvent, payload: T) => {
        callback(payload);
    };

    ipcRenderer.on(channel, listener);
    return () => {
        ipcRenderer.removeListener(channel, listener);
    };
}

contextBridge.exposeInMainWorld('onlookDesktop', {
    isDesktop: true,
    electronVersion: process.versions.electron,
    pickDirectory: () => ipcRenderer.invoke('desktop:pick-directory') as Promise<string | null>,
    inspectProject: (folderPath: string) =>
        ipcRenderer.invoke('desktop:inspect-project', folderPath),
    launchProject: (folderPath: string) =>
        ipcRenderer.invoke('desktop:launch-project', folderPath),
    getProjectSession: (sessionId: string) =>
        ipcRenderer.invoke('desktop:get-project-session', sessionId),
    openPath: (targetPath: string) => ipcRenderer.invoke('desktop:open-path', targetPath),
    openExternal: (targetUrl: string) =>
        ipcRenderer.invoke('desktop:open-external', targetUrl),
    provider: {
        writeFile: (input: unknown) => ipcRenderer.invoke('desktop:provider:write-file', input),
        renameFile: (input: unknown) => ipcRenderer.invoke('desktop:provider:rename-file', input),
        statFile: (input: unknown) => ipcRenderer.invoke('desktop:provider:stat-file', input),
        deleteFiles: (input: unknown) =>
            ipcRenderer.invoke('desktop:provider:delete-files', input),
        listFiles: (input: unknown) => ipcRenderer.invoke('desktop:provider:list-files', input),
        readFile: (input: unknown) => ipcRenderer.invoke('desktop:provider:read-file', input),
        downloadFiles: (input: unknown) =>
            ipcRenderer.invoke('desktop:provider:download-files', input),
        copyFiles: (input: unknown) => ipcRenderer.invoke('desktop:provider:copy-files', input),
        createDirectory: (input: unknown) =>
            ipcRenderer.invoke('desktop:provider:create-directory', input),
        watchFiles: (input: unknown) => ipcRenderer.invoke('desktop:provider:watch-files', input),
        unwatchFiles: (watcherId: string) =>
            ipcRenderer.invoke('desktop:provider:unwatch-files', watcherId),
        onWatchEvent: (watcherId: string, callback: (payload: unknown) => void) =>
            subscribe(getWatchChannel(watcherId), callback),
        createTerminal: (input: unknown) =>
            ipcRenderer.invoke('desktop:provider:create-terminal', input),
        terminalOpen: (input: unknown) =>
            ipcRenderer.invoke('desktop:provider:terminal-open', input),
        terminalWrite: (input: unknown) =>
            ipcRenderer.invoke('desktop:provider:terminal-write', input),
        terminalRun: (input: unknown) =>
            ipcRenderer.invoke('desktop:provider:terminal-run', input),
        terminalKill: (input: unknown) =>
            ipcRenderer.invoke('desktop:provider:terminal-kill', input),
        onTerminalOutput: (terminalId: string, callback: (payload: string) => void) =>
            subscribe(getStreamChannel('terminal', terminalId), callback),
        getTask: (input: unknown) => ipcRenderer.invoke('desktop:provider:get-task', input),
        taskOpen: (input: unknown) => ipcRenderer.invoke('desktop:provider:task-open', input),
        taskRun: (input: unknown) => ipcRenderer.invoke('desktop:provider:task-run', input),
        taskRestart: (input: unknown) =>
            ipcRenderer.invoke('desktop:provider:task-restart', input),
        taskStop: (input: unknown) => ipcRenderer.invoke('desktop:provider:task-stop', input),
        onTaskOutput: (taskId: string, callback: (payload: string) => void) =>
            subscribe(getStreamChannel('task', taskId), callback),
        runCommand: (input: unknown) =>
            ipcRenderer.invoke('desktop:provider:run-command', input),
        runBackgroundCommand: (input: unknown) =>
            ipcRenderer.invoke('desktop:provider:run-background-command', input),
        backgroundCommandOpen: (input: unknown) =>
            ipcRenderer.invoke('desktop:provider:background-command-open', input),
        backgroundCommandRestart: (input: unknown) =>
            ipcRenderer.invoke('desktop:provider:background-command-restart', input),
        backgroundCommandKill: (input: unknown) =>
            ipcRenderer.invoke('desktop:provider:background-command-kill', input),
        onBackgroundCommandOutput: (commandId: string, callback: (payload: string) => void) =>
            subscribe(getStreamChannel('command', commandId), callback),
        gitStatus: (input: unknown) => ipcRenderer.invoke('desktop:provider:git-status', input),
        reload: (input: unknown) => ipcRenderer.invoke('desktop:provider:reload', input),
        reconnect: (input: unknown) => ipcRenderer.invoke('desktop:provider:reconnect', input),
        ping: (input: unknown) => ipcRenderer.invoke('desktop:provider:ping', input),
        pauseProject: (input: unknown) =>
            ipcRenderer.invoke('desktop:provider:pause-project', input),
        stopProject: (input: unknown) =>
            ipcRenderer.invoke('desktop:provider:stop-project', input),
        listProjects: () => ipcRenderer.invoke('desktop:provider:list-projects'),
    },
});
