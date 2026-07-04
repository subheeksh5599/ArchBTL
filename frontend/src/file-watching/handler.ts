/**
 * File watching and change detection handler.
 * Handles debouncing, live indicators, and analysis scheduling.
 */

import * as vscode from 'vscode';
import { CacheManager } from '../cache';
import { WebviewManager } from '../webview';
import { MetadataBatcher, buildMetadataContext } from '../metadata-batcher';
import { performLocalUpdate } from './local-update';
import { withHttpEdges } from '../analysis/helpers';
import {
    clearPendingChange, setPendingChange, deletePendingChange,
    getCachedCallGraph,
    clearActivelyEditing, setActivelyEditing,
    clearChangedFunctions, setChangedFunctions
} from '../analysis/state';

/**
 * Context needed for file analysis scheduling.
 */
export interface FileWatchingContext {
    cache: CacheManager;
    webview: WebviewManager;
    log: (msg: string) => void;
    metadataBatcher: MetadataBatcher;
}

/**
 * Configuration for file watching.
 */
export interface FileWatchingConfig {
    debounceMs: number;
    activeToChangedMs: number;
}

/**
 * Schedule file analysis with debouncing.
 * Tries instant local update first, falls back to LLM analysis.
 *
 * @param ctx - Context with cache, webview, log, and metadataBatcher
 * @param uri - URI of the file that changed
 * @param source - Source of the change (watcher, save, create)
 * @param config - Debounce and timing configuration
 * @param fallbackAnalyze - Callback for full LLM analysis fallback
 */
export async function scheduleFileAnalysis(
    ctx: FileWatchingContext,
    uri: vscode.Uri,
    source: string,
    config: FileWatchingConfig,
    fallbackAnalyze: (uri: vscode.Uri) => Promise<void>
): Promise<void> {
    const { cache, webview, log, metadataBatcher } = ctx;
    const filePath = uri.fsPath;

    // Ignore compiled output files (they change when source files compile)
    if (filePath.includes('/out/') || filePath.includes('\\out\\')) {
        return;
    }

    // Ignore hidden directories (dotfiles like .vscode-dev, .git, etc.)
    if (/[/\\]\./.test(filePath)) {
        return;
    }

    const relativePath = vscode.workspace.asRelativePath(filePath);

    // ═══════════════════════════════════════════════════════════════════════════
    // PHASE 1: INSTANT VISUAL FEEDBACK (T=0ms)
    // Show "file being edited" indicator IMMEDIATELY before debounce.
    // This makes vibecoding feel responsive while analysis happens in background.
    // ═══════════════════════════════════════════════════════════════════════════
    const cachedGraph = cache.getCachedGraphSync();
    const fileHasNodesInGraph = cachedGraph?.nodes.some(n => n.source?.file === relativePath);

    if (fileHasNodesInGraph) {
        // Clear any existing transition timer for this file
        clearActivelyEditing(filePath);

        // Instant feedback: highlight ALL nodes from this file
        // (We don't know which specific functions changed yet - that comes after analysis)
        webview.notifyFileStateChange([{
            filePath: relativePath,
            state: 'active'
            // No functions = highlights all nodes from file
        }]);
    }

    // Clear existing debounce timeout for this file
    clearPendingChange(filePath);

    // Use shorter debounce for file creation (fast feedback for AI scaffolding)
    const debounceMs = source === 'create' ? 100 : config.debounceMs;

    // Schedule new analysis after debounce period
    const timeout = setTimeout(async () => {
        deletePendingChange(filePath);
        log(`File changed (${source}): ${filePath}`);

        // Try instant local update first (handles both cached and new LLM files)
        const localResult = await performLocalUpdate({ cache, log }, uri);

        if (localResult) {
            const hasStructuralChanges = localResult.nodesAdded.length > 0 || localResult.nodesRemoved.length > 0 ||
                localResult.edgesAdded > 0 || localResult.edgesRemoved > 0;

            // Send graph update only when structure actually changed
            if (hasStructuralChanges) {
                webview.updateGraph(withHttpEdges(localResult.graph, log)!, localResult.needsMetadata);
                log(`Graph updated locally (instant) via tree-sitter`);

                // Queue for metadata if new nodes need labels
                if (localResult.needsMetadata.length > 0) {
                    const newCallGraph = getCachedCallGraph(filePath);
                    const context = buildMetadataContext(relativePath, cache, newCallGraph);
                    if (context) {
                        metadataBatcher.queueFile(relativePath, context);
                        log(`Queued ${relativePath} for metadata batch (${context.functions.length} functions)`);
                    }
                }
            }

            // ═══════════════════════════════════════════════════════════════════
            // PHASE 2: REFINED FEEDBACK (after debounce + analysis)
            // Now we know WHICH specific functions changed. Refine the highlighting
            // to only those functions (others lose their highlight).
            // ═══════════════════════════════════════════════════════════════════
            const fileHasNodes = localResult.graph.nodes.some(n =>
                n.source?.file === relativePath
            );

            if (fileHasNodes) {
                // Clear existing transition timer
                clearActivelyEditing(filePath);

                // Refine: send active state with specific changed functions
                // This will UN-highlight nodes not in the changedFunctions list
                webview.notifyFileStateChange([{
                    filePath: relativePath,
                    functions: localResult.changedFunctions,
                    state: 'active'
                }]);

                // Set timer to transition to "changed" state after inactivity
                const transitionTimer = setTimeout(() => {
                    clearActivelyEditing(filePath);
                    setChangedFunctions(filePath, localResult.changedFunctions);
                    webview.notifyFileStateChange([{
                        filePath: relativePath,
                        functions: localResult.changedFunctions,
                        state: 'changed'
                    }]);
                }, config.activeToChangedMs);

                setActivelyEditing(filePath, {
                    timer: transitionTimer,
                    functions: localResult.changedFunctions
                });
            }
        } else {
            // Local update returned null - check if file was previously analyzed
            const isCached = await cache.isFileCached(filePath);
            if (isCached) {
                // File was analyzed before - fall back to LLM analysis
                log(`Falling back to full analysis: ${filePath}`);
                webview.showLoading('Detecting changes...');
                await fallbackAnalyze(uri);

                // Clear file change indicator after LLM analysis
                clearChangedFunctions(filePath);
                webview.notifyFileStateChange([{ filePath: relativePath, state: 'unchanged' }]);
            }
            // If not cached, ignore - not an LLM file worth tracking
        }
    }, debounceMs);

    setPendingChange(filePath, timeout);
}
