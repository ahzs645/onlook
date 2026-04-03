'use client';

import { ONLOOK_CACHE_DIRECTORY } from '@onlook/constants';
import {
    AgentType,
    type ChatConversation,
    type ChatMessage,
} from '@onlook/models';
import { v4 as uuidv4 } from 'uuid';

import { isDesktopLocalProjectId, parseDesktopLocalProjectId } from './desktop-local';

const DESKTOP_LOCAL_CHAT_STORE_PATH = `${ONLOOK_CACHE_DIRECTORY}/desktop-chat.json`;

export type DesktopLocalChatCli = 'claude';

export interface DesktopLocalStoredConversation extends ChatConversation {
    cliSessionId: string | null;
    cliType: DesktopLocalChatCli | null;
}

interface DesktopLocalChatStore {
    version: 1;
    conversations: DesktopLocalStoredConversation[];
    messagesByConversationId: Record<string, ChatMessage[]>;
}

type ChatMessageMetadata = NonNullable<ChatMessage['metadata']>;

const cliDetectionByProject = new Map<string, Promise<DesktopLocalChatCli | null>>();

function createEmptyChatStore(): DesktopLocalChatStore {
    return {
        version: 1,
        conversations: [],
        messagesByConversationId: {},
    };
}

function ensureDesktopLocalProject(projectId: string) {
    if (!isDesktopLocalProjectId(projectId)) {
        throw new Error(`Project is not a desktop-local project: ${projectId}`);
    }

    const sessionId = parseDesktopLocalProjectId(projectId);
    if (!sessionId) {
        throw new Error(`Desktop-local project id is invalid: ${projectId}`);
    }

    const bridge = window.onlookDesktop?.provider;
    if (!bridge) {
        throw new Error('Desktop provider bridge is not available in this renderer');
    }

    return {
        sessionId,
        bridge,
    };
}

function toDate(value: unknown): Date {
    if (value instanceof Date) {
        return value;
    }

    if (typeof value === 'string' || typeof value === 'number') {
        const parsed = new Date(value);
        if (!Number.isNaN(parsed.getTime())) {
            return parsed;
        }
    }

    return new Date();
}

function hydrateCheckpoints(
    checkpoints: unknown,
): ChatMessageMetadata['checkpoints'] {
    if (!Array.isArray(checkpoints)) {
        return [];
    }

    return checkpoints.map((checkpoint) => {
        if (!checkpoint || typeof checkpoint !== 'object') {
            return checkpoint as never;
        }

        const candidate = checkpoint as Record<string, unknown>;
        return {
            ...candidate,
            createdAt: toDate(candidate.createdAt),
        } as ChatMessageMetadata['checkpoints'][number];
    });
}

function hydrateMessage(message: unknown): ChatMessage {
    const candidate = (message ?? {}) as Record<string, unknown>;
    const base = candidate as unknown as Partial<ChatMessage>;
    const metadata =
        candidate.metadata && typeof candidate.metadata === 'object'
            ? (candidate.metadata as Record<string, unknown>)
            : null;
    const role = candidate.role;
    const parts = Array.isArray(candidate.parts)
        ? (candidate.parts as ChatMessage['parts'])
        : [];

    return {
        ...base,
        id: typeof candidate.id === 'string' ? candidate.id : uuidv4(),
        role:
            role === 'assistant' || role === 'user' || role === 'system'
                ? role
                : 'assistant',
        parts,
        metadata: metadata
            && typeof metadata.conversationId === 'string'
            ? {
                ...(metadata as Partial<ChatMessageMetadata>),
                createdAt: toDate(metadata.createdAt),
                conversationId: metadata.conversationId,
                checkpoints: hydrateCheckpoints(metadata.checkpoints),
                context: Array.isArray(metadata.context)
                    ? (metadata.context as ChatMessageMetadata['context'])
                    : [],
                error: typeof metadata.error === 'string' ? metadata.error : undefined,
            }
            : undefined,
    };
}

function hydrateConversation(conversation: unknown): DesktopLocalStoredConversation {
    const candidate = (conversation ?? {}) as Record<string, unknown>;
    return {
        id: typeof candidate.id === 'string' ? candidate.id : uuidv4(),
        agentType:
            candidate.agentType === AgentType.ROOT || candidate.agentType === AgentType.USER
                ? candidate.agentType
                : AgentType.ROOT,
        title: typeof candidate.title === 'string' ? candidate.title : null,
        projectId: typeof candidate.projectId === 'string' ? candidate.projectId : '',
        createdAt: toDate(candidate.createdAt),
        updatedAt: toDate(candidate.updatedAt),
        suggestions: Array.isArray(candidate.suggestions)
            ? (candidate.suggestions as ChatConversation['suggestions'])
            : [],
        cliSessionId: typeof candidate.cliSessionId === 'string' ? candidate.cliSessionId : null,
        cliType: candidate.cliType === 'claude' ? 'claude' : null,
    };
}

function hydrateStore(store: unknown): DesktopLocalChatStore {
    if (!store || typeof store !== 'object') {
        return createEmptyChatStore();
    }

    const candidate = store as Record<string, unknown>;
    const conversations = Array.isArray(candidate.conversations)
        ? candidate.conversations.map((conversation) => hydrateConversation(conversation))
        : [];
    const rawMessages = candidate.messagesByConversationId;
    const messagesByConversationId: Record<string, ChatMessage[]> = {};

    if (rawMessages && typeof rawMessages === 'object') {
        for (const [conversationId, messages] of Object.entries(rawMessages)) {
            messagesByConversationId[conversationId] = Array.isArray(messages)
                ? messages.map((message) => hydrateMessage(message))
                : [];
        }
    }

    return {
        version: 1,
        conversations,
        messagesByConversationId,
    };
}

function isMissingFileError(error: unknown) {
    return error instanceof Error && /ENOENT|not found/i.test(error.message);
}

async function readDesktopLocalChatStore(projectId: string): Promise<DesktopLocalChatStore> {
    const { bridge, sessionId } = ensureDesktopLocalProject(projectId);

    try {
        const directoryListing = await bridge.listFiles({
            sessionId,
            path: ONLOOK_CACHE_DIRECTORY,
        });
        const hasStoreFile = directoryListing.files.some(
            (entry) => entry.type === 'file' && entry.name === 'desktop-chat.json',
        );
        if (!hasStoreFile) {
            return createEmptyChatStore();
        }

        const result = await bridge.readFile({
            sessionId,
            path: DESKTOP_LOCAL_CHAT_STORE_PATH,
        });

        const content = result.file.content;
        if (typeof content !== 'string' || content.trim().length === 0) {
            return createEmptyChatStore();
        }

        return hydrateStore(JSON.parse(content));
    } catch (error) {
        if (isMissingFileError(error)) {
            return createEmptyChatStore();
        }
        throw error;
    }
}

async function writeDesktopLocalChatStore(projectId: string, store: DesktopLocalChatStore) {
    const { bridge, sessionId } = ensureDesktopLocalProject(projectId);

    await bridge.createDirectory({
        sessionId,
        path: ONLOOK_CACHE_DIRECTORY,
    });

    await bridge.writeFile({
        sessionId,
        path: DESKTOP_LOCAL_CHAT_STORE_PATH,
        content: JSON.stringify(store, null, 2),
        overwrite: true,
    });
}

function sortConversations(conversations: DesktopLocalStoredConversation[]) {
    return [...conversations].sort(
        (left, right) => right.updatedAt.getTime() - left.updatedAt.getTime(),
    );
}

export function createDesktopLocalConversation(
    projectId: string,
): DesktopLocalStoredConversation {
    const now = new Date();

    return {
        id: uuidv4(),
        agentType: AgentType.ROOT,
        title: null,
        projectId,
        createdAt: now,
        updatedAt: now,
        suggestions: [],
        cliSessionId: null,
        cliType: null,
    };
}

export function deriveDesktopLocalConversationTitle(content: string): string | null {
    const normalized = content
        .replace(/\s+/g, ' ')
        .replace(/[.?!,:;]+$/g, '')
        .trim();

    if (!normalized) {
        return null;
    }

    const words = normalized.split(' ').slice(0, 6);
    const title = words.join(' ').trim();
    if (!title) {
        return null;
    }

    return title.length > 60 ? `${title.slice(0, 57).trimEnd()}...` : title;
}

export async function listDesktopLocalConversations(
    projectId: string,
): Promise<DesktopLocalStoredConversation[]> {
    const store = await readDesktopLocalChatStore(projectId);
    return sortConversations(store.conversations);
}

export async function getDesktopLocalConversation(
    projectId: string,
    conversationId: string,
): Promise<DesktopLocalStoredConversation | null> {
    const store = await readDesktopLocalChatStore(projectId);
    return store.conversations.find((conversation) => conversation.id === conversationId) ?? null;
}

export async function upsertDesktopLocalConversation(
    projectId: string,
    conversation: DesktopLocalStoredConversation,
): Promise<DesktopLocalStoredConversation> {
    const store = await readDesktopLocalChatStore(projectId);
    const existingIndex = store.conversations.findIndex((item) => item.id === conversation.id);
    const nextConversation = hydrateConversation({
        ...conversation,
        projectId,
        updatedAt: conversation.updatedAt ?? new Date(),
    });

    if (existingIndex === -1) {
        store.conversations.push(nextConversation);
    } else {
        store.conversations[existingIndex] = {
            ...store.conversations[existingIndex],
            ...nextConversation,
        };
    }

    store.conversations = sortConversations(store.conversations);
    await writeDesktopLocalChatStore(projectId, store);
    return nextConversation;
}

export async function updateDesktopLocalConversation(
    projectId: string,
    conversationId: string,
    updates: Partial<DesktopLocalStoredConversation>,
): Promise<DesktopLocalStoredConversation | null> {
    const store = await readDesktopLocalChatStore(projectId);
    const existingIndex = store.conversations.findIndex((conversation) => conversation.id === conversationId);
    if (existingIndex === -1) {
        const createdConversation = hydrateConversation({
            ...createDesktopLocalConversation(projectId),
            ...updates,
            id: conversationId,
            projectId,
            updatedAt: updates.updatedAt ?? new Date(),
        });
        store.conversations.push(createdConversation);
        store.conversations = sortConversations(store.conversations);
        await writeDesktopLocalChatStore(projectId, store);
        return createdConversation;
    }

    const existingConversation = store.conversations[existingIndex];
    if (!existingConversation) {
        return null;
    }

    const updatedConversation = hydrateConversation({
        ...existingConversation,
        ...updates,
        id: existingConversation.id,
        projectId,
        createdAt: existingConversation.createdAt,
        updatedAt: updates.updatedAt ?? new Date(),
    });
    store.conversations[existingIndex] = updatedConversation;
    store.conversations = sortConversations(store.conversations);
    await writeDesktopLocalChatStore(projectId, store);
    return updatedConversation;
}

export async function deleteDesktopLocalConversation(projectId: string, conversationId: string) {
    const store = await readDesktopLocalChatStore(projectId);
    store.conversations = store.conversations.filter((conversation) => conversation.id !== conversationId);
    delete store.messagesByConversationId[conversationId];
    await writeDesktopLocalChatStore(projectId, store);
}

export async function getDesktopLocalConversationMessages(
    projectId: string,
    conversationId: string,
): Promise<ChatMessage[]> {
    const store = await readDesktopLocalChatStore(projectId);
    return store.messagesByConversationId[conversationId] ?? [];
}

export async function replaceDesktopLocalConversationMessages(
    projectId: string,
    conversationId: string,
    messages: ChatMessage[],
) {
    const store = await readDesktopLocalChatStore(projectId);
    store.messagesByConversationId[conversationId] = messages.map((message) => hydrateMessage(message));

    const conversationIndex = store.conversations.findIndex((conversation) => conversation.id === conversationId);
    if (conversationIndex !== -1) {
        const conversation = store.conversations[conversationIndex];
        if (conversation) {
            store.conversations[conversationIndex] = {
                ...conversation,
                updatedAt: new Date(),
            };
        }
    } else {
        store.conversations.push({
            ...createDesktopLocalConversation(projectId),
            id: conversationId,
            updatedAt: new Date(),
        });
    }

    store.conversations = sortConversations(store.conversations);
    await writeDesktopLocalChatStore(projectId, store);
}

export async function setDesktopLocalConversationCliSession(
    projectId: string,
    conversationId: string,
    cliType: DesktopLocalChatCli | null,
    cliSessionId: string | null,
) {
    await updateDesktopLocalConversation(projectId, conversationId, {
        cliType,
        cliSessionId,
        updatedAt: new Date(),
    });
}

async function detectDesktopLocalChatCli(projectId: string): Promise<DesktopLocalChatCli | null> {
    const { bridge, sessionId } = ensureDesktopLocalProject(projectId);
    const { output } = await bridge.runCommand({
        sessionId,
        command:
            "if command -v claude >/dev/null 2>&1; then printf 'claude'; else printf ''; fi",
    });

    return output.trim() === 'claude' ? 'claude' : null;
}

export async function resolveDesktopLocalChatCli(projectId: string): Promise<DesktopLocalChatCli | null> {
    const existing = cliDetectionByProject.get(projectId);
    if (existing) {
        return existing;
    }

    const pending = detectDesktopLocalChatCli(projectId).catch((error) => {
        cliDetectionByProject.delete(projectId);
        throw error;
    });
    cliDetectionByProject.set(projectId, pending);
    return pending;
}
