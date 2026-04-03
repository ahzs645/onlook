import type { Provider } from './types';
import { CodeProvider } from './providers';
import type { CodesandboxProviderOptions } from './providers/codesandbox';
import type { E2BProviderOptions, E2BSession } from './providers/e2b/shared';
import type {
    NodeFsDesktopProviderBridge,
    NodeFsProviderOptions,
} from './providers/nodefs';

export * from './providers';
export * from './types';
export { createNodeFsSandboxId, parseNodeFsSandboxId } from './providers/nodefs';
export type { CodesandboxProviderOptions } from './providers/codesandbox';
export type { E2BSession } from './providers/e2b/shared';
export type { NodeFsDesktopProviderBridge, NodeFsProviderOptions } from './providers/nodefs';

export interface BrowserProviderInstanceOptions {
    codesandbox?: CodesandboxProviderOptions;
    e2b?: E2BProviderOptions;
    nodefs?: NodeFsProviderOptions;
}

export interface CreateBrowserClientOptions {
    providerOptions: BrowserProviderInstanceOptions;
}

export async function createCodeProviderClient(
    codeProvider: CodeProvider,
    { providerOptions }: CreateBrowserClientOptions,
): Promise<Provider> {
    if (codeProvider === CodeProvider.CodeSandbox) {
        if (!providerOptions.codesandbox) {
            throw new Error('Codesandbox provider options are required.');
        }
        const mod = await import('./providers/codesandbox');
        const provider = new mod.CodesandboxProvider(providerOptions.codesandbox);
        await provider.initialize({});
        return provider;
    }

    if (codeProvider === CodeProvider.NodeFs) {
        if (!providerOptions.nodefs) {
            throw new Error('NodeFs provider options are required.');
        }
        const mod = await import('./providers/nodefs');
        const provider = new mod.NodeFsProvider(providerOptions.nodefs);
        await provider.initialize({});
        return provider;
    }

    if (codeProvider === CodeProvider.E2B) {
        throw new Error('E2B is not supported in the browser-safe code provider entrypoint');
    }

    throw new Error(`Unimplemented code provider: ${codeProvider}`);
}
