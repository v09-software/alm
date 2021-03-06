/**
 * Manages active project.
 * Also pushes errors out to clients + keeps the language service in sync
 */

import utils = require("../../../common/utils");
import * as json from "../../../common/json";
import * as tsconfig from "./core/tsconfig";
import * as project from "./core/project";
import * as types from "../../../common/types";
import {errorsCache} from "./cache/tsErrorsCache";
const {setErrorsByFilePaths, clearErrors, clearErrorsForFilePath} = errorsCache;
import {diagnosticToCodeError} from "./modules/building";
import {makeBlandError} from "../../../common/utils";
import {TypedEvent} from "../../../common/events";
import equal = require('deep-equal');
import * as chalk from "chalk";
import {AvailableProjectConfig} from "../../../common/types";
import * as fsu from "../../utils/fsu";

import {master as masterType} from "./projectServiceContract";
let master: typeof masterType;
export function setMaster(m: typeof masterType) {
    master = m;
}

/** The active project name */
let activeProjectConfigDetails: types.ProjectDataLoaded = null;
/** The currently active project */
let currentProject: project.Project = null;

/**
  * Changes the active project.
  * Clear any previously reported errors and recalculate the errors
  * This is what the user should call if they want to manually sync as well
  */
export function setActiveProjectConfigDetails(projectData: types.ProjectDataLoaded) {
    initialSync = true;
    activeProjectConfigDetails = projectData;
    currentProject = new project.Project(projectData);

    /** Refresh them errors */
    clearErrors();
    refreshAllProjectDiagnostics();

    /** Return active project for any chaining */
    return currentProject;
}

function sync() {
    // We need to request new data load from master
    master.sync({});
}

/**
 * File changing on disk
 */
export function fileEdited(evt: { filePath: string, edit: CodeEdit }) {
    let proj = GetProject.ifCurrent(evt.filePath)
    if (proj) {
        proj.languageServiceHost.applyCodeEdit(evt.filePath, evt.edit.from, evt.edit.to, evt.edit.newText);
        // For debugging
        // console.log(proj.languageService.getSourceFile(evt.filePath).text);

        // update errors for this file if its *heuristically* small
        if (evt.edit.from.line < 1000) {
            refreshFileDiagnostics(evt.filePath);
        }

        // After a while update all project diagnostics as well
        refreshAllProjectDiagnosticsDebounced();
    }
}
export function fileChangedOnDisk(evt: { filePath: string; contents: string }) {
    // Check if its a part of the current project .... if not ignore :)
    let proj = GetProject.ifCurrent(evt.filePath)
    if (proj) {
        proj.languageServiceHost.setContents(evt.filePath, evt.contents);
        refreshAllProjectDiagnosticsDebounced();
    }
}

/**
 * If there hasn't been a request for a while then we refresh
 * As its a bit slow to get *all* the errors
 */
let initialSync = false;
const refreshAllProjectDiagnostics = () => {
    if (currentProject) {
        const timer = utils.timer();
        if (initialSync) {
            console.error(`[TSC] Started Initial Error Analysis: ${currentProject.configFile.projectFilePath}`);
        }
        else {
            console.log(`[TSC] Incremental Error Analysis ${currentProject.configFile.projectFilePath}`);
            console.time('[TSC] Incremental Error Analysis');
        }

        // Get all the errors from the project files:
        let diagnostics = currentProject.getDiagnostics();
        let errors = diagnostics.map(diagnosticToCodeError);
        let filePaths = currentProject.getFilePaths();

        setErrorsByFilePaths(filePaths, errors);


        console.error('[TSC] Error Analysis Duration:', timer.seconds);
        console.log(`[TSC] FileCount: ${filePaths.length} `, errors.length? chalk.red(`Errors: ${errors.length}`): chalk.green(`Errors: ${errors.length}`));
        initialSync = false;
    }
};
const refreshAllProjectDiagnosticsDebounced = utils.debounce(refreshAllProjectDiagnostics, 3000);

/**
 * Constantly streaming this is slow for large files so this is debounced as well
 */
const refreshFileDiagnostics = utils.debounce((filePath:string) => {
    let proj = GetProject.ifCurrent(filePath)
    if (proj) {
        let diagnostics = proj.getDiagnosticsForFile(filePath);
        let errors = diagnostics.map(diagnosticToCodeError);
        setErrorsByFilePaths([filePath], errors);
    }
}, 1000);

/**
 * Utility functions to convert a `configFile` to a `project`
 */
import path = require("path");

/** Get project functions */
export namespace GetProject {
    /**
     * Utility function used all the time
     */
    export function ifCurrent(filePath: string): project.Project | undefined {
        if (currentProject && currentProject.includesSourceFile(filePath)) {
            return currentProject;
        }
    }

    /**
     * Sometimes (e.g in the projectService) you want to error out
     * because these functions should not be called if there is no active project
     */
    export function ifCurrentOrErrorOut(filePath: string): project.Project {
        let proj = ifCurrent(filePath);

        if (!proj) {
            console.error(types.errors.CALLED_WHEN_NO_ACTIVE_PROJECT_FOR_FILE_PATH, filePath);
            throw new Error(types.errors.CALLED_WHEN_NO_ACTIVE_PROJECT_FOR_FILE_PATH);
        }

        return proj;
    }

    /**
     * Get current if any OR throw
     */
    export function getCurrentIfAny(): project.Project {
        if (!currentProject) {
            console.error(types.errors.CALLED_WHEN_NO_ACTIVE_PROJECT_GLOBAL);
            throw new Error(types.errors.CALLED_WHEN_NO_ACTIVE_PROJECT_GLOBAL);
        }
        return currentProject;
    }
}
