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

export type DesktopLocalChatCli = 'claude' | 'codex';
export type DesktopLocalChatModelSelection = {
    cli: DesktopLocalChatCli;
    model: string;
};

export interface DesktopLocalChatModelOption {
    value: string;
    label: string;
}

interface DesktopLocalChatPreferences {
    selectedCli: DesktopLocalChatCli | null;
    selectedModels: Partial<Record<DesktopLocalChatCli, string>>;
}

export interface DesktopLocalStoredConversation extends ChatConversation {
    cliSessionId: string | null;
    cliType: DesktopLocalChatCli | null;
    cliModel: string | null;
}

interface DesktopLocalChatStore {
    version: 1;
    preferences: DesktopLocalChatPreferences;
    conversations: DesktopLocalStoredConversation[];
    messagesByConversationId: Record<string, ChatMessage[]>;
}

type ChatMessageMetadata = NonNullable<ChatMessage['metadata']>;

const DESKTOP_LOCAL_CHAT_CLI_ORDER = ['claude', 'codex'] as const satisfies readonly DesktopLocalChatCli[];

export const DESKTOP_LOCAL_CHAT_PROVIDER_LABELS: Record<DesktopLocalChatCli, string> = {
    claude: 'Claude',
    codex: 'Codex',
};

export const DESKTOP_LOCAL_CHAT_MODEL_OPTIONS: Record<
    DesktopLocalChatCli,
    readonly DesktopLocalChatModelOption[]
> = {
    claude: [
        { value: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
        { value: 'claude-opus-4-6', label: 'Opus 4.6' },
        { value: 'claude-haiku-4-5', label: 'Haiku 4.5' },
    ],
    codex: [
        { value: 'gpt-5.4', label: 'GPT-5.4' },
        { value: 'gpt-5.4-mini', label: 'GPT-5.4 Mini' },
        { value: 'gpt-5.3-codex', label: 'GPT-5.3 Codex' },
        { value: 'gpt-5.3-codex-spark', label: 'GPT-5.3 Codex Spark' },
    ],
};

const cliDetectionByProject = new Map<string, Promise<DesktopLocalChatCli[]>>();

function createDefaultPreferences(): DesktopLocalChatPreferences {
    return {
        selectedCli: null,
        selectedModels: {},
    };
}

function createEmptyChatStore(): DesktopLocalChatStore {
    return {
        version: 1,
        preferences: createDefaultPreferences(),
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
        cliType: isDesktopLocalChatCli(candidate.cliType) ? candidate.cliType : null,
        cliModel: typeof candidate.cliModel === 'string' ? candidate.cliModel : null,
    };
}

function isDesktopLocalChatCli(value: unknown): value is DesktopLocalChatCli {
    return value === 'claude' || value === 'codex';
}

function isValidDesktopLocalChatModel(cli: DesktopLocalChatCli, model: unknown): model is string {
    return typeof model === 'string'
        && DESKTOP_LOCAL_CHAT_MODEL_OPTIONS[cli].some((option) => option.value === model);
}

function hydratePreferences(preferences: unknown): DesktopLocalChatPreferences {
    if (!preferences || typeof preferences !== 'object') {
        return createDefaultPreferences();
    }

    const candidate = preferences as Record<string, unknown>;
    const selectedModels =
        candidate.selectedModels && typeof candidate.selectedModels === 'object'
            ? (candidate.selectedModels as Record<string, unknown>)
            : {};

    return {
        selectedCli: isDesktopLocalChatCli(candidate.selectedCli) ? candidate.selectedCli : null,
        selectedModels: {
            claude: isValidDesktopLocalChatModel('claude', selectedModels.claude)
                ? selectedModels.claude
                : undefined,
            codex: isValidDesktopLocalChatModel('codex', selectedModels.codex)
                ? selectedModels.codex
                : undefined,
        },
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
        preferences: hydratePreferences(candidate.preferences),
        conversations,
        messagesByConversationId,
    };
}

export function getDefaultDesktopLocalChatModel(cli: DesktopLocalChatCli): string {
    return DESKTOP_LOCAL_CHAT_MODEL_OPTIONS[cli][0]?.value ?? '';
}

export function getDesktopLocalChatModelOptions(
    cli: DesktopLocalChatCli,
): readonly DesktopLocalChatModelOption[] {
    return DESKTOP_LOCAL_CHAT_MODEL_OPTIONS[cli];
}

export function getDesktopLocalChatModelLabel(cli: DesktopLocalChatCli, model: string): string {
    return DESKTOP_LOCAL_CHAT_MODEL_OPTIONS[cli].find((option) => option.value === model)?.label
        ?? model;
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
        cliModel: null,
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
    cliModel: string | null,
) {
    await updateDesktopLocalConversation(projectId, conversationId, {
        cliType,
        cliSessionId,
        cliModel,
        updatedAt: new Date(),
    });
}

async function detectDesktopLocalChatCli(projectId: string): Promise<DesktopLocalChatCli[]> {
    const { bridge, sessionId } = ensureDesktopLocalProject(projectId);
    const { output } = await bridge.runCommand({
        sessionId,
        command:
            "if command -v claude >/dev/null 2>&1; then printf 'claude\n'; fi; if command -v codex >/dev/null 2>&1; then printf 'codex\n'; fi",
    });

    return output
        .split('\n')
        .map((entry) => entry.trim())
        .filter((entry): entry is DesktopLocalChatCli => isDesktopLocalChatCli(entry))
        .sort(
            (left, right) =>
                DESKTOP_LOCAL_CHAT_CLI_ORDER.indexOf(left) - DESKTOP_LOCAL_CHAT_CLI_ORDER.indexOf(right),
        );
}

export async function listAvailableDesktopLocalChatClis(
    projectId: string,
): Promise<DesktopLocalChatCli[]> {
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

export async function getDesktopLocalChatSelection(
    projectId: string,
): Promise<DesktopLocalChatModelSelection | null> {
    const [store, availableClis] = await Promise.all([
        readDesktopLocalChatStore(projectId),
        listAvailableDesktopLocalChatClis(projectId),
    ]);

    if (availableClis.length === 0) {
        return null;
    }

    const fallbackCli = availableClis[0];
    if (!fallbackCli) {
        return null;
    }

    const preferredCli = store.preferences.selectedCli;
    const cli = preferredCli && availableClis.includes(preferredCli)
        ? preferredCli
        : fallbackCli;
    const storedModel = store.preferences.selectedModels[cli];
    const model = isValidDesktopLocalChatModel(cli, storedModel)
        ? storedModel
        : getDefaultDesktopLocalChatModel(cli);

    return {
        cli,
        model,
    };
}

export async function setDesktopLocalChatSelection(
    projectId: string,
    selection: DesktopLocalChatModelSelection,
): Promise<DesktopLocalChatModelSelection> {
    const store = await readDesktopLocalChatStore(projectId);
    const nextCli = selection.cli;
    const nextModel = isValidDesktopLocalChatModel(nextCli, selection.model)
        ? selection.model
        : getDefaultDesktopLocalChatModel(nextCli);

    store.preferences = {
        selectedCli: nextCli,
        selectedModels: {
            ...store.preferences.selectedModels,
            [nextCli]: nextModel,
        },
    };

    await writeDesktopLocalChatStore(projectId, store);

    return {
        cli: nextCli,
        model: nextModel,
    };
}
