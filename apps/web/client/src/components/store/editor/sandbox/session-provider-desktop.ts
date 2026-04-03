import {
    CodeProvider,
    createCodeProviderClient,
    type Provider,
} from '@onlook/code-provider/browser';

export async function createDesktopSessionProvider(sandboxId: string): Promise<Provider> {
    return createCodeProviderClient(CodeProvider.NodeFs, {
        providerOptions: {
            nodefs: {
                sandboxId,
            },
        },
    });
}
