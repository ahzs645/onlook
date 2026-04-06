import { describe, expect, test } from 'bun:test';
import { resolveToolArtifact } from './tool-artifacts';

describe('resolveToolArtifact', () => {
    test('creates a typed code diff artifact for search-replace edits', () => {
        const artifact = resolveToolArtifact({
            toolName: 'search_replace_edit_file',
            toolInput: {
                file_path: 'app/page.tsx',
                old_string: 'old value',
                new_string: 'new value',
                branchId: 'branch-1',
            },
            toolOutput: null,
        });

        expect(artifact).toEqual({
            type: 'code_diff',
            path: 'app/page.tsx',
            originalContent: 'old value',
            newContent: 'new value',
            branchId: 'branch-1',
            showDiff: true,
        });
    });

    test('detects image/media artifacts from tool output payloads', () => {
        const artifact = resolveToolArtifact({
            toolName: 'unknown_tool',
            toolInput: null,
            toolOutput: {
                artifactType: 'image_media',
                title: 'Screenshot',
                imageUrl: 'https://example.com/screenshot.png',
                caption: 'Preview capture',
            },
        });

        expect(artifact).toEqual({
            type: 'image_media',
            title: 'Screenshot',
            url: 'https://example.com/screenshot.png',
            caption: 'Preview capture',
        });
    });

    test('falls back to design reference artifacts for figma-style payloads', () => {
        const artifact = resolveToolArtifact({
            toolName: 'unknown_tool',
            toolInput: null,
            toolOutput: {
                name: 'Hero section',
                nodeId: '12:34',
                figmaUrl: 'https://www.figma.com/file/example',
                previewUrl: 'https://example.com/preview.png',
            },
        });

        expect(artifact).toEqual({
            type: 'design_reference',
            title: 'Hero section',
            url: 'https://www.figma.com/file/example',
            previewUrl: 'https://example.com/preview.png',
            subtitle: '12:34',
        });
    });
});
