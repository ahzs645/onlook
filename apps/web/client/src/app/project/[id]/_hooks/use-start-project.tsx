'use client';

import { useOptionalDesktopLocalProject } from '../_components/desktop-local-context';
import { useEditorEngine } from '@/components/store/editor';
import { api } from '@/trpc/react';
import { isDesktopLocalProjectId } from '@/utils/desktop-local';
import { type ProjectCreateRequest } from '@onlook/db';
import {
    ChatType,
    CreateRequestContextType,
    MessageContextType,
    ProjectCreateRequestStatus,
    type ImageMessageContext,
    type MessageContext,
} from '@onlook/models';
import { toast } from '@onlook/ui/sonner';
import { useEffect, useRef, useState } from 'react';
import { useTabActive } from '../_hooks/use-tab-active';
import { v4 as uuidv4 } from 'uuid';

interface ProjectReadyState {
    canvas: boolean;
    conversations: boolean;
    sandbox: boolean;
}

export const useStartProject = () => {
    const editorEngine = useEditorEngine();
    const sandbox = editorEngine.activeSandbox;
    const isDesktopLocal = isDesktopLocalProjectId(editorEngine.projectId);
    const desktopLocalProject = useOptionalDesktopLocalProject();
    const [error, setError] = useState<string | null>(null);
    const processedRequestIdRef = useRef<string | null>(null);
    const { tabState } = useTabActive();
    const apiUtils = api.useUtils();
    const { data: user, error: userError } = api.user.get.useQuery(undefined, {
        enabled: !isDesktopLocal,
    });
    const { data: canvasWithFrames, error: canvasError } = api.userCanvas.getWithFrames.useQuery(
        { projectId: editorEngine.projectId },
        { enabled: !isDesktopLocal },
    );
    const { data: conversations, error: conversationsError } = api.chat.conversation.getAll.useQuery(
        { projectId: editorEngine.projectId },
        { enabled: !isDesktopLocal },
    );
    const { data: creationRequest, error: creationRequestError } =
        api.project.createRequest.getPendingRequest.useQuery(
            { projectId: editorEngine.projectId },
            { enabled: !isDesktopLocal },
        );
    const { mutateAsync: updateCreateRequest } = api.project.createRequest.updateStatus.useMutation({
        onSettled: async () => {
            await apiUtils.project.createRequest.getPendingRequest.invalidate({ projectId: editorEngine.projectId });
        },
    });
    const [projectReadyState, setProjectReadyState] = useState<ProjectReadyState>({
        canvas: false,
        conversations: false,
        sandbox: false,
    });

    const updateProjectReadyState = (state: Partial<ProjectReadyState>) => {
        setProjectReadyState((prev) => ({ ...prev, ...state }));
    };

    useEffect(() => {
        if (isDesktopLocal) {
            return;
        }

        if (!sandbox.session.isConnecting) {
            updateProjectReadyState({ sandbox: true });
        }
    }, [isDesktopLocal, sandbox.session.isConnecting]);

    useEffect(() => {
        if (tabState === 'reactivated') {
            sandbox.session.reconnect(editorEngine.branches.activeBranch.sandbox.id, user?.id);
        }
    }, [editorEngine.branches.activeBranch.sandbox.id, sandbox.session, tabState, user?.id]);

    useEffect(() => {
        if (isDesktopLocal) {
            return;
        }

        if (canvasWithFrames) {
            editorEngine.canvas.applyCanvas(canvasWithFrames.userCanvas);
            editorEngine.frames.applyFrames(canvasWithFrames.frames);
            updateProjectReadyState({ canvas: true });
        }
    }, [canvasWithFrames, editorEngine.canvas, editorEngine.frames, isDesktopLocal]);

    useEffect(() => {
        if (isDesktopLocal) {
            return;
        }

        const applyConversations = async () => {
            if (conversations) {
                await editorEngine.chat.conversation.applyConversations(conversations);
                updateProjectReadyState({ conversations: true });
            }
        };
        void applyConversations();
    }, [conversations, editorEngine.chat.conversation, isDesktopLocal]);

    useEffect(() => {
        if (isDesktopLocal) {
            return;
        }

        const isProjectReady = Object.values(projectReadyState).every((value) => value);
        if (creationRequest && processedRequestIdRef.current !== creationRequest.id && isProjectReady && editorEngine.chat._sendMessageAction) {
            processedRequestIdRef.current = creationRequest.id;
            void resumeCreate(creationRequest);
        }
    }, [creationRequest, editorEngine.chat._sendMessageAction, isDesktopLocal, projectReadyState]);

    const resumeCreate = async (creationData: ProjectCreateRequest) => {
        try {
            if (editorEngine.projectId !== creationData.projectId) {
                throw new Error('Project ID mismatch');
            }

            const createContext: MessageContext[] =
                await editorEngine.chat.context.getCreateContext();
            const imageContexts: ImageMessageContext[] = creationData.context
                .filter((context) => context.type === CreateRequestContextType.IMAGE)
                .map((context) => ({
                    type: MessageContextType.IMAGE,
                    source: 'external',
                    content: context.content,
                    mimeType: context.mimeType,
                    displayName: 'user image',
                    id: uuidv4(),
                }));

            const context: MessageContext[] = [...createContext, ...imageContexts];
            editorEngine.chat.context.addContexts(context);

            const prompt = creationData.context
                .filter((context) => context.type === CreateRequestContextType.PROMPT)
                .map((context) => context.content)
                .join('\n');

            const [conversation] = await editorEngine.chat.conversation.getConversations(
                editorEngine.projectId,
            );

            if (!conversation) {
                throw new Error('No conversation found');
            }

            await editorEngine.chat.conversation.selectConversation(conversation.id);
            await editorEngine.chat.sendMessage(prompt, ChatType.CREATE);

            try {
                await updateCreateRequest({
                    projectId: editorEngine.projectId,
                    status: ProjectCreateRequestStatus.COMPLETED,
                });
            } catch (error) {
                console.error('Failed to update create request', error);
                toast.error('Failed to complete create request', {
                    description: error instanceof Error ? error.message : 'Unknown error',
                });
            }
        } catch (error) {
            processedRequestIdRef.current = null; // Allow retry on failure
            console.error('Failed to resume create request', error);
            toast.error('Failed to resume create request', {
                description: error instanceof Error ? error.message : 'Unknown error',
            });
        }
    };
    useEffect(() => {
        if (isDesktopLocal) {
            return;
        }

        setError(userError?.message ?? canvasError?.message ?? conversationsError?.message ?? creationRequestError?.message ?? null);
    }, [canvasError, conversationsError, creationRequestError, isDesktopLocal, userError]);

    if (isDesktopLocal) {
        return {
            isProjectReady: desktopLocalProject?.isProjectReady ?? false,
            error: desktopLocalProject?.error ?? null,
        };
    }

    return { isProjectReady: Object.values(projectReadyState).every((value) => value), error };
}
