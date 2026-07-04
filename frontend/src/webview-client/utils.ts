// Utility functions for webview client

import { ARROW_HEAD_LENGTH } from './constants';

/**
 * Escape a node ID for use in CSS attribute selectors.
 * Node IDs may contain characters invalid in CSS selectors (::, spaces, etc.)
 */
export function escapeNodeIdForCSS(nodeId: string): string {
    // CSS.escape handles all special characters properly
    return CSS.escape(nodeId);
}

/**
 * Snap value to nearest grid point.
 * Currently disabled — grid snapping causes workflow spacing inconsistencies
 * with ELK layout. Kept as a pass-through so callers don't need to change
 * if/when this is re-enabled.
 */
export function snapToGrid(value: number): number {
    return value;
}

/**
 * Calculate intersection point at rectangle boundary
 */
export function intersectRect(
    sourceNode: { x: number; y: number },
    targetNode: { x: number; y: number },
    nodeWidth: number = 50,
    nodeHeight: number = 50
): { x: number; y: number } {
    const dx = sourceNode.x - targetNode.x;
    const dy = sourceNode.y - targetNode.y;
    const halfWidth = nodeWidth / 2;
    const halfHeight = nodeHeight / 2;

    // Determine which edge is hit first (top/bottom vs left/right)
    if (Math.abs(dy / dx) > halfHeight / halfWidth) {
        // Hits top or bottom edge
        return {
            x: targetNode.x + dx * Math.abs(halfHeight / dy),
            y: targetNode.y + halfHeight * Math.sign(dy)
        };
    } else {
        // Hits left or right edge
        return {
            x: targetNode.x + halfWidth * Math.sign(dx),
            y: targetNode.y + dy * Math.abs(halfWidth / dx)
        };
    }
}

/**
 * Calculate intersection point at hexagon boundary
 * Short hexagon with points on left/right, flat top/bottom
 * indent = 20% of width for the angled corners
 */
export function intersectHexagon(
    sourceNode: { x: number; y: number },
    targetNode: { x: number; y: number },
    nodeWidth: number = 50,
    nodeHeight: number = 50
): { x: number; y: number } {
    const dx = sourceNode.x - targetNode.x;
    const dy = sourceNode.y - targetNode.y;
    const hw = nodeWidth / 2;
    const hh = nodeHeight / 2;
    const indent = nodeWidth * 0.2;

    // Handle edge case where source and target are at same position
    if (dx === 0 && dy === 0) {
        return { x: targetNode.x, y: targetNode.y - hh };
    }

    // Normalize direction
    const len = Math.sqrt(dx * dx + dy * dy);
    const nx = dx / len;
    const ny = dy / len;

    // Check intersection with each edge of the hexagon
    // Hexagon vertices (clockwise from left point):
    // Left: (-hw, 0), TopLeft: (-hw+indent, -hh), TopRight: (hw-indent, -hh)
    // Right: (hw, 0), BottomRight: (hw-indent, hh), BottomLeft: (-hw+indent, hh)

    let bestT = Infinity;

    // Helper to intersect ray from center with line segment
    const intersectSegment = (x1: number, y1: number, x2: number, y2: number) => {
        const ex = x2 - x1, ey = y2 - y1;
        const denom = nx * ey - ny * ex;
        if (Math.abs(denom) < 1e-10) return Infinity;
        const t = (x1 * ey - y1 * ex) / denom;
        const s = (x1 * ny - y1 * nx) / denom;
        if (t > 0 && s >= 0 && s <= 1) return t;
        return Infinity;
    };

    // Check all 6 edges
    bestT = Math.min(bestT, intersectSegment(-hw, 0, -hw + indent, -hh));      // Left to TopLeft
    bestT = Math.min(bestT, intersectSegment(-hw + indent, -hh, hw - indent, -hh)); // Top edge
    bestT = Math.min(bestT, intersectSegment(hw - indent, -hh, hw, 0));        // TopRight to Right
    bestT = Math.min(bestT, intersectSegment(hw, 0, hw - indent, hh));         // Right to BottomRight
    bestT = Math.min(bestT, intersectSegment(hw - indent, hh, -hw + indent, hh));   // Bottom edge
    bestT = Math.min(bestT, intersectSegment(-hw + indent, hh, -hw, 0));       // BottomLeft to Left

    if (bestT === Infinity) {
        // Fallback to simple rectangle intersection
        bestT = Math.min(hw / Math.abs(nx), hh / Math.abs(ny));
    }

    return {
        x: targetNode.x + nx * bestT,
        y: targetNode.y + ny * bestT
    };
}

/**
 * Generate unique color from string hash using HSL
 */
export function colorFromString(str: string, saturation: number = 70, lightness: number = 60): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = Math.abs(hash) % 360;
    return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}

/**
 * Get node or collapsed group representation for edge routing
 */
export function getNodeOrCollapsedGroup(nodeId: string, nodes: any[], workflowGroups: any[]): any {
    // Check for collapsed workflow group
    const collapsedGroup = workflowGroups.find((g: any) =>
        g.collapsed && g.nodes.includes(nodeId)
    );

    if (collapsedGroup) {
        return {
            id: collapsedGroup.id,
            x: collapsedGroup.centerX,
            y: collapsedGroup.centerY,
            isCollapsedGroup: true,
            width: 260,
            height: 130
        };
    }

    return nodes.find((n: any) => n.id === nodeId);
}

/**
 * Generate orthogonal edge path (square corners, no curves)
 * For top-down layout: exit bottom, bend horizontally, enter top
 */
export function generateEdgePath(
    edge: any,
    sourceNode: any,
    targetNode: any,
    workflowGroups: any[],
    targetWidth: number = 200,
    targetHeight: number = 54,
    sourceWidth: number = 200,
    sourceHeight: number = 54,
    allEdges: any[] = []
): string {
    // Validate nodes exist and have valid coordinates
    if (!sourceNode || !targetNode ||
        typeof sourceNode.x !== 'number' || typeof sourceNode.y !== 'number' ||
        typeof targetNode.x !== 'number' || typeof targetNode.y !== 'number' ||
        isNaN(sourceNode.x) || isNaN(sourceNode.y) ||
        isNaN(targetNode.x) || isNaN(targetNode.y)) {
        console.warn(`Invalid edge coordinates for ${edge.source} -> ${edge.target}`);
        return '';
    }

    // Use dynamic dimensions from node if available
    const srcWidth = sourceNode.width || sourceWidth;
    const srcHeight = sourceNode.height || sourceHeight;
    const tgtWidth = targetNode.width || targetWidth;
    const tgtHeight = targetNode.height || targetHeight;

    // For top-down layout: source exits from bottom, target enters from top
    const startX = sourceNode.x;
    const startY = sourceNode.y + srcHeight / 2;  // Bottom of source
    const endX = targetNode.x;
    const endY = targetNode.y - tgtHeight / 2 - ARROW_HEAD_LENGTH;  // Top of target (with arrow offset)

    // If nodes are vertically aligned (or very close), draw straight line
    if (Math.abs(startX - endX) < 5) {
        return `M${startX},${startY} L${endX},${endY}`;
    }

    // Create orthogonal path with one horizontal segment
    // Midpoint Y is halfway between source bottom and target top
    const midY = (startY + endY) / 2;

    // Path: down from source, horizontal, down to target
    return `M${startX},${startY} L${startX},${midY} L${endX},${midY} L${endX},${endY}`;
}
