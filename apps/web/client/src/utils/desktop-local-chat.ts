'use client';

import { ONLOOK_CACHE_DIRECTORY } from '@onlook/constants';
import {
    AgentType,
    type ChatConversation,
    type ChatMessage,
} from '@onlook/models';
import { v4 as uuidv4 } from 'uuid';

import { isDesktopLocalProjectId, parseDesktopLocalProjectId } from './desktop-local';

const LEGACY_DESKTOP_LOCAL_CHAT_STORE_PATH = `${ONLOOK_CACHE_DIRECTORY}/desktop-chat.json`;

export type DesktopLocalChatCli = 'claude' | 'codex' | 'gemini';
export type DesktopLocalChatCodexReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh';
export type DesktopLocalChatSessionStatus =
    | 'idle'
    | 'submitted'
    | 'running'
    | 'completed'
    | 'stopped'
    | 'error'
    | 'interrupted';
export type DesktopLocalChatRuntimeMode = 'full-access';
export type DesktopLocalChatModelSelection = {
    cli: DesktopLocalChatCli;
    model: string;
    reasoningEffort: DesktopLocalChatCodexReasoningEffort | null;
};
export type DesktopLocalChatModelSelectionInput = {
    cli: DesktopLocalChatCli;
    model: string;
    reasoningEffort?: DesktopLocalChatCodexReasoningEffort | null;
};

export interface DesktopLocalChatModelOption {
    value: string;
    label: string;
}

export interface DesktopLocalChatCodexReasoningEffortOption {
    value: DesktopLocalChatCodexReasoningEffort;
    label: string;
}

interface DesktopLocalChatPreferences {
    selectedCli: DesktopLocalChatCli | null;
    selectedModels: Partial<Record<DesktopLocalChatCli, string>>;
    codexReasoningEffort: DesktopLocalChatCodexReasoningEffort | null;
}

export interface DesktopLocalConversationSessionState {
    status: DesktopLocalChatSessionStatus;
    runtimeMode: DesktopLocalChatRuntimeMode;
    providerName: DesktopLocalChatCli | null;
    model: string | null;
    reasoningEffort: DesktopLocalChatCodexReasoningEffort | null;
    sessionId: string | null;
    activeTurnId: string | null;
    lastError: string | null;
    startedAt: Date | null;
    completedAt: Date | null;
    updatedAt: Date;
}

export interface DesktopLocalStoredConversation extends ChatConversation {
    draftSelection: DesktopLocalChatModelSelection | null;
    session: DesktopLocalConversationSessionState;
}

export interface DesktopLocalChatPickerState {
    availableClis: DesktopLocalChatCli[];
    selection: DesktopLocalChatModelSelection | null;
    lockedProvider: DesktopLocalChatCli | null;
    session: DesktopLocalConversationSessionState;
}

interface DesktopLocalChatStore {
    version: 1;
    preferences: DesktopLocalChatPreferences;
    conversations: DesktopLocalStoredConversation[];
    messagesByConversationId: Record<string, ChatMessage[]>;
}

type ChatMessageMetadata = NonNullable<ChatMessage['metadata']>;

const DESKTOP_LOCAL_CHAT_CLI_ORDER = ['claude', 'codex', 'gemini'] as const satisfies readonly DesktopLocalChatCli[];

export const DESKTOP_LOCAL_CHAT_PROVIDER_LABELS: Record<DesktopLocalChatCli, string> = {
    claude: 'Claude',
    codex: 'Codex',
    gemini: 'Gemini',
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
    gemini: [
        { value: 'auto-gemini-3', label: 'Auto Gemini 3' },
        { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
        { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
    ],
};

const DESKTOP_LOCAL_CHAT_CODEX_REASONING_EFFORT_OPTIONS: readonly DesktopLocalChatCodexReasoningEffortOption[] = [
    { value: 'low', label: 'Low' },
    { value: 'medium', label: 'Medium' },
    { value: 'high', label: 'High' },
    { value: 'xhigh', label: 'Extra High' },
] as const;

const cliDetectionByProject = new Map<string, Promise<DesktopLocalChatCli[]>>();

function createDefaultPreferences(): DesktopLocalChatPreferences {
    return {
        selectedCli: null,
        selectedModels: {},
        codexReasoningEffort: null,
    };
}

function createEmptyConversationSession(
    updatedAt = new Date(),
): DesktopLocalConversationSessionState {
    return {
        status: 'idle',
        runtimeMode: 'full-access',
        providerName: null,
        model: null,
        reasoningEffort: null,
        sessionId: null,
        activeTurnId: null,
        lastError: null,
        startedAt: null,
        completedAt: null,
        updatedAt,
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

    const desktopProjectId = parseDesktopLocalProjectId(projectId);
    if (!desktopProjectId) {
        throw new Error(`Desktop-local project id is invalid: ${projectId}`);
    }

    const desktopBridge = window.onlookDesktop;
    const bridge = desktopBridge?.provider;
    if (!desktopBridge || !bridge) {
        throw new Error('Desktop provider bridge is not available in this renderer');
    }

    return {
        desktopProjectId,
        desktopBridge,
        bridge,
    };
}

async function resolveDesktopLocalProjectSession(projectId: string) {
    const { desktopProjectId, desktopBridge, bridge } = ensureDesktopLocalProject(projectId);
    const project = await desktopBridge.getProject(desktopProjectId);
    if (project?.sessionId) {
        return {
            bridge,
            sessionId: project.sessionId,
        };
    }

    const legacySession = await desktopBridge.getProjectSession(desktopProjectId);
    if (legacySession?.id) {
        return {
            bridge,
            sessionId: legacySession.id,
        };
    }

    throw new Error(`Desktop project session is not available for ${desktopProjectId}`);
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
                turnId: typeof metadata.turnId === 'string' ? metadata.turnId : undefined,
                streaming: typeof metadata.streaming === 'boolean' ? metadata.streaming : undefined,
                completedAt:
                    metadata.completedAt !== undefined && metadata.completedAt !== null
                        ? toDate(metadata.completedAt)
                        : undefined,
                error: typeof metadata.error === 'string' ? metadata.error : undefined,
            }
            : undefined,
    };
}

function isDesktopLocalChatCli(value: unknown): value is DesktopLocalChatCli {
    return value === 'claude' || value === 'codex' || value === 'gemini';
}

function isDesktopLocalChatSessionStatus(value: unknown): value is DesktopLocalChatSessionStatus {
    return value === 'idle'
        || value === 'submitted'
        || value === 'running'
        || value === 'completed'
        || value === 'stopped'
        || value === 'error'
        || value === 'interrupted';
}

function isValidDesktopLocalChatModel(cli: DesktopLocalChatCli, model: unknown): model is string {
    return typeof model === 'string'
        && DESKTOP_LOCAL_CHAT_MODEL_OPTIONS[cli].some((option) => option.value === model);
}

function isDesktopLocalChatCodexReasoningEffort(
    value: unknown,
): value is DesktopLocalChatCodexReasoningEffort {
    return value === 'low'
        || value === 'medium'
        || value === 'high'
        || value === 'xhigh';
}

function normalizeDesktopLocalChatCodexReasoningEffort(
    value: unknown,
): DesktopLocalChatCodexReasoningEffort | null {
    return isDesktopLocalChatCodexReasoningEffort(value) ? value : null;
}

function normalizeDesktopLocalChatSelection(
    cli: DesktopLocalChatCli,
    model: unknown,
    reasoningEffort?: unknown,
): DesktopLocalChatModelSelection {
    return {
        cli,
        model: isValidDesktopLocalChatModel(cli, model)
            ? model
            : getDefaultDesktopLocalChatModel(cli),
        reasoningEffort:
            cli === 'codex'
                ? normalizeDesktopLocalChatCodexReasoningEffort(reasoningEffort)
                : null,
    };
}

function maybeCreateDesktopLocalChatSelection(
    cli: DesktopLocalChatCli | null,
    model: unknown,
    reasoningEffort?: unknown,
): DesktopLocalChatModelSelection | null {
    if (!cli) {
        return null;
    }

    return normalizeDesktopLocalChatSelection(cli, model, reasoningEffort);
}

function hydrateConversationSession(
    session: unknown,
    fallback: {
        legacyCliType: DesktopLocalChatCli | null;
        legacyCliModel: string | null;
        legacyCliSessionId: string | null;
        fallbackUpdatedAt: Date;
    },
): DesktopLocalConversationSessionState {
    const candidate =
        session && typeof session === 'object'
            ? (session as Record<string, unknown>)
            : {};
    const providerName = isDesktopLocalChatCli(candidate.providerName)
        ? candidate.providerName
        : fallback.legacyCliType;
    const model =
        typeof candidate.model === 'string'
            ? candidate.model
            : fallback.legacyCliModel;
    const reasoningEffort = normalizeDesktopLocalChatCodexReasoningEffort(
        candidate.reasoningEffort,
    );
    const sessionId =
        typeof candidate.sessionId === 'string'
            ? candidate.sessionId
            : fallback.legacyCliSessionId;

    return {
        status: isDesktopLocalChatSessionStatus(candidate.status)
            ? candidate.status
            : providerName || sessionId
                ? 'completed'
                : 'idle',
        runtimeMode: candidate.runtimeMode === 'full-access' ? 'full-access' : 'full-access',
        providerName,
        model: typeof model === 'string' ? model : null,
        reasoningEffort: providerName === 'codex' ? reasoningEffort : null,
        sessionId: typeof sessionId === 'string' ? sessionId : null,
        activeTurnId: typeof candidate.activeTurnId === 'string' ? candidate.activeTurnId : null,
        lastError: typeof candidate.lastError === 'string' ? candidate.lastError : null,
        startedAt:
            candidate.startedAt !== undefined && candidate.startedAt !== null
                ? toDate(candidate.startedAt)
                : null,
        completedAt:
            candidate.completedAt !== undefined && candidate.completedAt !== null
                ? toDate(candidate.completedAt)
                : null,
        updatedAt:
            candidate.updatedAt !== undefined && candidate.updatedAt !== null
                ? toDate(candidate.updatedAt)
                : fallback.fallbackUpdatedAt,
    };
}

function hydrateConversation(conversation: unknown): DesktopLocalStoredConversation {
    const candidate = (conversation ?? {}) as Record<string, unknown>;
    const updatedAt = toDate(candidate.updatedAt);
    const legacyCliType = isDesktopLocalChatCli(candidate.cliType) ? candidate.cliType : null;
    const legacyCliModel = typeof candidate.cliModel === 'string' ? candidate.cliModel : null;
    const legacyCliSessionId = typeof candidate.cliSessionId === 'string'
        ? candidate.cliSessionId
        : null;
    const session = hydrateConversationSession(candidate.session, {
        legacyCliType,
        legacyCliModel,
        legacyCliSessionId,
        fallbackUpdatedAt: updatedAt,
    });

    return {
        id: typeof candidate.id === 'string' ? candidate.id : uuidv4(),
        agentType:
            candidate.agentType === AgentType.ROOT || candidate.agentType === AgentType.USER
                ? candidate.agentType
                : AgentType.ROOT,
        title: typeof candidate.title === 'string' ? candidate.title : null,
        projectId: typeof candidate.projectId === 'string' ? candidate.projectId : '',
        createdAt: toDate(candidate.createdAt),
        updatedAt,
        suggestions: Array.isArray(candidate.suggestions)
            ? (candidate.suggestions as ChatConversation['suggestions'])
            : [],
        draftSelection:
            maybeCreateDesktopLocalChatSelection(
                candidate.draftSelection && typeof candidate.draftSelection === 'object'
                    ? isDesktopLocalChatCli(
                        (candidate.draftSelection as Record<string, unknown>).cli,
                    )
                        ? (candidate.draftSelection as Record<string, unknown>).cli as DesktopLocalChatCli
                        : null
                    : null,
                candidate.draftSelection && typeof candidate.draftSelection === 'object'
                    ? (candidate.draftSelection as Record<string, unknown>).model
                    : null,
                candidate.draftSelection && typeof candidate.draftSelection === 'object'
                    ? (candidate.draftSelection as Record<string, unknown>).reasoningEffort
                    : null,
            )
            ?? maybeCreateDesktopLocalChatSelection(
                session.providerName,
                session.model,
                session.reasoningEffort,
            )
            ?? maybeCreateDesktopLocalChatSelection(legacyCliType, legacyCliModel),
        session,
    };
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
            gemini: isValidDesktopLocalChatModel('gemini', selectedModels.gemini)
                ? selectedModels.gemini
                : undefined,
        },
        codexReasoningEffort: normalizeDesktopLocalChatCodexReasoningEffort(
            candidate.codexReasoningEffort,
        ),
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

export function getDesktopLocalChatCodexReasoningEffortOptions():
readonly DesktopLocalChatCodexReasoningEffortOption[] {
    return DESKTOP_LOCAL_CHAT_CODEX_REASONING_EFFORT_OPTIONS;
}

export function getDesktopLocalChatCodexReasoningEffortLabel(
    reasoningEffort: DesktopLocalChatCodexReasoningEffort | null,
): string {
    if (!reasoningEffort) {
        return 'Default';
    }

    return DESKTOP_LOCAL_CHAT_CODEX_REASONING_EFFORT_OPTIONS.find(
        (option) => option.value === reasoningEffort,
    )?.label ?? reasoningEffort;
}

function isMissingFileError(error: unknown) {
    return error instanceof Error && /ENOENT|not found/i.test(error.message);
}

function isDesktopLocalChatSessionLocked(session: DesktopLocalConversationSessionState | null) {
    return session?.status === 'submitted' || session?.status === 'running';
}

const DESKTOP_LOCAL_CHAT_SUBMITTED_STALE_MS = 30_000;
const DESKTOP_LOCAL_CHAT_RUNNING_WITHOUT_SESSION_STALE_MS = 60_000;
const DESKTOP_LOCAL_CHAT_LOCKED_WITHOUT_RESPONSE_STALE_MS = 90_000;
const DESKTOP_LOCAL_CHAT_LOCKED_HARD_STALE_MS = 10 * 60_000;

function hasAssistantMessageForTurn(
    messages: ChatMessage[],
    activeTurnId: string | null,
) {
    return messages.some((message) => {
        if (message.role !== 'assistant') {
            return false;
        }

        if (!activeTurnId) {
            return true;
        }

        return message.metadata?.turnId === activeTurnId;
    });
}

function recoverDesktopLocalConversationSession(
    session: DesktopLocalConversationSessionState,
    messages: ChatMessage[],
    now = new Date(),
): {
    session: DesktopLocalConversationSessionState;
    recovered: boolean;
} {
    const ageMs = now.getTime() - session.updatedAt.getTime();
    const hasAssistantResponse = hasAssistantMessageForTurn(messages, session.activeTurnId);
    const staleSubmitted =
        session.status === 'submitted'
        && !session.sessionId
        && ageMs > DESKTOP_LOCAL_CHAT_SUBMITTED_STALE_MS;
    const staleRunningWithoutSession =
        session.status === 'running'
        && !session.sessionId
        && ageMs > DESKTOP_LOCAL_CHAT_RUNNING_WITHOUT_SESSION_STALE_MS;
    const staleLockedWithoutResponse =
        (session.status === 'submitted' || session.status === 'running')
        && !hasAssistantResponse
        && ageMs > DESKTOP_LOCAL_CHAT_LOCKED_WITHOUT_RESPONSE_STALE_MS;
    const staleLockedSession =
        (session.status === 'submitted' || session.status === 'running')
        && ageMs > DESKTOP_LOCAL_CHAT_LOCKED_HARD_STALE_MS;

    if (
        !staleSubmitted
        && !staleRunningWithoutSession
        && !staleLockedWithoutResponse
        && !staleLockedSession
    ) {
        return {
            session,
            recovered: false,
        };
    }

    return {
        recovered: true,
        session: {
            ...session,
            status: 'error',
            lastError:
                session.lastError
                ?? 'The previous desktop-local chat turn did not finish starting.',
            completedAt: session.completedAt ?? now,
            updatedAt: now,
        },
    };
}

function recoverDesktopLocalChatStore(store: DesktopLocalChatStore): {
    store: DesktopLocalChatStore;
    recovered: boolean;
} {
    const now = new Date();
    let recovered = false;
    const conversations = store.conversations.map((conversation) => {
        const recovery = recoverDesktopLocalConversationSession(
            conversation.session,
            store.messagesByConversationId[conversation.id] ?? [],
            now,
        );
        if (!recovery.recovered) {
            return conversation;
        }

        recovered = true;
        return {
            ...conversation,
            session: recovery.session,
            updatedAt: recovery.session.updatedAt,
        };
    });

    if (!recovered) {
        return {
            store,
            recovered: false,
        };
    }

    return {
        recovered: true,
        store: {
            ...store,
            conversations: sortConversations(conversations),
        },
    };
}

function findRootJsonDocumentEnd(content: string): number | null {
    let depth = 0;
    let inString = false;
    let isEscaped = false;
    let started = false;

    for (let index = 0; index < content.length; index++) {
        const char = content[index];
        if (!char) {
            continue;
        }

        if (!started) {
            if (/\s/.test(char)) {
                continue;
            }

            if (char !== '{' && char !== '[') {
                return null;
            }

            started = true;
            depth = 1;
            continue;
        }

        if (inString) {
            if (isEscaped) {
                isEscaped = false;
                continue;
            }

            if (char === '\\') {
                isEscaped = true;
                continue;
            }

            if (char === '"') {
                inString = false;
            }
            continue;
        }

        if (char === '"') {
            inString = true;
            continue;
        }

        if (char === '{' || char === '[') {
            depth += 1;
            continue;
        }

        if (char === '}' || char === ']') {
            depth -= 1;
            if (depth === 0) {
                return index + 1;
            }
        }
    }

    return null;
}

function parseDesktopLocalChatStoreContent(content: string) {
    const trimmedContent = content.trim();
    if (!trimmedContent) {
        return {
            store: createEmptyChatStore(),
            repairedContent: null as string | null,
        };
    }

    try {
        return {
            store: hydrateStore(JSON.parse(trimmedContent)),
            repairedContent: null as string | null,
        };
    } catch (error) {
        const documentEnd = findRootJsonDocumentEnd(trimmedContent);
        if (!documentEnd || documentEnd >= trimmedContent.length) {
            throw error;
        }

        const recoveredContent = trimmedContent.slice(0, documentEnd);
        const recoveredStore = hydrateStore(JSON.parse(recoveredContent));
        return {
            store: recoveredStore,
            repairedContent: JSON.stringify(recoveredStore, null, 2),
        };
    }
}

async function readLegacyDesktopLocalChatStore(
    projectId: string,
): Promise<DesktopLocalChatStore | null> {
    let bridge: Awaited<ReturnType<typeof resolveDesktopLocalProjectSession>>['bridge'];
    let sessionId: string;

    try {
        ({ bridge, sessionId } = await resolveDesktopLocalProjectSession(projectId));
    } catch {
        return null;
    }

    try {
        const directoryListing = await bridge.listFiles({
            sessionId,
            path: ONLOOK_CACHE_DIRECTORY,
        });
        const hasStoreFile = directoryListing.files.some(
            (entry) => entry.type === 'file' && entry.name === 'desktop-chat.json',
        );
        if (!hasStoreFile) {
            return null;
        }

        const result = await bridge.readFile({
            sessionId,
            path: LEGACY_DESKTOP_LOCAL_CHAT_STORE_PATH,
        });
        const content = result.file.content;
        if (typeof content !== 'string' || content.trim().length === 0) {
            return null;
        }

        const { store: parsedStore } = parseDesktopLocalChatStoreContent(content);
        const { store } = recoverDesktopLocalChatStore(parsedStore);
        return store;
    } catch (error) {
        if (isMissingFileError(error)) {
            return null;
        }
        throw error;
    }
}

async function readDesktopLocalChatStore(projectId: string): Promise<DesktopLocalChatStore> {
    const { desktopBridge, desktopProjectId } = ensureDesktopLocalProject(projectId);
    const persistedContent = await desktopBridge.readChatStore(desktopProjectId);
    if (typeof persistedContent === 'string' && persistedContent.trim().length > 0) {
        const { store: parsedStore, repairedContent } = parseDesktopLocalChatStoreContent(
            persistedContent,
        );
        const { store, recovered } = recoverDesktopLocalChatStore(parsedStore);
        if (repairedContent || recovered) {
            await desktopBridge.writeChatStore(
                desktopProjectId,
                repairedContent ?? JSON.stringify(store, null, 2),
            );
        }
        return store;
    }

    const legacyStore = await readLegacyDesktopLocalChatStore(projectId);
    if (!legacyStore) {
        return createEmptyChatStore();
    }

    await desktopBridge.writeChatStore(
        desktopProjectId,
        JSON.stringify(legacyStore, null, 2),
    );
    return legacyStore;
}

async function writeDesktopLocalChatStore(projectId: string, store: DesktopLocalChatStore) {
    const { desktopBridge, desktopProjectId } = ensureDesktopLocalProject(projectId);
    await desktopBridge.writeChatStore(
        desktopProjectId,
        JSON.stringify(store, null, 2),
    );
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
        draftSelection: null,
        session: createEmptyConversationSession(now),
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

export async function getDesktopLocalConversationSession(
    projectId: string,
    conversationId: string,
): Promise<DesktopLocalConversationSessionState> {
    const conversation = await getDesktopLocalConversation(projectId, conversationId);
    return conversation?.session ?? createEmptyConversationSession();
}

export async function updateDesktopLocalConversationSession(
    projectId: string,
    conversationId: string,
    updates: Partial<DesktopLocalConversationSessionState>,
): Promise<DesktopLocalStoredConversation | null> {
    const currentConversation = await getDesktopLocalConversation(projectId, conversationId);
    const baseConversation = currentConversation ?? createDesktopLocalConversation(projectId);
    const nextUpdatedAt = updates.updatedAt ?? new Date();
    const nextSession = hydrateConversationSession(
        {
            ...baseConversation.session,
            ...updates,
            updatedAt: nextUpdatedAt,
        },
        {
            legacyCliType: baseConversation.session.providerName,
            legacyCliModel: baseConversation.session.model,
            legacyCliSessionId: baseConversation.session.sessionId,
            fallbackUpdatedAt: nextUpdatedAt,
        },
    );

    return updateDesktopLocalConversation(projectId, conversationId, {
        ...(!currentConversation ? { id: conversationId } : {}),
        session: nextSession,
        updatedAt: nextUpdatedAt,
    });
}

export async function setDesktopLocalConversationCliSession(
    projectId: string,
    conversationId: string,
    cliType: DesktopLocalChatCli | null,
    cliSessionId: string | null,
    cliModel: string | null,
) {
    await updateDesktopLocalConversationSession(projectId, conversationId, {
        status: cliType ? 'running' : 'idle',
        providerName: cliType,
        model: cliModel,
        reasoningEffort: null,
        sessionId: cliSessionId,
        updatedAt: new Date(),
    });
}

async function detectDesktopLocalChatCli(projectId: string): Promise<DesktopLocalChatCli[]> {
    const { bridge, sessionId } = await resolveDesktopLocalProjectSession(projectId);
    const { output } = await bridge.runCommand({
        sessionId,
        command:
            "if command -v claude >/dev/null 2>&1; then printf 'claude\n'; fi; if command -v codex >/dev/null 2>&1; then printf 'codex\n'; fi; if command -v gemini >/dev/null 2>&1; then printf 'gemini\n'; fi",
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
    options?: {
        conversationId?: string;
    },
): Promise<DesktopLocalChatModelSelection | null> {
    const pickerState = options?.conversationId
        ? await getDesktopLocalChatPickerState(projectId, options.conversationId)
        : null;

    if (pickerState) {
        return pickerState.selection;
    }

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

    return normalizeDesktopLocalChatSelection(
        cli,
        model,
        cli === 'codex' ? store.preferences.codexReasoningEffort : null,
    );
}

export async function setDesktopLocalChatSelection(
    projectId: string,
    selection: DesktopLocalChatModelSelectionInput,
    options?: {
        conversationId?: string;
    },
): Promise<DesktopLocalChatModelSelection> {
    const store = await readDesktopLocalChatStore(projectId);
    const nextCli = selection.cli;
    const nextModel = isValidDesktopLocalChatModel(nextCli, selection.model)
        ? selection.model
        : getDefaultDesktopLocalChatModel(nextCli);
    const existingConversation = options?.conversationId
        ? store.conversations.find(
            (conversation) => conversation.id === options.conversationId,
        ) ?? null
        : null;
    const preferredCodexReasoningEffort =
        existingConversation?.draftSelection?.cli === 'codex'
            ? existingConversation.draftSelection.reasoningEffort
            : existingConversation?.session.providerName === 'codex'
                ? existingConversation.session.reasoningEffort
                : store.preferences.codexReasoningEffort;
    const nextReasoningEffort = nextCli === 'codex'
        ? selection.reasoningEffort === undefined
            ? preferredCodexReasoningEffort
            : normalizeDesktopLocalChatCodexReasoningEffort(selection.reasoningEffort)
        : null;
    let resolvedSelection: DesktopLocalChatModelSelection = {
        cli: nextCli,
        model: nextModel,
        reasoningEffort: nextReasoningEffort,
    };

    store.preferences = {
        selectedCli: nextCli,
        selectedModels: {
            ...store.preferences.selectedModels,
            [nextCli]: nextModel,
        },
        codexReasoningEffort:
            nextCli === 'codex'
                ? nextReasoningEffort
                : store.preferences.codexReasoningEffort,
    };

    if (options?.conversationId) {
        const lockedProvider = isDesktopLocalChatSessionLocked(existingConversation?.session ?? null)
            ? existingConversation?.session.providerName ?? null
            : null;
        const effectiveCli = lockedProvider ?? nextCli;
        const effectiveReasoningEffort = effectiveCli === 'codex'
            ? selection.reasoningEffort === undefined
                ? existingConversation?.draftSelection?.cli === 'codex'
                    ? existingConversation.draftSelection.reasoningEffort
                    : existingConversation?.session.reasoningEffort
                        ?? nextReasoningEffort
                : normalizeDesktopLocalChatCodexReasoningEffort(selection.reasoningEffort)
            : null;
        const effectiveSelection = lockedProvider
            ? normalizeDesktopLocalChatSelection(
                effectiveCli,
                lockedProvider === nextCli
                    ? nextModel
                    : existingConversation?.draftSelection?.cli === effectiveCli
                        ? existingConversation.draftSelection.model
                        : existingConversation?.session.model,
                effectiveReasoningEffort,
            )
            : normalizeDesktopLocalChatSelection(
                effectiveCli,
                nextModel,
                effectiveReasoningEffort,
            );
        resolvedSelection = effectiveSelection;
        const nextConversation = hydrateConversation({
            ...(existingConversation ?? createDesktopLocalConversation(projectId)),
            id: options.conversationId,
            projectId,
            draftSelection: effectiveSelection,
            updatedAt: new Date(),
        });
        const existingIndex = store.conversations.findIndex(
            (conversation) => conversation.id === options.conversationId,
        );
        if (existingIndex === -1) {
            store.conversations.push(nextConversation);
        } else {
            store.conversations[existingIndex] = nextConversation;
        }
        store.conversations = sortConversations(store.conversations);
    }

    await writeDesktopLocalChatStore(projectId, store);

    return resolvedSelection;
}

function resolveDesktopLocalChatSelectionFromConversation(
    store: DesktopLocalChatStore,
    conversation: DesktopLocalStoredConversation | null,
    availableClis: DesktopLocalChatCli[],
): DesktopLocalChatModelSelection | null {
    if (
        conversation?.session.providerName
        && isDesktopLocalChatSessionLocked(conversation.session)
    ) {
        const preferredModel =
            conversation.draftSelection?.cli === conversation.session.providerName
                ? conversation.draftSelection.model
                : conversation.session.model;
        return normalizeDesktopLocalChatSelection(
            conversation.session.providerName,
            preferredModel
                ?? store.preferences.selectedModels[conversation.session.providerName]
                ?? conversation.session.model,
            conversation.draftSelection?.cli === conversation.session.providerName
                ? conversation.draftSelection.reasoningEffort
                : conversation.session.reasoningEffort
                    ?? store.preferences.codexReasoningEffort,
        );
    }

    if (
        conversation?.session.providerName
        && conversation?.draftSelection
        && availableClis.includes(conversation.draftSelection.cli)
    ) {
        return normalizeDesktopLocalChatSelection(
            conversation.draftSelection.cli,
            conversation.draftSelection.model,
            conversation.draftSelection.reasoningEffort,
        );
    }

    if (
        conversation?.session.providerName
        && availableClis.includes(conversation.session.providerName)
    ) {
        return normalizeDesktopLocalChatSelection(
            conversation.session.providerName,
            conversation.draftSelection?.cli === conversation.session.providerName
                ? conversation.draftSelection.model
                : conversation.session.model
                    ?? store.preferences.selectedModels[conversation.session.providerName],
            conversation.draftSelection?.cli === conversation.session.providerName
                ? conversation.draftSelection.reasoningEffort
                : conversation.session.reasoningEffort
                    ?? store.preferences.codexReasoningEffort,
        );
    }

    const fallbackCli = availableClis[0];
    if (!fallbackCli) {
        return null;
    }

    const preferredCli = store.preferences.selectedCli;
    const cli = preferredCli && availableClis.includes(preferredCli)
        ? preferredCli
        : fallbackCli;
    return normalizeDesktopLocalChatSelection(
        cli,
        store.preferences.selectedModels[cli],
        cli === 'codex' ? store.preferences.codexReasoningEffort : null,
    );
}

export async function getDesktopLocalChatPickerState(
    projectId: string,
    conversationId: string,
): Promise<DesktopLocalChatPickerState> {
    const [store, availableClis] = await Promise.all([
        readDesktopLocalChatStore(projectId),
        listAvailableDesktopLocalChatClis(projectId),
    ]);
    const conversation = store.conversations.find(
        (entry) => entry.id === conversationId,
    ) ?? null;
    const session = conversation?.session ?? createEmptyConversationSession();
    const lockedProvider = isDesktopLocalChatSessionLocked(session)
        ? session.providerName
        : null;

    return {
        availableClis,
        selection: resolveDesktopLocalChatSelectionFromConversation(
            store,
            conversation,
            availableClis,
        ),
        lockedProvider,
        session,
    };
}
