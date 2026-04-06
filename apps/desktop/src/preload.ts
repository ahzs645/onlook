import { contextBridge, ipcRenderer } from 'electron';
import { desktopIpcChannels, getProviderStreamChannel, getProviderWatchChannel } from './ipc/channels';

function subscribe<T>(channel: string, callback: (payload: T) => void) {
    const listener = (_event: Electron.IpcRendererEvent, payload: T) => {
        callback(payload);
    };

    ipcRenderer.on(channel, listener);
    return () => {
        ipcRenderer.removeListener(channel, listener);
    };
}

ipcRenderer.on(desktopIpcChannels.events.prepareToQuit, (_event, payload) => {
    window.dispatchEvent(
        new CustomEvent('onlook-desktop:prepare-to-quit', {
            detail: payload,
        }),
    );
});

contextBridge.exposeInMainWorld('onlookDesktop', {
    isDesktop: true,
    electronVersion: process.versions.electron,
    pickDirectory: () => ipcRenderer.invoke(desktopIpcChannels.pickDirectory) as Promise<string | null>,
    inspectProject: (folderPath: string) =>
        ipcRenderer.invoke(desktopIpcChannels.inspectProject, folderPath),
    saveProject: (folderPath: string) =>
        ipcRenderer.invoke(desktopIpcChannels.saveProject, folderPath),
    getProject: (projectId: string) => ipcRenderer.invoke(desktopIpcChannels.getProject, projectId),
    readChatStore: (projectId: string) =>
        ipcRenderer.invoke(desktopIpcChannels.readChatStore, projectId),
    writeChatStore: (projectId: string, content: string) =>
        ipcRenderer.invoke(desktopIpcChannels.writeChatStore, projectId, content),
    saveProjectPreview: (projectId: string, previewImageDataUrl: string) =>
        ipcRenderer.invoke(desktopIpcChannels.saveProjectPreview, projectId, previewImageDataUrl),
    launchProject: (folderPath: string) =>
        ipcRenderer.invoke(desktopIpcChannels.launchProject, folderPath),
    launchProjectById: (projectId: string) =>
        ipcRenderer.invoke(desktopIpcChannels.launchProjectById, projectId),
    getProjectSession: (sessionId: string) =>
        ipcRenderer.invoke(desktopIpcChannels.getProjectSession, sessionId),
    listProjects: () => ipcRenderer.invoke(desktopIpcChannels.listProjects),
    getSettings: () => ipcRenderer.invoke(desktopIpcChannels.getSettings),
    updateSettings: (input: unknown) => ipcRenderer.invoke(desktopIpcChannels.updateSettings, input),
    updateProjectRuntime: (input: unknown) =>
        ipcRenderer.invoke(desktopIpcChannels.updateProjectRuntime, input),
    onProjectsUpdated: (callback: (payload: { projectId: string }) => void) =>
        subscribe(desktopIpcChannels.events.projectsUpdated, callback),
    onPrepareToQuit: (callback: (payload: { reason: 'app-quit' }) => void) =>
        subscribe(desktopIpcChannels.events.prepareToQuit, callback),
    removeProject: (projectId: string) =>
        ipcRenderer.invoke(desktopIpcChannels.removeProject, projectId),
    openPath: (targetPath: string) => ipcRenderer.invoke(desktopIpcChannels.openPath, targetPath),
    openExternal: (targetUrl: string) =>
        ipcRenderer.invoke(desktopIpcChannels.openExternal, targetUrl),
    provider: {
        writeFile: (input: unknown) => ipcRenderer.invoke(desktopIpcChannels.provider.writeFile, input),
        renameFile: (input: unknown) => ipcRenderer.invoke(desktopIpcChannels.provider.renameFile, input),
        statFile: (input: unknown) => ipcRenderer.invoke(desktopIpcChannels.provider.statFile, input),
        deleteFiles: (input: unknown) =>
            ipcRenderer.invoke(desktopIpcChannels.provider.deleteFiles, input),
        listFiles: (input: unknown) => ipcRenderer.invoke(desktopIpcChannels.provider.listFiles, input),
        readFile: (input: unknown) => ipcRenderer.invoke(desktopIpcChannels.provider.readFile, input),
        downloadFiles: (input: unknown) =>
            ipcRenderer.invoke(desktopIpcChannels.provider.downloadFiles, input),
        copyFiles: (input: unknown) => ipcRenderer.invoke(desktopIpcChannels.provider.copyFiles, input),
        createDirectory: (input: unknown) =>
            ipcRenderer.invoke(desktopIpcChannels.provider.createDirectory, input),
        watchFiles: (input: unknown) => ipcRenderer.invoke(desktopIpcChannels.provider.watchFiles, input),
        unwatchFiles: (watcherId: string) =>
            ipcRenderer.invoke(desktopIpcChannels.provider.unwatchFiles, watcherId),
        onWatchEvent: (watcherId: string, callback: (payload: unknown) => void) =>
            subscribe(getProviderWatchChannel(watcherId), callback),
        createTerminal: (input: unknown) =>
            ipcRenderer.invoke(desktopIpcChannels.provider.createTerminal, input),
        terminalOpen: (input: unknown) =>
            ipcRenderer.invoke(desktopIpcChannels.provider.terminalOpen, input),
        terminalWrite: (input: unknown) =>
            ipcRenderer.invoke(desktopIpcChannels.provider.terminalWrite, input),
        terminalRun: (input: unknown) =>
            ipcRenderer.invoke(desktopIpcChannels.provider.terminalRun, input),
        terminalResize: (input: unknown) =>
            ipcRenderer.invoke(desktopIpcChannels.provider.terminalResize, input),
        terminalKill: (input: unknown) =>
            ipcRenderer.invoke(desktopIpcChannels.provider.terminalKill, input),
        onTerminalOutput: (terminalId: string, callback: (payload: string) => void) =>
            subscribe(getProviderStreamChannel('terminal', terminalId), callback),
        getTask: (input: unknown) => ipcRenderer.invoke(desktopIpcChannels.provider.getTask, input),
        taskOpen: (input: unknown) => ipcRenderer.invoke(desktopIpcChannels.provider.taskOpen, input),
        taskRun: (input: unknown) => ipcRenderer.invoke(desktopIpcChannels.provider.taskRun, input),
        taskRestart: (input: unknown) =>
            ipcRenderer.invoke(desktopIpcChannels.provider.taskRestart, input),
        taskStop: (input: unknown) => ipcRenderer.invoke(desktopIpcChannels.provider.taskStop, input),
        onTaskOutput: (taskId: string, callback: (payload: string) => void) =>
            subscribe(getProviderStreamChannel('task', taskId), callback),
        runCommand: (input: unknown) =>
            ipcRenderer.invoke(desktopIpcChannels.provider.runCommand, input),
        runBackgroundCommand: (input: unknown) =>
            ipcRenderer.invoke(desktopIpcChannels.provider.runBackgroundCommand, input),
        backgroundCommandOpen: (input: unknown) =>
            ipcRenderer.invoke(desktopIpcChannels.provider.backgroundCommandOpen, input),
        backgroundCommandRestart: (input: unknown) =>
            ipcRenderer.invoke(desktopIpcChannels.provider.backgroundCommandRestart, input),
        backgroundCommandKill: (input: unknown) =>
            ipcRenderer.invoke(desktopIpcChannels.provider.backgroundCommandKill, input),
        onBackgroundCommandOutput: (commandId: string, callback: (payload: string) => void) =>
            subscribe(getProviderStreamChannel('command', commandId), callback),
        gitStatus: (input: unknown) => ipcRenderer.invoke(desktopIpcChannels.provider.gitStatus, input),
        reload: (input: unknown) => ipcRenderer.invoke(desktopIpcChannels.provider.reload, input),
        reconnect: (input: unknown) => ipcRenderer.invoke(desktopIpcChannels.provider.reconnect, input),
        ping: (input: unknown) => ipcRenderer.invoke(desktopIpcChannels.provider.ping, input),
        pauseProject: (input: unknown) =>
            ipcRenderer.invoke(desktopIpcChannels.provider.pauseProject, input),
        stopProject: (input: unknown) =>
            ipcRenderer.invoke(desktopIpcChannels.provider.stopProject, input),
        listProjects: () => ipcRenderer.invoke(desktopIpcChannels.provider.listProjects),
    },
});
