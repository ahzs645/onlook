import debounce from 'lodash.debounce';

import { ONLOOK_CACHE_DIRECTORY, ONLOOK_PRELOAD_SCRIPT_FILE } from '@onlook/constants';
import { RouterType } from '@onlook/models';
import {
    addOidsToAst,
    createTemplateNodeMap,
    formatContent,
    getAstFromContent,
    getContentFromAst,
    getContentFromTemplateNode,
    injectPreloadScript,
} from '@onlook/parser';
import { isRootLayoutFile, pathsEqual } from '@onlook/utility';

import type { JsxElementMetadata } from './index-cache';
import { FileSystem } from './fs';
import {
    clearIndexCache,
    getIndexFromCache,
    getOrLoadIndex,
    saveIndexToCache,
} from './index-cache';

export type { JsxElementMetadata } from './index-cache';

export interface CodeEditorOptions {
    routerType?: RouterType;
}

const activeIndexCacheInstances = new Map<string, number>();
const indexWriteQueues = new Map<string, Promise<void>>();

function retainIndexCache(cacheKey: string) {
    activeIndexCacheInstances.set(cacheKey, (activeIndexCacheInstances.get(cacheKey) ?? 0) + 1);
}

function releaseIndexCache(cacheKey: string) {
    const nextCount = (activeIndexCacheInstances.get(cacheKey) ?? 1) - 1;
    if (nextCount > 0) {
        activeIndexCacheInstances.set(cacheKey, nextCount);
        return nextCount;
    }

    activeIndexCacheInstances.delete(cacheKey);
    return 0;
}

export class CodeFileSystem extends FileSystem {
    private projectId: string;
    private branchId: string;
    private cacheKey: string;
    private options: Required<CodeEditorOptions>;
    private indexPath = `${ONLOOK_CACHE_DIRECTORY}/index.json`;
    private readonly debouncedSaveIndexToFile: ReturnType<typeof debounce>;

    constructor(projectId: string, branchId: string, options: CodeEditorOptions = {}) {
        super(`/${projectId}/${branchId}`);
        this.projectId = projectId;
        this.branchId = branchId;
        this.cacheKey = `${this.projectId}/${this.branchId}`;
        this.options = {
            routerType: options.routerType ?? RouterType.APP,
        };
        retainIndexCache(this.cacheKey);
        this.debouncedSaveIndexToFile = debounce(() => {
            void this.enqueueIndexPersist();
        }, 1000);
    }

    async writeFile(path: string, content: string | Uint8Array): Promise<void> {
        if (this.isJsxFile(path) && typeof content === 'string') {
            const processedContent = await this.processJsxFile(path, content);
            await super.writeFile(path, processedContent);
        } else {
            await super.writeFile(path, content);
        }
    }

    async writeFiles(files: Array<{ path: string; content: string | Uint8Array }>): Promise<void> {
        // Write files sequentially to avoid race conditions to metadata file
        for (const { path, content } of files) {
            await this.writeFile(path, content);
        }
    }

    private async processJsxFile(path: string, content: string): Promise<string> {
        let processedContent = content;
        let shouldUpdateMetadata = false;

        const ast = getAstFromContent(content, { silent: true });
        if (ast) {
            if (isRootLayoutFile(path, this.options.routerType)) {
                injectPreloadScript(ast);
            }

            const existingOids = await this.getFileOids(path);
            const { ast: processedAst } = addOidsToAst(ast, existingOids);

            processedContent = await getContentFromAst(processedAst, content);
            shouldUpdateMetadata = true;
        } else {
            return content;
        }

        let finalContent = processedContent;
        try {
            finalContent = await formatContent(path, processedContent);
        } catch (error) {
            console.warn(`[CodeEditorApi] Failed to format ${path}, writing unformatted content`, error);
        }

        if (shouldUpdateMetadata) {
            try {
                await this.updateMetadataForFile(path, finalContent);
            } catch (error) {
                console.warn(`[CodeEditorApi] Failed to update metadata for ${path}`, error);
            }
        }

        return finalContent;
    }

    private async getFileOids(path: string): Promise<Set<string>> {
        const index = await this.loadIndex();

        const oids = new Set<string>();
        for (const [oid, metadata] of Object.entries(index)) {
            if (pathsEqual(metadata.path, path)) {
                oids.add(oid);
            }
        }
        return oids;
    }

    private async updateMetadataForFile(path: string, content: string): Promise<void> {
        const index = await this.loadIndex();

        for (const [oid, metadata] of Object.entries(index)) {
            if (pathsEqual(metadata.path, path)) {
                delete index[oid];
            }
        }

        const ast = getAstFromContent(content, { silent: true });
        if (!ast) return;

        const templateNodeMap = createTemplateNodeMap({
            ast,
            filename: path,
            branchId: this.branchId,
        });

        for (const [oid, node] of templateNodeMap.entries()) {
            const code = await getContentFromTemplateNode(node, content);
            const metadata: JsxElementMetadata = {
                ...node,
                oid,
                code: code || '',
            };
            index[oid] = metadata;
        }

        await this.saveIndex(index);
    }

    async getJsxElementMetadata(oid: string): Promise<JsxElementMetadata | undefined> {
        const index = await this.loadIndex();
        return index[oid];
    }

    async rebuildIndex(): Promise<void> {
        const startTime = Date.now();
        const index: Record<string, JsxElementMetadata> = {};

        const entries = await this.listAll();
        const jsxFiles = entries.filter(
            (entry) => entry.type === 'file' && this.isJsxFile(entry.path),
        );

        const BATCH_SIZE = 10;
        let processedCount = 0;

        for (let i = 0; i < jsxFiles.length; i += BATCH_SIZE) {
            const batch = jsxFiles.slice(i, i + BATCH_SIZE);
            await Promise.all(
                batch.map(async (entry) => {
                    try {
                        const content = await this.readFile(entry.path);
                        if (typeof content === 'string') {
                            const ast = getAstFromContent(content, { silent: true });
                            if (!ast) return;

                            const templateNodeMap = createTemplateNodeMap({
                                ast,
                                filename: entry.path,
                                branchId: this.branchId,
                            });

                            for (const [oid, node] of templateNodeMap.entries()) {
                                const code = await getContentFromTemplateNode(node, content);
                                index[oid] = {
                                    ...node,
                                    oid,
                                    code: code || '',
                                };
                            }

                            processedCount++;
                        }
                    } catch (error) {
                        console.error(`Error indexing ${entry.path}:`, error);
                    }
                }),
            );
        }

        await this.saveIndex(index);

        const duration = Date.now() - startTime;
        console.log(
            `[CodeEditorApi] Index built: ${Object.keys(index).length} elements from ${processedCount} files in ${duration}ms`,
        );
    }

    async deleteFile(path: string): Promise<void> {
        await super.deleteFile(path);

        if (this.isJsxFile(path)) {
            const index = await this.loadIndex();
            let hasChanges = false;

            for (const [oid, metadata] of Object.entries(index)) {
                if (pathsEqual(metadata.path, path)) {
                    delete index[oid];
                    hasChanges = true;
                }
            }

            if (hasChanges) {
                await this.saveIndex(index);
            }
        }
    }

    async moveFile(oldPath: string, newPath: string): Promise<void> {
        await super.moveFile(oldPath, newPath);

        if (this.isJsxFile(oldPath) && this.isJsxFile(newPath)) {
            const index = await this.loadIndex();
            let hasChanges = false;

            for (const metadata of Object.values(index)) {
                if (pathsEqual(metadata.path, oldPath)) {
                    metadata.path = newPath;
                    hasChanges = true;
                }
            }

            if (hasChanges) {
                await this.saveIndex(index);
            }
        }
    }

    private async loadIndex(): Promise<Record<string, JsxElementMetadata>> {
        return getOrLoadIndex(this.cacheKey, this.indexPath, (path) => this.readFile(path));
    }

    private async saveIndex(index: Record<string, JsxElementMetadata>): Promise<void> {
        saveIndexToCache(this.cacheKey, index);
        void this.debouncedSaveIndexToFile();
    }

    private async enqueueIndexPersist(): Promise<void> {
        const pendingWrite = indexWriteQueues.get(this.cacheKey) ?? Promise.resolve();
        const nextWrite = pendingWrite
            .catch(() => undefined)
            .then(async () => {
                await this.persistIndexToFile();
            });

        indexWriteQueues.set(this.cacheKey, nextWrite);

        try {
            await nextWrite;
        } finally {
            if (indexWriteQueues.get(this.cacheKey) === nextWrite) {
                indexWriteQueues.delete(this.cacheKey);
            }
        }
    }

    private async persistIndexToFile(): Promise<void> {
        try {
            await this.createDirectory(ONLOOK_CACHE_DIRECTORY);
        } catch {
            return;
        }

        const index = getIndexFromCache(this.cacheKey);
        if (index) {
            const tempIndexPath = `${this.indexPath}.tmp-${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`;
            try {
                await super.writeFile(tempIndexPath, JSON.stringify(index));
                if (await this.fileExists(this.indexPath)) {
                    await super.deleteFile(this.indexPath);
                }
                await super.moveFile(tempIndexPath, this.indexPath);
            } catch (error) {
                console.warn(`[CodeEditorApi] Failed to write ${this.indexPath}: ${error}`);
                if (await this.fileExists(tempIndexPath)) {
                    await super.deleteFile(tempIndexPath).catch(() => undefined);
                }
            }
        }
    }

    private isJsxFile(path: string): boolean {
        // Exclude the onlook preload script from JSX processing
        if (path.endsWith(ONLOOK_PRELOAD_SCRIPT_FILE)) {
            return false;
        }
        if (
            path.includes('/public/docs/')
            || path.includes('/public/vendor/')
            || path.includes('/docs/starlight/dist/')
            || path.includes('/docs/starlight/.astro/')
            || path.includes('/docs/starlight/node_modules/')
            || path.includes('/.next-prod/')
            || path.includes('/pagefind/')
            || path.includes('/_astro/')
            || path.endsWith('/component-sources.generated.ts')
            || path.includes('.generated.')
        ) {
            return false;
        }
        return /\.(jsx?|tsx?)$/i.test(path);
    }

    async cleanup(): Promise<void> {
        this.debouncedSaveIndexToFile.cancel();
        if (getIndexFromCache(this.cacheKey)) {
            await this.enqueueIndexPersist();
        }

        if (releaseIndexCache(this.cacheKey) === 0) {
            clearIndexCache(this.cacheKey);
        }
    }
}
