import type { CreateSessionOutput } from '../../types';

export interface E2BSession extends CreateSessionOutput {
    sandboxId: string;
    accessToken?: string;
    domain?: string;
}

export interface E2BProviderOptions {
    sandboxId?: string;
    userId?: string;
    apiKey?: string;
    accessToken?: string;
    domain?: string;
    timeoutMs?: number;
    initClient?: boolean;
    getSession?: (sandboxId: string, userId?: string) => Promise<E2BSession | null>;
}
