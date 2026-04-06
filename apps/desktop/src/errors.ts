export class DesktopRuntimeError extends Error {
    constructor(
        readonly code: string,
        message: string,
    ) {
        super(message);
        this.name = 'DesktopRuntimeError';
    }
}

export function createDesktopRuntimeError(code: string, message: string) {
    return new DesktopRuntimeError(code, message);
}

