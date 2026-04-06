import type { DesktopProjectSummary, RuntimeBackendKind } from '../types';
import type { ManagedProcess } from './managed-process';
import type { ManagedTerminal } from './managed-terminal';

export interface RuntimeBackend {
    readonly kind: RuntimeBackendKind;
    readonly task: ManagedProcess;

    get port(): number;
    get previewUrl(): string;

    setSummary(summary: DesktopProjectSummary): void;
    toProjectSummary(): DesktopProjectSummary;

    start(): Promise<void>;
    restart(): Promise<void>;
    stop(): Promise<void>;

    createTerminal(): Promise<ManagedTerminal>;
    getTerminal(id: string): ManagedTerminal;

    runCommand(command: string): Promise<{ output: string }>;
    createBackgroundCommand(command: string): Promise<ManagedProcess>;
    getBackgroundCommand(id: string): ManagedProcess;
}
