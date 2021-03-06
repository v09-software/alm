import {TypedEvent} from "../../common/events";
import {createMapByKey, debounce, selectMany} from "../../common/utils";
import equal = require('deep-equal');

// What we use to identify a unique error
const errorKey = (error:CodeError)=>`${error.from.line}:${error.from.ch}:${error.message}`;

/**
 * Maintains the list of errors that have been encountered,
 * and notifies anyone who is concerned of updated values
 */
export class ErrorsCache {

    /**
     * For a lazy view of the current state. Note: this is throttled + limited for performance
     */
    public errorsUpdated = new TypedEvent<LimitedErrorsUpdate>();

    /**
     * Event that can be wired up to sync one error cache with another
     */
    public errorsDelta = new TypedEvent<ErrorCacheDelta>();

    /**
     * You can wire up an errors Delta from one cache to this one.
     */
    public applyDelta = (delta:ErrorCacheDelta) => {
        // Added:
        Object.keys(delta.added).forEach(fp=>{
            if (!this._errorsByFilePath[fp]) this._errorsByFilePath[fp] = delta.added[fp];
            else this._errorsByFilePath[fp] = this._errorsByFilePath[fp].concat(delta.added[fp]);
        });
        // Removed:
        Object.keys(delta.removed).forEach(fp => {
            const removedErrorsMap = createMapByKey(delta.removed[fp], errorKey);
            this._errorsByFilePath[fp] = (this._errorsByFilePath[fp] || []).filter(e => !removedErrorsMap[errorKey(e)]);
        });
        this.sendErrors();
    }


    /**
     *  DELTA MAINTAINANCE
     */
    private lastErrorsByFilePath: ErrorsByFilePath = {};


    /**
     * current errors
     */
    private _errorsByFilePath: ErrorsByFilePath = {};

    /**
     * debounced as constantly sending errors quickly degrades the web experience
     */
    private sendErrors = debounce(() => {
        this.errorsUpdated.emit(this.getErrorsLimited());

        // Create a delta
        const oldErrorsByFilePath = this.lastErrorsByFilePath;
        const newErrorsByFilePath = this._errorsByFilePath;
        const delta: ErrorCacheDelta = {
            added:{},
            removed:{}
        };

        // Added:
        Object.keys(newErrorsByFilePath).forEach((filePath)=>{
            const newErrors = newErrorsByFilePath[filePath]
            // All new
            if (!oldErrorsByFilePath[filePath]) {
                delta.added[filePath] = newErrors;
            }
            // Else diff
            else {
                const oldErrors = oldErrorsByFilePath[filePath];
                const oldErrorMap = createMapByKey(oldErrors,errorKey);

                newErrors.forEach(ne=>{
                    const newErrorKey = errorKey(ne);
                    if (!oldErrorMap[newErrorKey]) {
                        if (!delta.added[filePath]) delta.added[filePath] = [];
                        delta.added[filePath].push(ne);
                    }
                });
            }
        });

        // Removed:
        Object.keys(oldErrorsByFilePath).forEach((filePath)=>{
            const oldErrors = oldErrorsByFilePath[filePath]
            // All gone
            if (!newErrorsByFilePath[filePath]) {
                delta.removed[filePath] = oldErrors;
            }
            // Else diff
            else {
                const newErrors = newErrorsByFilePath[filePath];
                const newErrorMap = createMapByKey(newErrors,errorKey);

                oldErrors.forEach(oe=>{
                    const oldErrorKey = errorKey(oe);
                    if (!newErrorMap[oldErrorKey]) {
                        if (!delta.removed[filePath]) delta.removed[filePath] = [];
                        delta.removed[filePath].push(oe);
                    }
                });
            }
        });

        // Send out the delta
        this.errorsDelta.emit(delta);

        // Preserve for future delta
        this.lastErrorsByFilePath = {};
        Object.keys(this._errorsByFilePath).map(fp => this.lastErrorsByFilePath[fp] = this._errorsByFilePath[fp]);
    }, 250);

    /** The pased errors are considered *the only current* errors for the filePath */
    public setErrorsByFilePaths = (filePaths: string[], errors: CodeError[]) => {
        let somethingNew = false;

        // For all found errors add them
        let errorsByFile = createMapByKey(errors, (e) => e.filePath);
        for (let filePath in errorsByFile) {
            if (!equal(this._errorsByFilePath[filePath], errorsByFile[filePath])) {
                somethingNew = true;
                this._errorsByFilePath[filePath] = errorsByFile[filePath];
            }
        }

        // For not found errors clear them
        for (let filePath of filePaths) {
            if (!errorsByFile[filePath] && (this._errorsByFilePath[filePath] && this._errorsByFilePath[filePath].length)) {
                somethingNew = true;
                this._errorsByFilePath[filePath] = [];
            }
        }

        if (somethingNew) {
            this.sendErrors();
        }
    }

    /**
     * * Sending massive error lists *constantly* can quickly degrade the web experience
     * - only send 50 errors per file or 200+ errors total
     */
    public getErrorsLimited = (): LimitedErrorsUpdate => {
        let limitedCopy: ErrorsByFilePath = {};
        let total = 0;
        for (let filePath in this._errorsByFilePath) {
            let errors = this._errorsByFilePath[filePath];
            if (errors.length > 50) errors = errors.slice(0, 50);
            limitedCopy[filePath] = errors;
            total += errors.length;
            if (total > 200) break;
        }
        const totalCount = Object.keys(this._errorsByFilePath)
            .map(x => this._errorsByFilePath[x].length)
            .reduce((acc, i) => acc + i, 0);
        return { errorsByFilePath: limitedCopy, totalCount, syncCount: total, tooMany: total !== totalCount };
    }

    /**
     * Clear all errors. Resets the cache.
     */
    public clearErrors = () => {
        this._errorsByFilePath = {};
        this.sendErrors();
    }

    /** Utility to provide a semantic name to *clearing errors*  */
    public clearErrorsForFilePath = (filePath: string) => {
        this._errorsByFilePath[filePath] = [];
        this.sendErrors();
    }

    /** Utility to query */
    public getErrorsForFilePath = (filePath: string) => {
        return this._errorsByFilePath[filePath] || [];
    }
}
