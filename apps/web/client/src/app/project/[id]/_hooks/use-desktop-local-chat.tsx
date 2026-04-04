'use client';

import { useEditorEngine } from '@/components/store/editor';
import {
    getDesktopLocalChatPickerState,
    getDesktopLocalChatSelection,
    replaceDesktopLocalConversationMessages,
    setDesktopLocalChatSelection,
    updateDesktopLocalConversationSession,
    type DesktopLocalChatSessionStatus,
    type DesktopLocalChatCli,
} from '@/utils/desktop-local-chat';
import {
    ChatType,
    type ChatMessage,
    type MessageContext,
    type QueuedMessage,
} from '@onlook/models';
import { jsonClone } from '@onlook/utility';
import { usePostHog } from 'posthog-js/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';

import type { EditMessage, SendMessage } from './use-chat';
import { createCheckpointsForAllBranches, getUserChatMessageFromString } from './use-chat/utils';

interface UseDesktopLocalChatProps {
    conversationId: string;
    projectId: string;
    initialMessages: ChatMessage[];
}

type ClaudeEvent =
    | {
        type: 'system';
        subtype?: string;
        session_id?: string;
    }
    | {
        type: 'assistant';
        session_id?: string;
        message?: {
            content?: Array<{ type: string; text?: string }>;
        };
    }
    | {
        type: 'result';
        subtype?: string;
        is_error?: boolean;
        result?: string;
        stop_reason?: string;
        session_id?: string;
    }
    | {
        type: 'stream_event';
        session_id?: string;
        event?: {
            type?: string;
            content_block?: {
                type?: string;
                text?: string;
            };
            delta?: {
                type?: string;
                text?: string;
            };
        };
    };

type CodexEvent = {
    type?: string;
    thread_id?: string;
    item?: {
        type?: string;
        text?: string;
        delta?: string | { text?: string };
    };
    error?: string | { message?: string };
    message?: string;
};

type MessageFinishReason = NonNullable<ChatMessage['metadata']>['finishReason'];

function shellQuote(value: string) {
    return JSON.stringify(value);
}

function getMessageText(parts: ChatMessage['parts']) {
    return parts
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join('');
}

function extractCodexEventText(event: CodexEvent): string | null {
    const item = event.item;
    if (!item || item.type !== 'agent_message') {
        return null;
    }

    if (typeof item.text === 'string') {
        return item.text;
    }

    if (typeof item.delta === 'string') {
        return item.delta;
    }

    if (item.delta && typeof item.delta === 'object' && typeof item.delta.text === 'string') {
        return item.delta.text;
    }

    return null;
}

function getCodexErrorMessage(event: CodexEvent): string | null {
    if (typeof event.message === 'string' && event.message.trim()) {
        return event.message.trim();
    }

    if (typeof event.error === 'string' && event.error.trim()) {
        return event.error.trim();
    }

    if (event.error && typeof event.error === 'object' && typeof event.error.message === 'string') {
        return event.error.message.trim();
    }

    return null;
}

function normalizeFinishReason(reason: string): MessageFinishReason {
    switch (reason) {
        case 'stop':
        case 'end_turn':
            return 'stop';
        case 'length':
            return 'length';
        case 'tool-calls':
            return 'tool-calls';
        case 'content-filter':
            return 'content-filter';
        default:
            return undefined;
    }
}

function getSessionStatusForReason(
    reason: string,
    hasError: boolean,
): DesktopLocalChatSessionStatus {
    if (hasError) {
        return 'error';
    }

    if (reason === 'stop') {
        return 'interrupted';
    }

    return 'completed';
}

function buildDesktopLocalPrompt(input: {
    content: string;
    context: MessageContext[];
    type: ChatType;
}) {
    const sections: string[] = [];

    if (input.type === ChatType.ASK) {
        sections.push('Answer the request about this local project. Do not edit files unless the user explicitly asks for code changes.');
    } else {
        sections.push('Work directly in this local project. Inspect and edit files as needed, then summarize the concrete changes.');
    }

    const fileContexts = input.context.filter((context) => context.type === 'file');
    const highlightContexts = input.context.filter((context) => context.type === 'highlight');
    const errorContexts = input.context.filter((context) => context.type === 'error');
    const branchContexts = input.context.filter((context) => context.type === 'branch');
    const imageContexts = input.context.filter((context) => context.type === 'image');

    if (branchContexts.length > 0) {
        sections.push(
            [
                'Relevant branch context:',
                ...branchContexts.map((context) => `- ${context.displayName}: ${context.content}`),
            ].join('\n'),
        );
    }

    if (errorContexts.length > 0) {
        sections.push(
            [
                'Current project errors:',
                ...errorContexts.map((context) => `- ${context.displayName}\n${context.content}`),
            ].join('\n'),
        );
    }

    if (highlightContexts.length > 0) {
        sections.push(
            [
                'Selected code or elements:',
                ...highlightContexts.map(
                    (context) =>
                        `File: ${context.path} (${context.start}-${context.end})\n${context.content}`,
                ),
            ].join('\n\n'),
        );
    }

    if (fileContexts.length > 0) {
        sections.push(
            [
                'Relevant file context:',
                ...fileContexts.map((context) => `File: ${context.path}\n${context.content}`),
            ].join('\n\n'),
        );
    }

    if (imageContexts.length > 0) {
        sections.push(
            [
                'Referenced images:',
                ...imageContexts.map((context) => {
                    if (context.source === 'local') {
                        return `- ${context.displayName}: ${context.path ?? 'local project asset'}`;
                    }
                    return `- ${context.displayName}: external image provided in chat context`;
                }),
            ].join('\n'),
        );
    }

    sections.push(`User request:\n${input.content}`);
    return sections.join('\n\n');
}

export function useDesktopLocalChat({
    conversationId,
    projectId,
    initialMessages,
}: UseDesktopLocalChatProps) {
    const editorEngine = useEditorEngine();
    const posthog = usePostHog();

    const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
    const [error, setError] = useState<Error | undefined>(undefined);
    const [isStreaming, setIsStreaming] = useState(false);
    const [status, setStatus] = useState<'ready' | 'streaming' | 'submitted'>('ready');
    const [queuedMessages, setQueuedMessages] = useState<QueuedMessage[]>([]);
    const [finishReason, setFinishReason] = useState<string | null>(null);
    const isProcessingQueue = useRef(false);
    const messagesRef = useRef(initialMessages);
    const outputBufferRef = useRef('');
    const rawOutputRef = useRef('');
    const activeCommandRef = useRef<{
        kill: () => Promise<void>;
        unsubscribe: () => void;
    } | null>(null);
    const activeAssistantMessageIdRef = useRef<string | null>(null);
    const activeCliRef = useRef<DesktopLocalChatCli | null>(null);
    const activeModelRef = useRef<string | null>(null);
    const activeTurnIdRef = useRef<string | null>(null);
    const activeTurnStartedAtRef = useRef<Date | null>(null);

    useEffect(() => {
        setMessages(initialMessages);
        messagesRef.current = initialMessages;
    }, [initialMessages]);

    useEffect(() => {
        editorEngine.chat.setIsStreaming(isStreaming);
    }, [editorEngine.chat, isStreaming]);

    const persistMessages = useCallback(
        async (nextMessages: ChatMessage[]) => {
            await replaceDesktopLocalConversationMessages(projectId, conversationId, nextMessages);
        },
        [conversationId, projectId],
    );

    const persistSessionState = useCallback(
        async (
            updates: Parameters<typeof updateDesktopLocalConversationSession>[2],
        ) => {
            await updateDesktopLocalConversationSession(projectId, conversationId, updates);
        },
        [conversationId, projectId],
    );

    const applyMessages = useCallback(
        (updater: (current: ChatMessage[]) => ChatMessage[]) => {
            const nextMessages = jsonClone(updater(messagesRef.current));
            messagesRef.current = nextMessages;
            setMessages(nextMessages);
            return nextMessages;
        },
        [],
    );

    const upsertAssistantMessage = useCallback(
        (
            content: string,
            mode: 'replace' | 'append',
            options?: {
                streaming?: boolean;
                completedAt?: Date;
                finishReason?: MessageFinishReason;
                error?: string;
            },
        ) => {
            applyMessages((currentMessages) => {
                const existingId = activeAssistantMessageIdRef.current;
                let existingIndex = existingId
                    ? currentMessages.findIndex((message) => message.id === existingId)
                    : -1;

                if (existingIndex === -1) {
                    const lastMessage = currentMessages[currentMessages.length - 1];
                    if (lastMessage?.role === 'assistant') {
                        existingIndex = currentMessages.length - 1;
                        activeAssistantMessageIdRef.current = lastMessage.id;
                    }
                }

                if (existingIndex === -1) {
                    const assistantMessageId = uuidv4();
                    activeAssistantMessageIdRef.current = assistantMessageId;
                    return [
                        ...currentMessages,
                        {
                            id: assistantMessageId,
                            role: 'assistant',
                            parts: [{ type: 'text', text: content }],
                            metadata: {
                                context: [],
                                checkpoints: [],
                                createdAt: new Date(),
                                conversationId,
                                turnId: activeTurnIdRef.current ?? undefined,
                                streaming: options?.streaming,
                                completedAt: options?.completedAt,
                                finishReason: options?.finishReason,
                                error: options?.error,
                            },
                        },
                    ];
                }

                const existingMessage = currentMessages[existingIndex];
                if (!existingMessage) {
                    return currentMessages;
                }

                const existingText = getMessageText(existingMessage.parts);
                const nextText = mode === 'append' ? `${existingText}${content}` : content;
                const nextMessage: ChatMessage = {
                    ...existingMessage,
                    parts: [{ type: 'text', text: nextText }],
                    metadata: {
                        ...existingMessage.metadata,
                        createdAt: existingMessage.metadata?.createdAt ?? new Date(),
                        conversationId,
                        checkpoints: existingMessage.metadata?.checkpoints ?? [],
                        context: existingMessage.metadata?.context ?? [],
                        turnId: activeTurnIdRef.current ?? existingMessage.metadata?.turnId,
                        streaming: options?.streaming ?? existingMessage.metadata?.streaming,
                        completedAt: options?.completedAt ?? existingMessage.metadata?.completedAt,
                        finishReason: options?.finishReason ?? existingMessage.metadata?.finishReason,
                        error: options?.error ?? existingMessage.metadata?.error,
                    },
                };

                return currentMessages.map((message, index) =>
                    index === existingIndex ? nextMessage : message,
                );
            });
        },
        [applyMessages, conversationId],
    );

    const finalizeAssistantMessage = useCallback(
        (
            reason: string,
            nextError?: Error,
        ) => {
            applyMessages((currentMessages) => {
                const assistantMessageId = activeAssistantMessageIdRef.current;
                if (!assistantMessageId) {
                    return currentMessages;
                }

                return currentMessages.map((message) => {
                    if (message.id !== assistantMessageId) {
                        return message;
                    }

                    return {
                        ...message,
                        metadata: {
                            ...message.metadata,
                            createdAt: message.metadata?.createdAt ?? new Date(),
                            conversationId,
                            checkpoints: message.metadata?.checkpoints ?? [],
                            context: message.metadata?.context ?? [],
                            turnId: activeTurnIdRef.current ?? message.metadata?.turnId,
                            streaming: false,
                            completedAt: new Date(),
                            finishReason: normalizeFinishReason(reason),
                            error: nextError?.message ?? message.metadata?.error,
                        },
                    };
                });
            });
        },
        [applyMessages, conversationId],
    );

    const clearActiveCommand = useCallback(() => {
        activeCommandRef.current?.unsubscribe();
        activeCommandRef.current = null;
        outputBufferRef.current = '';
        rawOutputRef.current = '';
        activeAssistantMessageIdRef.current = null;
        activeCliRef.current = null;
        activeModelRef.current = null;
    }, []);

    const finalizeCommand = useCallback(
        (reason: string, nextError?: Error) => {
            const completedAt = new Date();
            const nextStatus = getSessionStatusForReason(reason, !!nextError);
            finalizeAssistantMessage(reason, nextError);
            void persistSessionState({
                status: nextStatus,
                providerName: activeCliRef.current,
                model: activeModelRef.current,
                activeTurnId: activeTurnIdRef.current,
                completedAt,
                lastError: nextError?.message ?? null,
                updatedAt: completedAt,
            });
            setError(nextError);
            setFinishReason(reason);
            setIsStreaming(false);
            setStatus('ready');
            clearActiveCommand();
        },
        [clearActiveCommand, finalizeAssistantMessage, persistSessionState],
    );

    const processClaudeEvent = useCallback(
        (event: ClaudeEvent) => {
            switch (event.type) {
                case 'system':
                    if (event.subtype === 'init' && event.session_id) {
                        setStatus('streaming');
                        void persistSessionState({
                            status: 'running',
                            providerName: 'claude',
                            model: activeModelRef.current,
                            sessionId: event.session_id,
                            activeTurnId: activeTurnIdRef.current,
                            startedAt: activeTurnStartedAtRef.current,
                            lastError: null,
                            updatedAt: new Date(),
                        });
                    }
                    return;
                case 'assistant': {
                    const text = event.message?.content
                        ?.filter((part) => part.type === 'text')
                        .map((part) => part.text ?? '')
                        .join('');
                    if (text) {
                        setStatus('streaming');
                        upsertAssistantMessage(text, 'replace', {
                            streaming: true,
                        });
                    }
                    return;
                }
                case 'stream_event': {
                    const streamEvent = event.event;
                    if (
                        streamEvent?.type === 'content_block_delta' &&
                        streamEvent.delta?.type === 'text_delta' &&
                        streamEvent.delta.text
                    ) {
                        setStatus('streaming');
                        upsertAssistantMessage(streamEvent.delta.text, 'append', {
                            streaming: true,
                        });
                    }
                    return;
                }
                case 'result':
                    if (event.session_id) {
                        void persistSessionState({
                            status: 'running',
                            providerName: 'claude',
                            model: activeModelRef.current,
                            sessionId: event.session_id,
                            activeTurnId: activeTurnIdRef.current,
                            startedAt: activeTurnStartedAtRef.current,
                            lastError: null,
                            updatedAt: new Date(),
                        });
                    }

                    if (event.is_error) {
                        const message = event.result?.trim() || rawOutputRef.current.trim();
                        finalizeCommand('error', new Error(message || 'Desktop local chat failed'));
                    } else {
                        if (event.result) {
                            upsertAssistantMessage(event.result, 'replace', {
                                streaming: false,
                                completedAt: new Date(),
                                finishReason: normalizeFinishReason(event.stop_reason ?? 'stop'),
                            });
                        }
                        finalizeCommand(event.stop_reason ?? 'end_turn');
                    }
                    return;
            }
        },
        [finalizeCommand, persistSessionState, upsertAssistantMessage],
    );

    const processCodexEvent = useCallback(
        (event: CodexEvent) => {
            switch (event.type) {
                case 'thread.started':
                    if (event.thread_id) {
                        setStatus('streaming');
                        void persistSessionState({
                            status: 'running',
                            providerName: 'codex',
                            model: activeModelRef.current,
                            sessionId: event.thread_id,
                            activeTurnId: activeTurnIdRef.current,
                            startedAt: activeTurnStartedAtRef.current,
                            lastError: null,
                            updatedAt: new Date(),
                        });
                    }
                    return;
                case 'item.delta': {
                    const text = extractCodexEventText(event);
                    if (text) {
                        setStatus('streaming');
                        upsertAssistantMessage(text, 'append', {
                            streaming: true,
                        });
                    }
                    return;
                }
                case 'item.completed': {
                    const text = extractCodexEventText(event);
                    if (text) {
                        setStatus('streaming');
                        upsertAssistantMessage(text, 'replace', {
                            streaming: true,
                        });
                    }
                    return;
                }
                case 'error': {
                    const message = getCodexErrorMessage(event) || rawOutputRef.current.trim();
                    finalizeCommand('error', new Error(message || 'Desktop local chat failed'));
                    return;
                }
                case 'turn.completed': {
                    const lastAssistantMessage = messagesRef.current.findLast(
                        (message) => message.role === 'assistant',
                    );
                    if (!lastAssistantMessage && rawOutputRef.current.trim()) {
                        finalizeCommand(
                            'error',
                            new Error(rawOutputRef.current.trim() || 'Desktop local chat failed'),
                        );
                        return;
                    }
                    finalizeCommand('end_turn');
                    return;
                }
            }
        },
        [finalizeCommand, persistSessionState, upsertAssistantMessage],
    );

    const processOutputChunk = useCallback(
        (chunk: string) => {
            if (!chunk) {
                return;
            }

            outputBufferRef.current += chunk;

            while (true) {
                const newlineIndex = outputBufferRef.current.indexOf('\n');
                if (newlineIndex === -1) {
                    break;
                }

                const line = outputBufferRef.current.slice(0, newlineIndex).trim();
                outputBufferRef.current = outputBufferRef.current.slice(newlineIndex + 1);
                if (!line) {
                    continue;
                }

                try {
                    const parsed = JSON.parse(line) as ClaudeEvent | CodexEvent;
                    if (activeCliRef.current === 'codex') {
                        processCodexEvent(parsed as CodexEvent);
                    } else {
                        processClaudeEvent(parsed as ClaudeEvent);
                    }
                } catch {
                    rawOutputRef.current += `${line}\n`;
                }
            }
        },
        [processClaudeEvent, processCodexEvent],
    );

    const runCli = useCallback(
        async ({
            content,
            context,
            type,
            resetSession,
        }: {
            content: string;
            context: MessageContext[];
            type: ChatType;
            resetSession?: boolean;
        }) => {
            const pickerState = await getDesktopLocalChatPickerState(projectId, conversationId);
            const selection = pickerState.selection;
            if (!selection) {
                throw new Error(
                    'No supported local AI CLI was found. Install Claude (`claude`) or Codex (`codex`) to use desktop-local chat.',
                );
            }
            const provider = editorEngine.activeSandbox.session.provider;
            if (!provider) {
                throw new Error('Desktop local sandbox provider is not ready');
            }

            if (!pickerState.availableClis.includes(selection.cli)) {
                throw new Error(
                    `${selection.cli} is not currently available in this local environment.`,
                );
            }

            await setDesktopLocalChatSelection(projectId, selection, {
                conversationId,
            });

            const shouldResume = !resetSession
                && !!pickerState.session.sessionId
                && pickerState.session.providerName === selection.cli
                && pickerState.session.model === selection.model
                && pickerState.session.status !== 'error'
                && pickerState.session.status !== 'interrupted';
            const nextStartedAt = activeTurnStartedAtRef.current ?? new Date();

            await persistSessionState({
                status: 'submitted',
                providerName: selection.cli,
                model: selection.model,
                sessionId: shouldResume ? pickerState.session.sessionId : null,
                activeTurnId: activeTurnIdRef.current,
                startedAt: nextStartedAt,
                completedAt: null,
                lastError: null,
                updatedAt: nextStartedAt,
            });

            const prompt = buildDesktopLocalPrompt({
                content,
                context,
                type,
            });
            const promptArg = shellQuote(prompt);
            const modelArg = shellQuote(selection.model);
            const resumeSessionId = shouldResume ? pickerState.session.sessionId : null;
            const commandText = selection.cli === 'claude'
                ? `claude -p --model ${modelArg}${resumeSessionId ? ` --resume ${shellQuote(resumeSessionId)}` : ''} --output-format stream-json --include-partial-messages --verbose --dangerously-skip-permissions ${promptArg}`
                : resumeSessionId
                    ? `codex exec resume --json -m ${modelArg} --dangerously-bypass-approvals-and-sandbox ${shellQuote(resumeSessionId)} ${promptArg}`
                    : `codex exec --json -m ${modelArg} --dangerously-bypass-approvals-and-sandbox ${promptArg}`;

            activeCliRef.current = selection.cli;
            activeModelRef.current = selection.model;
            const commandResult = await provider.runBackgroundCommand({
                args: {
                    command: commandText,
                },
            });

            const command = commandResult.command;
            const unsubscribe = command.onOutput((chunk) => {
                processOutputChunk(chunk);
            });

            activeCommandRef.current = {
                kill: () => command.kill(),
                unsubscribe,
            };
        },
        [
            conversationId,
            persistSessionState,
            processOutputChunk,
            projectId,
            editorEngine.activeSandbox.session.provider,
        ],
    );

    const processMessage = useCallback(
        async (
            content: string,
            type: ChatType,
            context?: MessageContext[],
            options?: { resetSession?: boolean },
        ) => {
            setError(undefined);
            const turnId = uuidv4();
            const turnStartedAt = new Date();
            activeTurnIdRef.current = turnId;
            activeTurnStartedAtRef.current = turnStartedAt;
            const messageContext =
                context ?? (await editorEngine.chat.context.getContextByChatType(type));
            const newMessage = getUserChatMessageFromString(content, messageContext, conversationId);
            const nextMessages = applyMessages((currentMessages) => [...currentMessages, newMessage]);
            await persistMessages(nextMessages);

            setStatus('submitted');
            setIsStreaming(true);
            try {
                await runCli({
                    content,
                    context: messageContext,
                    type,
                    resetSession: options?.resetSession,
                });
            } catch (runError) {
                const nextError = runError instanceof Error
                    ? runError
                    : new Error('Desktop local chat failed to start');
                void persistSessionState({
                    status: 'error',
                    providerName: activeCliRef.current,
                    model: activeModelRef.current,
                    activeTurnId: activeTurnIdRef.current,
                    completedAt: new Date(),
                    lastError: nextError.message,
                    updatedAt: new Date(),
                });
                setError(nextError);
                setIsStreaming(false);
                setStatus('ready');
                clearActiveCommand();
                activeTurnIdRef.current = null;
                activeTurnStartedAtRef.current = null;
                throw nextError;
            }
            void editorEngine.chat.conversation.generateTitle(content);
            return newMessage;
        },
        [
            applyMessages,
            clearActiveCommand,
            conversationId,
            editorEngine.chat.context,
            editorEngine.chat.conversation,
            persistMessages,
            persistSessionState,
            runCli,
        ],
    );

    const sendMessage: SendMessage = useCallback(
        async (content: string, type: ChatType) => {
            const selection = await getDesktopLocalChatSelection(projectId, {
                conversationId,
            });
            posthog.capture('user_send_message', {
                type,
                provider: selection?.cli ?? 'desktop-local-cli',
                model: selection?.model ?? null,
            });

            const context = await editorEngine.chat.context.getContextByChatType(type);
            const newQueuedMessage: QueuedMessage = {
                id: uuidv4(),
                content,
                type,
                timestamp: new Date(),
                context,
            };

            if (isStreaming) {
                setQueuedMessages((currentQueue) => [...currentQueue, newQueuedMessage]);
                return getUserChatMessageFromString(content, [], conversationId);
            }

            if (queuedMessages.length > 0) {
                setQueuedMessages((currentQueue) => [newQueuedMessage, ...currentQueue]);
                return getUserChatMessageFromString(content, [], conversationId);
            }

            return processMessage(content, type, context);
        },
        [
            conversationId,
            editorEngine.chat.context,
            isStreaming,
            posthog,
            projectId,
            processMessage,
            queuedMessages.length,
        ],
    );

    const processNextInQueue = useCallback(async () => {
        if (isProcessingQueue.current || isStreaming || queuedMessages.length === 0) {
            return;
        }

        const nextMessage = queuedMessages[0];
        if (!nextMessage) {
            return;
        }

        isProcessingQueue.current = true;

        try {
            const refreshedContext = await editorEngine.chat.context.getRefreshedContext(
                nextMessage.context,
            );
            await processMessage(nextMessage.content, nextMessage.type, refreshedContext);
            setQueuedMessages((currentQueue) => currentQueue.slice(1));
        } catch (queueError) {
            console.error('Failed to process queued desktop-local chat message:', queueError);
            setError(
                queueError instanceof Error
                    ? queueError
                    : new Error('Failed to process queued desktop-local message'),
            );
        } finally {
            isProcessingQueue.current = false;
        }
    }, [editorEngine.chat.context, isStreaming, processMessage, queuedMessages]);

    const editMessage: EditMessage = useCallback(
        async (messageId: string, newContent: string, chatType: ChatType) => {
            const selection = await getDesktopLocalChatSelection(projectId, {
                conversationId,
            });
            posthog.capture('user_edit_message', {
                type: chatType,
                provider: selection?.cli ?? 'desktop-local-cli',
                model: selection?.model ?? null,
            });

            if (isStreaming) {
                await activeCommandRef.current?.kill();
            }

            const messageIndex = messagesRef.current.findIndex((message) => message.id === messageId);
            const message = messagesRef.current[messageIndex];
            if (messageIndex === -1 || !message || message.role !== 'user') {
                throw new Error('Message not found.');
            }

            const updatedMessages = messagesRef.current.slice(0, messageIndex);
            const previousContext = message.metadata?.context ?? [];
            const updatedContext = await editorEngine.chat.context.getRefreshedContext(previousContext);

            const updatedMessage: ChatMessage = {
                ...message,
                parts: [{ type: 'text', text: newContent }],
                metadata: {
                    ...message.metadata,
                    context: updatedContext,
                    conversationId,
                    createdAt: message.metadata?.createdAt ?? new Date(),
                    checkpoints: message.metadata?.checkpoints ?? [],
                },
            };

            const nextMessages = jsonClone([...updatedMessages, updatedMessage]);
            setMessages(nextMessages);
            messagesRef.current = nextMessages;
            await persistMessages(nextMessages);

            activeTurnIdRef.current = uuidv4();
            activeTurnStartedAtRef.current = new Date();
            setStatus('submitted');
            setIsStreaming(true);
            try {
                await runCli({
                    content: newContent,
                    context: updatedContext,
                    type: chatType,
                    resetSession: true,
                });
            } catch (runError) {
                const nextError = runError instanceof Error
                    ? runError
                    : new Error('Desktop local chat failed to restart');
                void persistSessionState({
                    status: 'error',
                    providerName: activeCliRef.current,
                    model: activeModelRef.current,
                    activeTurnId: activeTurnIdRef.current,
                    completedAt: new Date(),
                    lastError: nextError.message,
                    updatedAt: new Date(),
                });
                setError(nextError);
                setIsStreaming(false);
                setStatus('ready');
                clearActiveCommand();
                activeTurnIdRef.current = null;
                activeTurnStartedAtRef.current = null;
                throw nextError;
            }

            return updatedMessage;
        },
        [
            clearActiveCommand,
            conversationId,
            editorEngine.chat.context,
            isStreaming,
            persistMessages,
            persistSessionState,
            posthog,
            projectId,
            runCli,
        ],
    );

    const removeFromQueue = useCallback((id: string) => {
        setQueuedMessages((currentQueue) => currentQueue.filter((message) => message.id !== id));
    }, []);

    const stop = useCallback(async () => {
        await activeCommandRef.current?.kill();
        const completedAt = new Date();
        finalizeAssistantMessage('stop');
        void persistSessionState({
            status: 'interrupted',
            providerName: activeCliRef.current,
            model: activeModelRef.current,
            activeTurnId: activeTurnIdRef.current,
            completedAt,
            lastError: null,
            updatedAt: completedAt,
        });
        clearActiveCommand();
        setIsStreaming(false);
        setStatus('ready');
        setFinishReason('stop');
        await persistMessages(messagesRef.current);
    }, [
        clearActiveCommand,
        finalizeAssistantMessage,
        persistMessages,
        persistSessionState,
    ]);

    useEffect(() => {
        if (!finishReason) {
            return;
        }

        const finalizeTurn = async () => {
            const lastUserMessage = messagesRef.current.findLast((message) => message.role === 'user');
            if (!lastUserMessage) {
                return;
            }

            if (finishReason !== 'error') {
                const content = getMessageText(lastUserMessage.parts);
                if (content) {
                    try {
                        const checkpoints = await createCheckpointsForAllBranches(
                            editorEngine,
                            content,
                        );
                        if (checkpoints.length > 0) {
                            const oldCheckpoints =
                                lastUserMessage.metadata?.checkpoints.map((checkpoint) => ({
                                    ...checkpoint,
                                    createdAt: new Date(checkpoint.createdAt),
                                })) ?? [];

                            const nextMessages = messagesRef.current.map((message) => {
                                if (message.id !== lastUserMessage.id) {
                                    return message;
                                }

                                return {
                                    ...message,
                                    metadata: {
                                        ...message.metadata,
                                        createdAt: message.metadata?.createdAt ?? new Date(),
                                        conversationId,
                                        checkpoints: [...oldCheckpoints, ...checkpoints],
                                        context: message.metadata?.context ?? [],
                                    },
                                };
                            });

                            const clonedMessages = jsonClone(nextMessages);
                            setMessages(clonedMessages);
                            messagesRef.current = clonedMessages;
                        }
                    } catch (checkpointError) {
                        console.error(
                            'Failed to create desktop-local chat checkpoints:',
                            checkpointError,
                        );
                    }
                }
            }

            try {
                await editorEngine.chat.context.clearImagesFromContext();
            } catch (contextError) {
                console.error(
                    'Failed to clear desktop-local chat image context:',
                    contextError,
                );
            }
            await persistMessages(messagesRef.current);

            if (finishReason === 'stop' && queuedMessages.length > 0) {
                window.setTimeout(() => {
                    void processNextInQueue();
                }, 500);
            }
        };

        void finalizeTurn().finally(() => {
            activeTurnIdRef.current = null;
            activeTurnStartedAtRef.current = null;
            setFinishReason(null);
        });
    }, [
        conversationId,
        editorEngine,
        finishReason,
        persistMessages,
        processNextInQueue,
        queuedMessages.length,
    ]);

    useEffect(() => {
        editorEngine.chat.conversation.setConversationLength(messages.length);
    }, [editorEngine.chat.conversation, messages.length]);

    useEffect(() => {
        editorEngine.chat.setChatActions(sendMessage);
    }, [editorEngine.chat, sendMessage]);

    return {
        status,
        sendMessage,
        editMessage,
        messages,
        error,
        stop,
        isStreaming,
        queuedMessages,
        removeFromQueue,
    };
}
