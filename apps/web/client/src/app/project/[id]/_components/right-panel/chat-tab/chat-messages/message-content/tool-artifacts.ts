import {
    FuzzyEditFileTool,
    SearchReplaceEditTool,
    SearchReplaceMultiEditFileTool,
    TerminalCommandTool,
    TypecheckTool,
    WriteFileTool,
} from '@onlook/ai';

export type ToolArtifactResult =
    | {
        type: 'terminal';
        command: string;
        output: string | null;
        error: string | null;
        exitCode?: number | null;
    }
    | {
        type: 'code_diff';
        path: string;
        originalContent: string;
        newContent: string;
        branchId?: string;
        showDiff: boolean;
    }
    | {
        type: 'image_media';
        title: string;
        url: string;
        caption?: string;
    }
    | {
        type: 'design_reference';
        title: string;
        url: string;
        previewUrl?: string;
        subtitle?: string;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object';
}

function getStringValue(value: unknown, keys: string[]) {
    if (!isRecord(value)) {
        return null;
    }

    for (const key of keys) {
        const candidate = value[key];
        if (typeof candidate === 'string' && candidate.trim().length > 0) {
            return candidate;
        }
    }

    return null;
}

function isImageLikeUrl(value: string) {
    return /^data:image\//.test(value) || /\.(png|jpe?g|gif|webp|svg)(\?.*)?$/i.test(value);
}

function resolveArtifactFromOutput(output: unknown): ToolArtifactResult | null {
    if (!isRecord(output)) {
        return null;
    }

    const artifactType = output.artifactType;
    if (artifactType === 'image_media') {
        const url = getStringValue(output, ['url', 'imageUrl', 'dataUrl', 'base64']);
        if (!url) {
            return null;
        }
        return {
            type: 'image_media',
            title: getStringValue(output, ['title', 'name']) ?? 'Generated media',
            url,
            caption: getStringValue(output, ['caption', 'description']) ?? undefined,
        };
    }

    if (artifactType === 'design_reference') {
        const url = getStringValue(output, ['url', 'figmaUrl', 'sourceUrl']);
        if (!url) {
            return null;
        }
        return {
            type: 'design_reference',
            title: getStringValue(output, ['title', 'name']) ?? 'Design reference',
            url,
            previewUrl: getStringValue(output, ['previewUrl', 'imageUrl']) ?? undefined,
            subtitle: getStringValue(output, ['subtitle', 'nodeId']) ?? undefined,
        };
    }

    const designUrl = getStringValue(output, ['figmaUrl', 'sourceUrl']);
    if (designUrl) {
        return {
            type: 'design_reference',
            title: getStringValue(output, ['title', 'name']) ?? 'Design reference',
            url: designUrl,
            previewUrl: getStringValue(output, ['previewUrl', 'imageUrl']) ?? undefined,
            subtitle: getStringValue(output, ['subtitle', 'nodeId']) ?? undefined,
        };
    }

    const imageUrl = getStringValue(output, ['imageUrl', 'previewUrl', 'dataUrl', 'url', 'base64']);
    if (imageUrl && isImageLikeUrl(imageUrl)) {
        return {
            type: 'image_media',
            title: getStringValue(output, ['title', 'name']) ?? 'Generated media',
            url: imageUrl,
            caption: getStringValue(output, ['caption', 'description']) ?? undefined,
        };
    }

    return null;
}

export function resolveToolArtifact(input: {
    toolName: string;
    toolInput: unknown;
    toolOutput: unknown;
}): ToolArtifactResult | null {
    if (input.toolName === TerminalCommandTool.toolName) {
        const args = isRecord(input.toolInput) ? input.toolInput : {};
        const result = isRecord(input.toolOutput) ? input.toolOutput : {};
        const command = getStringValue(args, ['command']);
        if (!command) {
            return null;
        }

        return {
            type: 'terminal',
            command,
            output: getStringValue(result, ['output']),
            error: getStringValue(result, ['error']),
            exitCode: typeof result.exitCode === 'number' ? result.exitCode : null,
        };
    }

    if (input.toolName === TypecheckTool.toolName) {
        const result = isRecord(input.toolOutput) ? input.toolOutput : {};
        return {
            type: 'terminal',
            command: 'bunx tsc --noEmit',
            output:
                result.success === true
                    ? 'Typecheck passed.'
                    : getStringValue(result, ['output', 'error']),
            error: getStringValue(result, ['error']),
            exitCode: result.success === true ? 0 : 1,
        };
    }

    if (input.toolName === WriteFileTool.toolName || input.toolName === FuzzyEditFileTool.toolName) {
        const args = isRecord(input.toolInput) ? input.toolInput : {};
        const path = getStringValue(args, ['file_path']);
        const newContent = getStringValue(args, ['content']);
        if (!path || newContent === null) {
            return null;
        }

        return {
            type: 'code_diff',
            path,
            originalContent: '',
            newContent,
            branchId: getStringValue(args, ['branchId']) ?? undefined,
            showDiff: false,
        };
    }

    if (input.toolName === SearchReplaceEditTool.toolName) {
        const args = isRecord(input.toolInput) ? input.toolInput : {};
        const path = getStringValue(args, ['file_path']);
        const originalContent = getStringValue(args, ['old_string']);
        const newContent = getStringValue(args, ['new_string']);
        if (!path || originalContent === null || newContent === null) {
            return null;
        }

        return {
            type: 'code_diff',
            path,
            originalContent,
            newContent,
            branchId: getStringValue(args, ['branchId']) ?? undefined,
            showDiff: true,
        };
    }

    if (input.toolName === SearchReplaceMultiEditFileTool.toolName) {
        const args = isRecord(input.toolInput) ? input.toolInput : {};
        const path = getStringValue(args, ['file_path']);
        const edits = Array.isArray(args.edits) ? args.edits : [];
        if (!path || edits.length === 0) {
            return null;
        }

        return {
            type: 'code_diff',
            path,
            originalContent: edits
                .map((edit) => getStringValue(edit, ['old_string']) ?? '')
                .join('\n...\n'),
            newContent: edits
                .map((edit) => getStringValue(edit, ['new_string']) ?? '')
                .join('\n...\n'),
            branchId: getStringValue(args, ['branchId']) ?? undefined,
            showDiff: true,
        };
    }

    return resolveArtifactFromOutput(input.toolOutput);
}
