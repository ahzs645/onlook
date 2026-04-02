export function isFatalSandboxErrorMessage(message: string): boolean {
    const normalized = message.toLowerCase();

    return [
        'sandbox provider is not configured',
        'this sample project does not have a real sandbox',
        'sandbox id is missing',
        'unauthorized',
        'not implemented yet',
    ].some((fragment) => normalized.includes(fragment));
}

export function getSandboxUserFacingError(error: unknown): {
    title: string;
    description: string;
} {
    const fallback = {
        title: 'Failed to create project',
        description: error instanceof Error ? error.message : String(error),
    };

    const message = fallback.description.toLowerCase();

    if (
        message.includes('sandbox provider is not configured') ||
        message.includes('missing e2b_') ||
        message.includes('valid codesandbox api key')
    ) {
        return {
            title: 'Sandbox provider not configured',
            description:
                'Configure E2B or a valid CodeSandbox API key before creating or opening projects.',
        };
    }

    if (message.includes('sample project does not have a real sandbox')) {
        return {
            title: 'Sample project is not runnable',
            description:
                'This seeded demo does not have a live sandbox. Create a new project after configuring a sandbox provider.',
        };
    }

    if (message.includes('unauthorized')) {
        return {
            title: 'Sandbox access denied',
            description:
                'The configured sandbox backend rejected the request. Check the provider API key and sandbox settings.',
        };
    }

    if (message.includes('502')) {
        return {
            title: 'Sandbox service temporarily unavailable',
            description:
                'Please try again in a few moments. The sandbox backend may be starting up or unavailable.',
        };
    }

    return fallback;
}
