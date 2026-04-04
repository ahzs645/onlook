import { PENPAL_CHILD_CHANNEL, type PromisifiedPenpalParentMethods } from '@onlook/penpal';
import debounce from 'lodash/debounce';
import { WindowMessenger, connect } from 'penpal';
import { preloadMethods } from './api';

export let penpalParent: PromisifiedPenpalParentMethods | null = null;
let isConnecting = false;

function isDestroyedConnectionError(error: unknown): boolean {
    if (!(error instanceof Error)) {
        return false;
    }

    return error.message.toLowerCase().includes('destroyed connection');
}

/**
 * Find the correct parent window for Onlook connection.
 * Handles both direct iframes (Next.js) and nested iframes (Storybook).
 */
const findOnlookParent = (): Window => {
    // If we're not in an iframe, something is wrong
    if (window === window.top) {
        console.warn(`${PENPAL_CHILD_CHANNEL} - Not in an iframe, using window.parent as fallback`);
        return window.parent;
    }

    // Check if we're in a direct iframe (parent is the top window)
    // This is the Next.js case: Onlook -> Next.js iframe
    if (window.parent === window.top) {
        return window.parent;
    }

    // We're in a nested iframe (parent is NOT the top window)
    // This is the Storybook case: Onlook -> CodeSandbox -> Storybook preview iframe
    if (window.top) {
        return window.top;
    }

    // Final fallback
    return window.parent;
};

const createMessageConnection = async () => {
    if (isConnecting || penpalParent) {
        return penpalParent;
    }

    isConnecting = true;

    const messenger = new WindowMessenger({
        remoteWindow: findOnlookParent(),
        // TODO: Use a proper origin
        allowedOrigins: ['*'],
    });

    const connection = connect({
        messenger,
        // Methods the iframe window is exposing to the parent window.
        methods: preloadMethods
    });

    connection.promise.then((parent) => {
        if (!parent) {
            reconnect();
            return;
        }
        const remote = parent as unknown as PromisifiedPenpalParentMethods;
        penpalParent = remote;
    }).finally(() => {
        isConnecting = false;
    });

    connection.promise.catch((error) => {
        if (isDestroyedConnectionError(error)) {
            return;
        }
        reconnect();
    });

    return penpalParent;
}

const reconnect = debounce(() => {
    if (isConnecting) return;

    penpalParent = null; // Reset the parent before reconnecting
    createMessageConnection();
}, 1000);

createMessageConnection();
