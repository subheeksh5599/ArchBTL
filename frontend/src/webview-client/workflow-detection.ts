// Workflow detection and grouping logic
import { WorkflowGraph, WorkflowGroup, WorkflowComponent, WorkflowNode, WorkflowEdge } from './types';
import { colorFromString } from './utils';

/**
 * Find connected components within a set of node IDs
 * Returns array of arrays, each inner array is a connected component
 */
function findConnectedComponents(
    nodeIds: string[],
    incomingEdges: Map<string, WorkflowEdge[]>,
    outgoingEdges: Map<string, WorkflowEdge[]>
): string[][] {
    const nodeSet = new Set(nodeIds);
    const visited = new Set<string>();
    const components: string[][] = [];

    for (const startId of nodeIds) {
        if (visited.has(startId)) continue;

        // BFS to find all nodes in this component
        const component: string[] = [];
        const queue = [startId];
        visited.add(startId);

        while (queue.length > 0) {
            const currentId = queue.shift()!;
            component.push(currentId);

            // Check outgoing edges (within the workflow)
            const outgoing = outgoingEdges.get(currentId) || [];
            for (const edge of outgoing) {
                if (nodeSet.has(edge.target) && !visited.has(edge.target)) {
                    visited.add(edge.target);
                    queue.push(edge.target);
                }
            }

            // Check incoming edges (within the workflow)
            const incoming = incomingEdges.get(currentId) || [];
            for (const edge of incoming) {
                if (nodeSet.has(edge.source) && !visited.has(edge.source)) {
                    visited.add(edge.source);
                    queue.push(edge.source);
                }
            }
        }

        components.push(component);
    }

    return components;
}

/**
 * Find entry nodes for a component (nodes with no incoming edges from within the component)
 */
function findEntryNodes(
    componentNodeIds: string[],
    incomingEdges: Map<string, WorkflowEdge[]>
): string[] {
    const componentSet = new Set(componentNodeIds);
    const entryNodes: string[] = [];

    for (const nodeId of componentNodeIds) {
        const incoming = incomingEdges.get(nodeId) || [];
        const hasInternalIncoming = incoming.some(e => componentSet.has(e.source));
        if (!hasInternalIncoming) {
            entryNodes.push(nodeId);
        }
    }

    return entryNodes;
}

/**
 * Create a synthetic title node for a workflow
 */
function createTitleNode(workflowId: string, workflowName: string): WorkflowNode {
    return {
        id: `__title_${workflowId}`,
        label: workflowName,
        type: 'workflow-title'
    };
}

/**
 * Create edges from title node to entry nodes
 */
function createTitleEdges(titleNodeId: string, entryNodeIds: string[]): WorkflowEdge[] {
    return entryNodeIds.map(targetId => ({
        source: titleNodeId,
        target: targetId,
        label: ''
    }));
}

/**
 * Detect workflow groups from graph data
 */
export function detectWorkflowGroups(data: WorkflowGraph): WorkflowGroup[] {
    if (data.nodes.length < 5) {
        // Don't group very small graphs
        return [];
    }

    // Prefer backend-provided workflow metadata if available
    if (data.workflows && data.workflows.length > 0) {
        const groups: WorkflowGroup[] = [];

        // Build adjacency lists for finding connected components and entry nodes
        const incomingEdges = new Map<string, WorkflowEdge[]>();
        const outgoingEdges = new Map<string, WorkflowEdge[]>();

        data.nodes.forEach(n => {
            incomingEdges.set(n.id, []);
            outgoingEdges.set(n.id, []);
        });

        data.edges.forEach(e => {
            if (incomingEdges.has(e.target)) {
                incomingEdges.get(e.target)!.push(e);
            }
            if (outgoingEdges.has(e.source)) {
                outgoingEdges.get(e.source)!.push(e);
            }
        });

        // Group workflows by ID first to handle duplicates from multi-file analysis
        const workflowsByBase = new Map<string, { id: string; name: string; description?: string; nodeIds: string[] }>();
        data.workflows.forEach((workflow, idx) => {
            const baseId = workflow.id || `group_${idx}`;

            if (!workflowsByBase.has(baseId)) {
                workflowsByBase.set(baseId, {
                    id: baseId,
                    name: workflow.name,
                    description: workflow.description,
                    nodeIds: []
                });
            }

            // Merge node IDs
            const merged = workflowsByBase.get(baseId)!;
            workflow.nodeIds.forEach(nodeId => {
                if (!merged.nodeIds.includes(nodeId)) {
                    merged.nodeIds.push(nodeId);
                }
            });
        });

        // Build node→workflow lookup for orphan adoption
        const nodeToWorkflow = new Map<string, string>();
        workflowsByBase.forEach((wf, wfId) => {
            wf.nodeIds.forEach(nodeId => nodeToWorkflow.set(nodeId, wfId));
        });

        // Union-find for merging workflows
        const workflowParent = new Map<string, string>();
        workflowsByBase.forEach((_, wfId) => workflowParent.set(wfId, wfId));

        function findRoot(id: string): string {
            if (workflowParent.get(id) !== id) {
                workflowParent.set(id, findRoot(workflowParent.get(id)!));
            }
            return workflowParent.get(id)!;
        }

        function unionWorkflows(wf1: string, wf2: string): void {
            const root1 = findRoot(wf1);
            const root2 = findRoot(wf2);
            if (root1 !== root2) {
                workflowParent.set(root2, root1);
            }
        }

        // Helper to detect HTTP edge labels (e.g., "GET /api", "POST /analyze")
        const isHttpEdge = (label?: string) => label && /^\s*\[?\s*(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s/i.test(label);

        // PASS 1: Adopt orphan nodes iteratively until no more changes
        // This must happen BEFORE HTTP merge check, otherwise stub nodes won't have a workflow
        // We iterate because edge A→B might not adopt if neither has a workflow,
        // but edge B→C might give B a workflow, then we need to re-check A→B
        let totalAdopted = 0;
        let iteration = 0;
        let adoptedThisRound: number;
        do {
            adoptedThisRound = 0;
            iteration++;
            data.edges.forEach(edge => {
                const sourceWf = nodeToWorkflow.get(edge.source);
                const targetWf = nodeToWorkflow.get(edge.target);

                // Orphan adoption: add unassigned nodes to nearby workflow
                if (sourceWf && !targetWf) {
                    // Target node not in any workflow - add it to source's workflow
                    const rootWf = findRoot(sourceWf);
                    const wf = workflowsByBase.get(rootWf);
                    if (wf && !wf.nodeIds.includes(edge.target)) {
                        wf.nodeIds.push(edge.target);
                        nodeToWorkflow.set(edge.target, rootWf);
                        adoptedThisRound++;
                    }
                }
                if (targetWf && !sourceWf) {
                    // Source node not in any workflow - add it to target's workflow
                    const rootWf = findRoot(targetWf);
                    const wf = workflowsByBase.get(rootWf);
                    if (wf && !wf.nodeIds.includes(edge.source)) {
                        wf.nodeIds.push(edge.source);
                        nodeToWorkflow.set(edge.source, rootWf);
                        adoptedThisRound++;
                    }
                }
            });
            totalAdopted += adoptedThisRound;
        } while (adoptedThisRound > 0 && iteration < 10); // Cap iterations to prevent infinite loops

        // PASS 2: Merge workflows connected by HTTP edges (now that orphans are adopted)
        let mergeCount = 0;
        data.edges.forEach(edge => {
            if (!isHttpEdge(edge.label)) return;

            const sourceWf = nodeToWorkflow.get(edge.source);
            const targetWf = nodeToWorkflow.get(edge.target);

            // HTTP edges should merge their workflows so ELK can route them properly
            if (sourceWf && targetWf && sourceWf !== targetWf) {
                unionWorkflows(sourceWf, targetWf);
                mergeCount++;
            }
        });

        // Merge workflows based on union-find results
        const mergedWorkflows = new Map<string, { id: string; name: string; description?: string; nodeIds: string[] }>();
        workflowsByBase.forEach((wf, wfId) => {
            const rootId = findRoot(wfId);
            if (!mergedWorkflows.has(rootId)) {
                const rootWf = workflowsByBase.get(rootId)!;
                mergedWorkflows.set(rootId, {
                    id: rootId,
                    name: rootWf.name,
                    description: rootWf.description,
                    nodeIds: [...rootWf.nodeIds]
                });
            }
            if (wfId !== rootId) {
                // Merge this workflow's nodes into the root
                const merged = mergedWorkflows.get(rootId)!;
                wf.nodeIds.forEach(nodeId => {
                    if (!merged.nodeIds.includes(nodeId)) {
                        merged.nodeIds.push(nodeId);
                    }
                });
            }
        });

        // Track title nodes and edges created during this call
        const createdTitleNodes: WorkflowNode[] = [];
        const createdTitleEdges: WorkflowEdge[] = [];

        // Process each merged workflow (keep disconnected components together)
        mergedWorkflows.forEach((workflow, baseId) => {
            // Get actual node data
            const workflowNodes = workflow.nodeIds.map(id =>
                data.nodes.find(n => n.id === id)
            ).filter(n => n);

            // Find LLM nodes for model names
            const llmNodes = workflowNodes.filter(n => n?.type === 'llm');
            const modelNames = llmNodes.map(n => n?.model).filter((m): m is string => !!m);
            const llmProviders = modelNames.length > 0
                ? [...new Set(modelNames)].join(', ')
                : 'LLM';

            // Find connected components and create title node
            const connectedComponents = findConnectedComponents(
                workflow.nodeIds,
                incomingEdges,
                outgoingEdges
            );

            // Create title node for the workflow
            const titleNode = createTitleNode(baseId, workflow.name);
            const titleNodeId = titleNode.id;

            // Find entry nodes across all components
            let entryNodeIds: string[] = [];
            connectedComponents.forEach(component => {
                const componentEntries = findEntryNodes(component, incomingEdges);
                entryNodeIds.push(...componentEntries);
            });

            // Fallback: if no entry nodes found (circular workflow), use first node from each component
            if (entryNodeIds.length === 0 && connectedComponents.length > 0) {
                entryNodeIds = connectedComponents.map(comp => comp[0]).filter(Boolean);
            }

            // Ultimate fallback: connect to first workflow node
            if (entryNodeIds.length === 0 && workflow.nodeIds.length > 0) {
                entryNodeIds = [workflow.nodeIds[0]];
            }

            // Create edges from title to entry nodes
            const titleEdges = createTitleEdges(titleNodeId, entryNodeIds);

            // Track title node and edges (will be added to finalNodes/finalEdges later)
            createdTitleNodes.push(titleNode);
            createdTitleEdges.push(...titleEdges);

            // Update adjacency lists for the new title node
            incomingEdges.set(titleNodeId, []);
            outgoingEdges.set(titleNodeId, titleEdges);
            titleEdges.forEach(edge => {
                incomingEdges.get(edge.target)?.push(edge);
            });

            // Include title node in the workflow
            workflow.nodeIds.push(titleNodeId);

            // Parse components from workflow metadata
            const workflowComponents: WorkflowComponent[] = [];
            const originalWorkflow = data.workflows.find(w => w.id === baseId || w.id === workflow.id);
            if (originalWorkflow?.components) {
                originalWorkflow.components.forEach(comp => {
                    const compNodesInWorkflow = comp.nodeIds.filter(id => workflow.nodeIds.includes(id));
                    if (compNodesInWorkflow.length >= 3) {
                        workflowComponents.push({
                            id: comp.id,
                            name: comp.name,
                            description: comp.description,
                            nodes: comp.nodeIds,
                            collapsed: true,
                            color: colorFromString(comp.id),
                            workflowId: baseId
                        });
                    }
                });
            }

            groups.push({
                id: baseId,
                name: workflow.name,
                description: workflow.description,
                nodes: workflow.nodeIds,
                llmProviders,
                collapsed: false,
                color: colorFromString(baseId),
                level: 1,
                components: workflowComponents
            });
        });

        // ===== Replace cross-workflow edges with reference nodes =====
        // IMPORTANT: Do NOT mutate the input data - work on copies to avoid
        // corrupting state on repeated calls

        // Build final node→workflow lookup (exclude any existing reference/title nodes from previous calls)
        const nodeToWorkflowFinal = new Map<string, string>();
        groups.forEach(g => {
            // Filter out any synthetic node IDs that might have leaked in
            const realNodes = g.nodes.filter(nid =>
                !nid.startsWith('__ref_') && !nid.startsWith('__title_')
            );
            realNodes.forEach(nid => nodeToWorkflowFinal.set(nid, g.id));
        });

        // Only process original nodes (not reference nodes or title nodes from previous calls)
        // Title nodes have type 'workflow-title', reference nodes have type 'reference'
        const originalNodes = data.nodes.filter(n =>
            n.type !== 'reference' && n.type !== 'workflow-title'
        );
        const nodeById = new Map(originalNodes.map(n => [n.id, n]));

        // Only process original edges (targets should be real node IDs, not __ref_ or __title_ IDs)
        // Also filter out edges from title nodes (they'll be recreated fresh)
        const originalEdges = data.edges.filter(e =>
            !e.target.startsWith('__ref_') &&
            !e.target.startsWith('__title_') &&
            !e.source.startsWith('__title_')
        );

        const keptEdges: WorkflowEdge[] = [];
        const referenceNodes = new Map<string, WorkflowNode>();

        // Track which external nodes need reference nodes in which workflows
        // Key: "targetNodeId_in_workflowId", Value: refId
        const refNodeNeeded = new Map<string, string>();

        // First pass: identify all cross-workflow edges and mark ref nodes needed
        for (const edge of originalEdges) {
            const sourceWf = nodeToWorkflowFinal.get(edge.source);
            const targetWf = nodeToWorkflowFinal.get(edge.target);

            if (sourceWf && targetWf && sourceWf !== targetWf) {
                const key = `${edge.target}_in_${sourceWf}`;
                if (!refNodeNeeded.has(key)) {
                    refNodeNeeded.set(key, `__ref_${key}`);
                }
            }
        }

        // Create reference nodes
        for (const [key, refId] of refNodeNeeded) {
            const [targetId, , sourceWf] = key.split('_in_');
            const targetNode = nodeById.get(targetId);
            if (!targetNode) continue;

            const targetWf = nodeToWorkflowFinal.get(targetId);
            const targetGroup = groups.find(g => g.id === targetWf);
            const validSource = targetNode.source?.file?.includes('.') ? targetNode.source : undefined;

            referenceNodes.set(refId, {
                id: refId,
                label: targetNode.label,
                type: 'reference' as any,
                source: validSource,
                _refTargetId: targetId,
                _refWorkflowId: targetWf,
                _refWorkflowName: targetGroup?.name || targetWf,
            } as any);
        }

        // Second pass: rewrite edges, replacing external node references with ref nodes
        for (const edge of originalEdges) {
            const sourceWf = nodeToWorkflowFinal.get(edge.source);
            const targetWf = nodeToWorkflowFinal.get(edge.target);

            // Check if source is an external node that has a ref in target's workflow
            const sourceRefKey = `${edge.source}_in_${targetWf}`;
            const sourceRefId = refNodeNeeded.get(sourceRefKey);

            // Check if target is an external node that has a ref in source's workflow
            const targetRefKey = `${edge.target}_in_${sourceWf}`;
            const targetRefId = refNodeNeeded.get(targetRefKey);

            if (sourceWf && targetWf && sourceWf !== targetWf) {
                // Cross-workflow edge: rewrite to use reference node
                keptEdges.push({
                    source: edge.source,
                    target: targetRefId || edge.target,
                    label: edge.label,
                });
            } else if (sourceWf && sourceWf === targetWf) {
                // Internal edge - keep as is
                keptEdges.push(edge);
            } else if (sourceRefId && targetWf) {
                // Source is external but has ref in target's workflow - rewrite source
                keptEdges.push({
                    source: sourceRefId,
                    target: edge.target,
                    label: edge.label,
                });
            } else {
                // Keep edge as-is
                keptEdges.push(edge);
            }
        }

        // Build final node and edge lists WITHOUT mutating input data
        // Include: original nodes + reference nodes + title nodes created this call
        const finalNodes = [...originalNodes, ...Array.from(referenceNodes.values()), ...createdTitleNodes];
        const finalEdges = [...keptEdges, ...createdTitleEdges];

        // Update groups to include reference nodes (create new arrays, don't mutate)
        groups.forEach(g => {
            const refNodesForGroup = Array.from(referenceNodes.entries())
                .filter(([refId, _]) => refId.endsWith(`_in_${g.id}`))
                .map(([refId, _]) => refId);
            // Filter out old synthetic nodes, keep real nodes + this call's title node + new ref nodes
            const titleNodeForGroup = `__title_${g.id}`;
            g.nodes = [
                ...g.nodes.filter(nid => !nid.startsWith('__ref_') && !nid.startsWith('__title_')),
                titleNodeForGroup,  // Add this workflow's title node
                ...refNodesForGroup
            ];
        });

        // Update adjacency lists for reference nodes and title nodes
        for (const [refId] of referenceNodes) {
            incomingEdges.set(refId, []);
            outgoingEdges.set(refId, []);
        }
        for (const node of createdTitleNodes) {
            incomingEdges.set(node.id, []);
            outgoingEdges.set(node.id, []);
        }
        for (const edge of finalEdges) {
            if (edge.source.startsWith('__ref_') || edge.source.startsWith('__title_')) {
                outgoingEdges.get(edge.source)?.push(edge);
            }
            if (edge.target.startsWith('__ref_') || edge.target.startsWith('__title_')) {
                incomingEdges.get(edge.target)?.push(edge);
            }
        }

        // Replace data arrays with our processed versions
        // Use splice to replace in-place rather than reassigning (maintains reference)
        data.nodes.length = 0;
        data.nodes.push(...finalNodes);
        data.edges.length = 0;
        data.edges.push(...finalEdges);

        groups.sort((a, b) => a.name.localeCompare(b.name));

        // Filter to only workflows with at least one LLM node
        // Workflows without LLM nodes should not be displayed
        const llmWorkflows = groups.filter(group => {
            const groupNodes = data.nodes.filter(n => group.nodes.includes(n.id));
            return groupNodes.some(n => n.type === 'llm');
        });

        return llmWorkflows;
    }

    // Fallback: Use client-side BFS grouping
    const groups: WorkflowGroup[] = [];
    const visited = new Set<string>();
    const incomingEdges = new Map<string, any[]>();
    const outgoingEdges = new Map<string, any[]>();

    data.nodes.forEach(n => {
        incomingEdges.set(n.id, []);
        outgoingEdges.set(n.id, []);
    });

    data.edges.forEach(e => {
        incomingEdges.get(e.target)?.push(e);
        outgoingEdges.get(e.source)?.push(e);
    });

    const llmNodes = data.nodes.filter(n => n.type === 'llm');

    llmNodes.forEach((llmNode, idx) => {
        if (visited.has(llmNode.id)) return;

        const groupNodes = new Set<string>();
        const llmNodesInGroup = new Set<any>();

        const queue = [llmNode.id];
        const groupVisited = new Set([llmNode.id]);

        while (queue.length > 0) {
            const currentId = queue.shift()!;
            groupNodes.add(currentId);

            const currentNode = data.nodes.find(n => n.id === currentId);
            if (currentNode && currentNode.type === 'llm') {
                llmNodesInGroup.add(currentNode);
                visited.add(currentNode.id);
            }

            const incoming = incomingEdges.get(currentId) || [];
            for (const edge of incoming) {
                if (!groupVisited.has(edge.source)) {
                    queue.push(edge.source);
                    groupVisited.add(edge.source);
                }
            }

            const outgoing = outgoingEdges.get(currentId) || [];
            for (const edge of outgoing) {
                if (!groupVisited.has(edge.target)) {
                    queue.push(edge.target);
                    groupVisited.add(edge.target);
                }
            }
        }

        const groupNodesList = Array.from(groupNodes);

        if (groupNodesList.length >= 3) {
            // Get model names from the actual LLM nodes in this group
            const modelNames = Array.from(llmNodesInGroup)
                .map((n: any) => n.model)
                .filter((m: string) => !!m);
            const llmProviders = modelNames.length > 0
                ? [...new Set(modelNames)].join(', ')
                : 'LLM';

            const groupName = llmNodesInGroup.size > 1
                ? `Workflow (${llmNodesInGroup.size} LLM nodes)`
                : (llmNode.label || `Workflow ${idx + 1}`);

            const groupId = `group_${idx}`;
            groups.push({
                id: groupId,
                name: groupName,
                nodes: groupNodesList,
                llmProviders: llmProviders,
                collapsed: false,
                color: colorFromString(groupId),
                level: 1,
                components: []  // No components detected client-side
            });
        }
    });

    groups.sort((a, b) => a.name.localeCompare(b.name));
    return groups;
}

/**
 * Update header snapshot stats
 */
export function updateSnapshotStats(workflowGroups: WorkflowGroup[], currentGraphData: WorkflowGraph): void {
    // Only count workflows with 3+ nodes
    const renderedWorkflows = workflowGroups.filter(wf => wf.nodes.length >= 3);
    const visibleWorkflowCount = renderedWorkflows.length;

    // Get all visible node IDs from rendered workflows
    const visibleNodeIds = new Set<string>();
    renderedWorkflows.forEach(wf => wf.nodes.forEach(id => visibleNodeIds.add(id)));

    // Count only LLM nodes that are in visible workflows
    const visibleLlmCalls = currentGraphData.nodes.filter(n => n.type === 'llm' && visibleNodeIds.has(n.id)).length;

    const statWorkflows = document.getElementById('statWorkflows');
    const statLlmCalls = document.getElementById('statLlmCalls');
    const statTimestamp = document.getElementById('statTimestamp');

    if (statWorkflows) statWorkflows.textContent = String(visibleWorkflowCount);
    if (statLlmCalls) statLlmCalls.textContent = String(visibleLlmCalls);

    if (statTimestamp) {
        const now = new Date();
        const hours = now.getHours();
        const minutes = now.getMinutes().toString().padStart(2, '0');
        const ampm = hours >= 12 ? 'PM' : 'AM';
        const hour12 = hours % 12 || 12;
        statTimestamp.textContent = `${hour12}:${minutes} ${ampm}`;
    }
}
