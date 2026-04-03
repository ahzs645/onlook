import {
    type BranchTabValue,
    type BrandTabValue,
    ChatType,
    EditorMode,
    InsertMode,
    type LeftPanelTabValue
} from '@onlook/models';
import { debounce } from 'lodash';
import { makeAutoObservable } from 'mobx';

export class StateManager {
    private _canvasScrolling = false;
    private _hotkeysOpen = false;
    private _publishOpen = false;
    private _leftPanelLocked = false;
    private _canvasPanning = false;
    private _isDragSelecting = false;

    private _editorMode: EditorMode = EditorMode.DESIGN;
    private _insertMode: InsertMode | null = null;
    private _leftPanelTab: LeftPanelTabValue | null = null;
    private _brandTab: BrandTabValue | null = null;
    private _branchTab: BranchTabValue | null = null;
    private _manageBranchId: string | null = null;

    private _chatMode: ChatType = ChatType.EDIT;

    constructor() {
        makeAutoObservable(this);
    }

    set canvasScrolling(value: boolean) {
        this._canvasScrolling = value;
        this.resetCanvasScrolling();
    }

    get hotkeysOpen() {
        return this._hotkeysOpen;
    }

    set hotkeysOpen(value: boolean) {
        this._hotkeysOpen = value;
    }

    get publishOpen() {
        return this._publishOpen;
    }

    set publishOpen(value: boolean) {
        this._publishOpen = value;
    }

    get leftPanelLocked() {
        return this._leftPanelLocked;
    }

    set leftPanelLocked(value: boolean) {
        this._leftPanelLocked = value;
    }

    get canvasPanning() {
        return this._canvasPanning;
    }

    set canvasPanning(value: boolean) {
        this._canvasPanning = value;
    }

    get isDragSelecting() {
        return this._isDragSelecting;
    }

    set isDragSelecting(value: boolean) {
        this._isDragSelecting = value;
    }

    get editorMode() {
        return this._editorMode;
    }

    set editorMode(value: EditorMode) {
        this._editorMode = value;
    }

    get insertMode() {
        return this._insertMode;
    }

    set insertMode(value: InsertMode | null) {
        this._insertMode = value;
    }

    get leftPanelTab() {
        return this._leftPanelTab;
    }

    set leftPanelTab(value: LeftPanelTabValue | null) {
        this._leftPanelTab = value;
    }

    get brandTab() {
        return this._brandTab;
    }

    set brandTab(value: BrandTabValue | null) {
        this._brandTab = value;
    }

    get branchTab() {
        return this._branchTab;
    }

    set branchTab(value: BranchTabValue | null) {
        this._branchTab = value;
    }

    get manageBranchId() {
        return this._manageBranchId;
    }

    set manageBranchId(value: string | null) {
        this._manageBranchId = value;
    }

    get chatMode() {
        return this._chatMode;
    }

    set chatMode(value: ChatType) {
        this._chatMode = value;
    }

    get shouldHideOverlay() {
        return this._canvasScrolling || this.canvasPanning
    }

    private resetCanvasScrolling() {
        this.resetCanvasScrollingDebounced();
    }

    private resetCanvasScrollingDebounced = debounce(() => {
        this.canvasScrolling = false;
    }, 150);

    clear() {
        this.hotkeysOpen = false;
        this.publishOpen = false;
        this.branchTab = null;
        this.manageBranchId = null;
        this.resetCanvasScrollingDebounced.cancel();
    }
}
