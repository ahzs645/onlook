import { parseDesktopLocalProjectId } from '@/utils/desktop-local';
import { api } from '@/trpc/client';
import { isAfter, subMinutes } from 'date-fns';
import { debounce } from 'lodash';
import { makeAutoObservable } from 'mobx';
import type { EditorEngine } from '../engine';

const DESKTOP_PREVIEW_CAPTURE_ATTEMPTS = 5;
const DESKTOP_PREVIEW_CAPTURE_RETRY_DELAY_MS = 1000;

export class ScreenshotManager {
    _lastScreenshotTime: Date | null = null;
    isCapturing = false;

    constructor(private editorEngine: EditorEngine) {
        makeAutoObservable(this);
    }

    get lastScreenshotAt() {
        return this._lastScreenshotTime;
    }

    set lastScreenshotAt(time: Date | null) {
        this._lastScreenshotTime = time;
    }

    private getFrameScreenshotCandidates() {
        const selectedFrames = this.editorEngine.frames.selected.filter((frame) => !!frame.view);
        const fallbackFrames = this.editorEngine.frames
            .getAll()
            .filter(
                (frame) =>
                    !!frame.view &&
                    !selectedFrames.some((selected) => selected.frame.id === frame.frame.id),
            );

        return [...selectedFrames, ...fallbackFrames];
    }

    // 10 second debounce
    captureScreenshot = debounce(
        this.debouncedCaptureScreenshot,
        10000,
    );

    private async debouncedCaptureScreenshot() {
        if (this.isCapturing) {
            return;
        }
        this.isCapturing = true;
        try {
            // If the screenshot was captured less than 30 minutes ago, skip capturing
            if (this.lastScreenshotAt) {
                const thirtyMinutesAgo = subMinutes(new Date(), 30);
                if (isAfter(this.lastScreenshotAt, thirtyMinutesAgo)) {
                    return;
                }
            }
            const result = await api.project.captureScreenshot.mutate({ projectId: this.editorEngine.projectId });
            if (!result || !result.success) {
                throw new Error('Failed to capture screenshot');
            }
            this.lastScreenshotAt = new Date();
        } catch (error) {
            console.error('Error capturing screenshot', error);
        } finally {
            this.isCapturing = false;
        }
    }

    async captureDesktopLocalProjectPreview(options?: {
        maxAttempts?: number;
        retryDelayMs?: number;
    }) {
        const desktopProjectId = parseDesktopLocalProjectId(this.editorEngine.projectId);
        const desktopBridge =
            typeof window === 'undefined' ? null : window.onlookDesktop ?? null;

        if (!desktopProjectId || !desktopBridge) {
            return false;
        }

        if (this.isCapturing) {
            return false;
        }

        this.isCapturing = true;

        try {
            const maxAttempts = Math.max(options?.maxAttempts ?? DESKTOP_PREVIEW_CAPTURE_ATTEMPTS, 1);
            const retryDelayMs =
                options?.retryDelayMs ?? DESKTOP_PREVIEW_CAPTURE_RETRY_DELAY_MS;

            for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
                const frames = this.getFrameScreenshotCandidates();

                for (const frame of frames) {
                    try {
                        const result = await frame.view?.captureScreenshot();
                        if (!result?.data) {
                            continue;
                        }

                        await desktopBridge.saveProjectPreview(desktopProjectId, result.data);
                        this.lastScreenshotAt = new Date();
                        return true;
                    } catch {
                        continue;
                    }
                }

                if (attempt < maxAttempts - 1 && retryDelayMs > 0) {
                    await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
                }
            }
        } catch (error) {
            console.error('Error capturing desktop-local preview', error);
        } finally {
            this.isCapturing = false;
        }

        return false;
    }

    clear() {
        this.lastScreenshotAt = null;
    }
}
