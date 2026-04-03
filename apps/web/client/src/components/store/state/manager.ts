import { SettingsTabValue } from '@onlook/models';
import { makeAutoObservable } from 'mobx';

export class StateManager {
    private _isSubscriptionModalOpen = false;
    private _isSettingsModalOpen = false;
    private _settingsTab: SettingsTabValue | string = SettingsTabValue.SITE;

    constructor() {
        makeAutoObservable(this);
    }

    get isSubscriptionModalOpen() {
        return this._isSubscriptionModalOpen;
    }

    set isSubscriptionModalOpen(value: boolean) {
        this._isSubscriptionModalOpen = value;
    }

    get isSettingsModalOpen() {
        return this._isSettingsModalOpen;
    }

    set isSettingsModalOpen(value: boolean) {
        this._isSettingsModalOpen = value;
    }

    get settingsTab() {
        return this._settingsTab;
    }

    set settingsTab(value: SettingsTabValue | string) {
        this._settingsTab = value;
    }
}
