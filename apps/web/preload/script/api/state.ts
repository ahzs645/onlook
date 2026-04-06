import { penpalParent } from "..";

function isDestroyedConnectionError(error: unknown): boolean {
    return error instanceof Error && error.message.toLowerCase().includes('destroyed connection');
}

let frameIdRecoveryPromise: Promise<void> | null = null;
let branchIdRecoveryPromise: Promise<void> | null = null;

function recoverFrameId() {
    if (frameIdRecoveryPromise || !penpalParent) {
        return;
    }

    try {
        frameIdRecoveryPromise = penpalParent.getFrameId()
            .then((id) => {
                setFrameId(id);
            })
            .catch((error) => {
                if (!isDestroyedConnectionError(error)) {
                    console.warn('Failed to recover frame id', error);
                }
            })
            .finally(() => {
                frameIdRecoveryPromise = null;
            });
    } catch (error) {
        frameIdRecoveryPromise = null;
        if (!isDestroyedConnectionError(error)) {
            console.warn('Failed to recover frame id', error);
        }
    }
}

function recoverBranchId() {
    if (branchIdRecoveryPromise || !penpalParent) {
        return;
    }

    try {
        branchIdRecoveryPromise = penpalParent.getBranchId()
            .then((id) => {
                setBranchId(id);
            })
            .catch((error) => {
                if (!isDestroyedConnectionError(error)) {
                    console.warn('Failed to recover branch id', error);
                }
            })
            .finally(() => {
                branchIdRecoveryPromise = null;
            });
    } catch (error) {
        branchIdRecoveryPromise = null;
        if (!isDestroyedConnectionError(error)) {
            console.warn('Failed to recover branch id', error);
        }
    }
}

export function setFrameId(frameId: string) {
    (window as any)._onlookFrameId = frameId;
}

export function getFrameId(): string {
    const frameId = (window as any)._onlookFrameId;
    if (!frameId) {
        recoverFrameId();
        return '';
    }
    return frameId;
}

export function setBranchId(branchId: string) {
    (window as any)._onlookBranchId = branchId;
}

export function getBranchId(): string {
    const branchId = (window as any)._onlookBranchId;
    if (!branchId) {
        recoverBranchId();
        return '';
    }
    return branchId;
}
