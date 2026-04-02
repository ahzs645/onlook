import { type Provider } from '@onlook/code-provider';
import {
    createConfiguredSandboxProviderClient,
    getConfiguredSandboxStaticProvider,
} from '@/server/sandbox/provider';

export async function forkBuildSandbox(
    sandboxId: string,
    userId: string,
    deploymentId: string,
): Promise<{ provider: Provider; sandboxId: string }> {
    const SandboxProvider = await getConfiguredSandboxStaticProvider();
    const project = await SandboxProvider.createProject({
        source: 'template',
        id: sandboxId,
        title: 'Deployment Fork of ' + sandboxId,
        description: 'Forked sandbox for deployment',
        tags: ['deployment', 'preview', userId, deploymentId],
    });

    const forkedProvider = await createConfiguredSandboxProviderClient({
        sandboxId: project.id,
        userId,
    });

    return {
        provider: forkedProvider,
        sandboxId: project.id,
    };
}
