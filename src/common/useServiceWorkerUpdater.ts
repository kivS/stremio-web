// Copyright (C) 2017-2023 Smart code 203358507

import { useSyncExternalStore } from 'react';

type Snapshot = {
    updateReady: boolean,
    reloadPending: boolean,
};

const INITIAL_SNAPSHOT: Snapshot = {
    updateReady: false,
    reloadPending: false,
};

let snapshot = INITIAL_SNAPSHOT;
let registration: ServiceWorkerRegistration | null = null;
let waitingWorker: ServiceWorker | null = null;
let promptReady = false;
let reloadPending = false;
let reloading = false;
let applyingUpdate = false;
let promptOnNextUpdateFound = false;
let promptOnNextUpdateFoundTimeout: ReturnType<typeof setTimeout> | null = null;

const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
    listeners.add(listener);

    return () => {
        listeners.delete(listener);
    };
};

const getSnapshot = () => snapshot;

const emitSnapshot = () => {
    const nextSnapshot = {
        updateReady: promptReady && (waitingWorker !== null || reloadPending),
        reloadPending,
    };

    if (snapshot.updateReady !== nextSnapshot.updateReady || snapshot.reloadPending !== nextSnapshot.reloadPending) {
        snapshot = nextSnapshot;
        listeners.forEach((listener) => listener());
    }
};

const clearPromptOnNextUpdateFound = () => {
    promptOnNextUpdateFound = false;

    if (promptOnNextUpdateFoundTimeout !== null) {
        clearTimeout(promptOnNextUpdateFoundTimeout);
        promptOnNextUpdateFoundTimeout = null;
    }
};

const markPromptOnNextUpdateFound = () => {
    clearPromptOnNextUpdateFound();
    promptOnNextUpdateFound = true;
    promptOnNextUpdateFoundTimeout = setTimeout(clearPromptOnNextUpdateFound, 60000);
};

const consumePromptOnNextUpdateFound = () => {
    const shouldPrompt = promptOnNextUpdateFound;
    clearPromptOnNextUpdateFound();

    return shouldPrompt;
};

const reloadPage = () => {
    if (reloading) {
        return;
    }

    reloading = true;
    window.location.reload();
};

const setWaitingWorker = (worker: ServiceWorker, shouldPrompt: boolean) => {
    waitingWorker = worker;
    promptReady = shouldPrompt || promptReady;
    emitSnapshot();
};

const trackInstalling = (worker: ServiceWorker | null, shouldPrompt: boolean) => {
    if (worker === null) {
        return;
    }

    const onStateChange = () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller !== null) {
            setWaitingWorker(worker, shouldPrompt);
        }
    };

    worker.addEventListener('statechange', onStateChange);
    onStateChange();
};

const checkForUpdate = () => {
    if (registration === null || navigator.serviceWorker.controller === null) {
        return;
    }

    markPromptOnNextUpdateFound();
    registration.update().catch((error) => {
        clearPromptOnNextUpdateFound();
        console.error('SW update check failed: ', error);
    });
};

const showPendingUpdate = () => {
    if (waitingWorker !== null || reloadPending) {
        promptReady = true;
        emitSnapshot();
        return true;
    }

    return false;
};

const applyUpdate = () => {
    if (reloadPending) {
        reloadPage();
        return;
    }

    if (waitingWorker !== null) {
        applyingUpdate = true;
        waitingWorker.postMessage({ type: 'SKIP_WAITING' });
    }
};

const registerServiceWorker = async () => {
    let hadController = navigator.serviceWorker.controller !== null;

    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!hadController) {
            hadController = true;
            return;
        }

        waitingWorker = null;

        if (applyingUpdate) {
            reloadPage();
            return;
        }

        reloadPending = true;
        promptReady = false;
        emitSnapshot();
    });

    try {
        registration = await navigator.serviceWorker.register('service-worker.js');

        registration.addEventListener('updatefound', () => {
            trackInstalling(registration?.installing ?? null, consumePromptOnNextUpdateFound());
        });

        trackInstalling(registration.installing, true);

        if (registration.waiting !== null && navigator.serviceWorker.controller !== null) {
            setWaitingWorker(registration.waiting, true);
        } else {
            checkForUpdate();
        }

        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible' && !showPendingUpdate()) {
                checkForUpdate();
            }
        });
    } catch (error) {
        console.error('SW registration failed: ', error);
    }
};

const useServiceWorkerUpdater = () => {
    const updaterSnapshot = useSyncExternalStore(subscribe, getSnapshot);

    return {
        ...updaterSnapshot,
        applyUpdate,
    };
};

export {
    registerServiceWorker,
    useServiceWorkerUpdater,
};
