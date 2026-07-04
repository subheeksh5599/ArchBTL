// Main entry point for webview client
import './types';
import * as state from './state';
import { setupSVG } from './setup';
import { layoutWorkflows } from './layout';
import { renderGroups } from './groups';
import { renderCollapsedComponents } from './components';
import { renderEdges, updateEdgePaths, updateEdgeLabels } from './edges';
import { renderNodes } from './nodes';
import { dragstarted, dragged, dragended } from './drag';
import { setupControls, fitToScreen, formatGraph } from './controls';
import { renderMinimap, setupMinimapZoomListener } from './minimap';
import { setupClosePanel, closePanel } from './panel';
import { setupMessageHandler } from './messages';
import { updateGroupVisibility, updateComponentVisibility } from './visibility';
import { detectWorkflowGroups, updateSnapshotStats } from './workflow-detection';
import { setupDirectory } from './directory';
import { notifications } from './notifications';
import { initTutorial } from './tutorial';
import { setupExportButton, addWorkflowExportButtons } from './export';

declare const d3: any;
declare function acquireVsCodeApi(): any;

// Initialize on load
(async function init() {
    // Get VSCode API
    const vscode = acquireVsCodeApi();

    // Get API URL from window (injected by extension host)
    const apiUrl = (window as any).__API_URL__ || 'https://archbtl.onrender.com';

    // Get graph data from window
    const graphData = (window as any).__GRAPH_DATA__;

    if (!graphData) {
        console.error('No graph data found');
        return;
    }

    // Detect workflow groups
    const groups = detectWorkflowGroups(graphData);

    // Setup SVG
    const { svg, g, zoom, defs } = setupSVG();

    // Initialize state
    state.initState(vscode, svg, g, zoom);
    state.setGraphData(graphData);
    state.setWorkflowGroups(groups);

    // Layout workflows using ELK (async)
    await layoutWorkflows(defs);

    // Render groups (before edges/nodes for z-index)
    renderGroups();

    // Render edges
    renderEdges();

    // Render nodes
    renderNodes(dragstarted, dragged, dragended);

    // Render collapsed components (within workflows)
    renderCollapsedComponents(updateComponentVisibility);

    // Setup controls (zoom, format, refresh, export)
    setupControls();
    setupExportButton();
    setupClosePanel();
    setupDirectory();

    // Setup onboarding tutorial (shows on first launch)
    initTutorial();

    // Setup message handler
    setupMessageHandler();

    // Show loading notification if analysis is in progress
    const loadingState = (window as any).__LOADING_STATE__;
    if (loadingState) {
        notifications.show({ type: 'loading', message: 'Analyzing...' });
    }

    // Signal extension that webview is ready to receive messages
    vscode.postMessage({ command: 'webviewReady' });

    // Setup minimap zoom listener
    setupMinimapZoomListener();

    // Close panel when clicking on SVG background
    svg.on('click', function(event: any) {
        const target = event.target;
        if (target.tagName === 'svg' || (target.tagName === 'rect' && target.classList.contains('pegboard-bg'))) {
            closePanel();
        }
    });

    // Initial view - fit entire graph to screen
    setTimeout(() => {
        formatGraph(updateGroupVisibility);
        renderMinimap();
        fitToScreen();
        updateGroupVisibility();
        updateSnapshotStats(state.workflowGroups, state.currentGraphData);
        addWorkflowExportButtons();
        updateEdgePaths();
        updateEdgeLabels();
        requestAnimationFrame(() => {
            updateEdgePaths();
            updateEdgeLabels();
        });
    }, 50);

    // Re-render minimap on window resize (debounced)
    let resizeTimeout: ReturnType<typeof setTimeout> | null = null;
    window.addEventListener('resize', () => {
        if (resizeTimeout) clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
            renderMinimap();
        }, 150);
    });

    // Semantic search via BTL embeddings
    const searchInput = document.getElementById('search-input') as HTMLInputElement | null;
    const searchResultsEl = document.getElementById('search-results');
    let searchTimeout: ReturnType<typeof setTimeout> | null = null;

    function renderSearchResults(results: any[]) {
        if (!searchResultsEl) return;
        if (!results.length) { searchResultsEl.style.display = 'none'; return; }
        searchResultsEl.style.display = 'block';
        searchResultsEl.innerHTML = results.map((r: any) =>
            '<div class="search-result-item" data-file="' + (r.file || '') + '" data-line="' + (r.line || 1) + '">' +
            '<div class="sr-label">' + (r.label || '') + '</div>' +
            '<div class="sr-meta">' + (r.node_type || '') + ' &middot; ' + ((r.similarity || 0) * 100).toFixed(0) + '% match</div>' +
            '<div class="sr-file">' + (r.file || '') + ':' + (r.line || 1) + '</div>' +
            '</div>'
        ).join('');
        searchResultsEl.querySelectorAll('.search-result-item').forEach(function(el) {
            el.addEventListener('click', function() {
                var f = (el as HTMLElement).dataset.file || '';
                var l = parseInt((el as HTMLElement).dataset.line || '1');
                vscode.postMessage({ command: 'openFile', file: f, line: l });
                if (searchResultsEl) { searchResultsEl.style.display = 'none'; searchResultsEl.innerHTML = ''; }
                if (searchInput) searchInput.value = '';
            });
        });
    }

    if (searchInput) {
        searchInput.addEventListener('input', function() {
            if (searchTimeout) clearTimeout(searchTimeout);
            var q = searchInput.value.trim();
            if (!q) { if (searchResultsEl) { searchResultsEl.style.display = 'none'; searchResultsEl.innerHTML = ''; } return; }
            searchTimeout = setTimeout(function() {
                fetch(apiUrl + '/search', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ query: q, limit: 8 }),
                }).then(function(r) { return r.json(); }).then(function(d) {
                    renderSearchResults(d.results || []);
                }).catch(function() {});
            }, 400);
        });
    }

    document.addEventListener('click', function(e) {
        if (searchResultsEl && searchInput && !searchInput.contains(e.target as Node) && !searchResultsEl.contains(e.target as Node)) {
            searchResultsEl.style.display = 'none';
        }
    });
})();
