import { penpalParent } from "..";

function isDestroyedConnectionError(error: unknown): boolean {
    return error instanceof Error && error.message.toLowerCase().includes('destroyed connection');
}

export function setFrameId(frameId: string) {
    (window as any)._onlookFrameId = frameId;
}

export function getFrameId(): string {
    const frameId = (window as any)._onlookFrameId;
    if (!frameId) {
        console.warn('Frame id not found');
        penpalParent?.getFrameId()
            .then((id) => {
                setFrameId(id);
            })
            .catch((error) => {
                if (!isDestroyedConnectionError(error)) {
                    console.warn('Failed to recover frame id', error);
                }
            });
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
        console.warn('Branch id not found');
        penpalParent?.getBranchId()
            .then((id) => {
                setBranchId(id);
            })
            .catch((error) => {
                if (!isDestroyedConnectionError(error)) {
                    console.warn('Failed to recover branch id', error);
                }
            });
        return '';
    }
    return branchId;
}
