import {
  DEFAULT_SIZE,
  compileGlyphDefinition,
  fitSegmentsToTarget,
  measureSegments
} from "./glyph-core.mjs";
import {
  endpointKey,
  getSegmentEndpoints,
  sampleSegmentPoints
} from "./glyph-geometry.mjs";

const HALF_DEFAULT_SIZE = DEFAULT_SIZE / 2;
const DEFAULT_SYMMETRY_TOLERANCE = DEFAULT_SIZE * 0.1;
const DEFAULT_SYMMETRY_COVERAGE_THRESHOLD = 2;
const FEATURE_NAMES = [
  "verticalSymmetry",
  "horizontalSymmetry",
  "verticalSymmetryCoverage",
  "horizontalSymmetryCoverage",
  "connectivity",
  "density",
  "balance",
  "complexity"
];

export const DEFAULT_SCORE_WEIGHTS = Object.freeze({
  verticalSymmetry: 0.2,
  horizontalSymmetry: 0.15,
  verticalSymmetryCoverage: 0,
  horizontalSymmetryCoverage: 0,
  connectivity: 0.25,
  density: 0.15,
  balance: 0.15,
  complexity: 0.1,
  novelty: 0
});

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function distanceBetween([ax, ay], [bx, by]) {
  return Math.hypot(ax - bx, ay - by);
}

function interpolatePoint([ax, ay], [bx, by], t) {
  return [
    ax + ((bx - ax) * t),
    ay + ((by - ay) * t)
  ];
}

function triangularScore(value, min, peak, max) {
  if (value <= min || value >= max) {
    return 0;
  }

  if (value === peak) {
    return 1;
  }

  if (value < peak) {
    return clamp((value - min) / (peak - min));
  }

  return clamp((max - value) / (max - peak));
}

function resolveScoreOptions(options = {}) {
  return {
    normalize: options.normalize ?? true,
    gridSize: options.gridSize ?? 24,
    sampleSteps: options.sampleSteps ?? 24,
    endpointSnapDecimals: options.endpointSnapDecimals ?? 4,
    nearMissDistance: options.nearMissDistance ?? 4,
    symmetryCoverageThreshold: options.symmetryCoverageThreshold ?? DEFAULT_SYMMETRY_COVERAGE_THRESHOLD,
    references: options.references ?? null,
    weights: {
      ...DEFAULT_SCORE_WEIGHTS,
      ...(options.weights || {})
    }
  };
}

function visibleSegments(segments) {
  return segments.filter((segment) => segment.visible !== false);
}

function normalizeSegments(segments, options) {
  if (!options.normalize) {
    return segments;
  }

  return fitSegmentsToTarget(segments, DEFAULT_SIZE, DEFAULT_SIZE);
}

function densifyPointList(points, maxStep) {
  if (points.length === 0) {
    return [];
  }

  const dense = [points[0]];

  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    const distance = distanceBetween(start, end);
    const steps = Math.max(1, Math.ceil(distance / maxStep));

    for (let step = 1; step <= steps; step += 1) {
      dense.push(interpolatePoint(start, end, step / steps));
    }
  }

  return dense;
}

function buildPointCloud(segments, sampleSteps) {
  const maxStep = DEFAULT_SIZE / sampleSteps;
  return segments.flatMap((segment) => densifyPointList(sampleSegmentPoints(segment, sampleSteps), maxStep));
}

function pointToGridCell([x, y], gridSize) {
  const gridX = clamp(Math.floor(((x + HALF_DEFAULT_SIZE) / DEFAULT_SIZE) * gridSize), 0, gridSize - 1);
  const gridY = clamp(Math.floor(((y + HALF_DEFAULT_SIZE) / DEFAULT_SIZE) * gridSize), 0, gridSize - 1);
  return [gridX, gridY];
}

function cellKey([x, y]) {
  return `${x},${y}`;
}

function keyToCell(key) {
  const [x, y] = key.split(",").map((value) => Number.parseInt(value, 10));
  return [x, y];
}

function buildOccupancySet(points, gridSize) {
  const occupied = new Set();

  points.forEach((point) => {
    occupied.add(cellKey(pointToGridCell(point, gridSize)));
  });

  return occupied;
}

function reflectPoint([x, y], axis) {
  return axis === "vertical"
    ? [-x, y]
    : [x, -y];
}

function nearestPointDistance(point, candidates) {
  let best = Number.POSITIVE_INFINITY;

  candidates.forEach((candidate) => {
    best = Math.min(best, distanceBetween(point, candidate));
  });

  return best;
}

function directedMeanNearestDistance(sourcePoints, targetPoints) {
  if (sourcePoints.length === 0 && targetPoints.length === 0) {
    return 0;
  }

  if (sourcePoints.length === 0 || targetPoints.length === 0) {
    return DEFAULT_SIZE;
  }

  const total = sourcePoints.reduce((sum, point) => (
    sum + nearestPointDistance(point, targetPoints)
  ), 0);

  return total / sourcePoints.length;
}

function computeMirrorSymmetry(points, axis, tolerance = DEFAULT_SYMMETRY_TOLERANCE) {
  if (points.length === 0) {
    return 1;
  }

  const mirroredPoints = points.map((point) => reflectPoint(point, axis));
  const meanDistance = (
    directedMeanNearestDistance(points, mirroredPoints)
    + directedMeanNearestDistance(mirroredPoints, points)
  ) / 2;

  return clamp(1 - (meanDistance / tolerance));
}

function proximityScore(distance, threshold) {
  if (distance >= threshold) {
    return 0;
  }

  return clamp(1 - (distance / threshold));
}

function directedCoverageScore(sourcePoints, targetPoints, threshold) {
  if (sourcePoints.length === 0 && targetPoints.length === 0) {
    return 1;
  }

  if (sourcePoints.length === 0 || targetPoints.length === 0) {
    return 0;
  }

  const total = sourcePoints.reduce((sum, point) => (
    sum + proximityScore(nearestPointDistance(point, targetPoints), threshold)
  ), 0);

  return total / sourcePoints.length;
}

function computeMirrorCoverageSymmetry(points, axis, threshold) {
  if (points.length === 0) {
    return 1;
  }

  const mirroredPoints = points.map((point) => reflectPoint(point, axis));

  return (
    directedCoverageScore(points, mirroredPoints, threshold)
    + directedCoverageScore(mirroredPoints, points, threshold)
  ) / 2;
}

function computeSetIoU(a, b) {
  if (a.size === 0 && b.size === 0) {
    return 1;
  }

  let intersection = 0;

  a.forEach((value) => {
    if (b.has(value)) {
      intersection += 1;
    }
  });

  const union = a.size + b.size - intersection;
  return union === 0 ? 1 : intersection / union;
}

function computeCentroid(points) {
  if (points.length === 0) {
    return [0, 0];
  }

  const total = points.reduce((summary, [x, y]) => {
    summary.x += x;
    summary.y += y;
    return summary;
  }, { x: 0, y: 0 });

  return [
    total.x / points.length,
    total.y / points.length
  ];
}

function ensureGraphNode(graph, key) {
  if (!graph.has(key)) {
    graph.set(key, new Set());
  }
}

function buildEndpointGraph(segments, endpointSnapDecimals) {
  const graph = new Map();
  const nodes = new Map();

  segments.forEach((segment) => {
    const endpoints = getSegmentEndpoints(segment);
    const startKey = endpointKey(endpoints.start, endpointSnapDecimals);
    const endKey = endpointKey(endpoints.end, endpointSnapDecimals);

    ensureGraphNode(graph, startKey);
    ensureGraphNode(graph, endKey);

    if (!nodes.has(startKey)) {
      nodes.set(startKey, endpoints.start);
    }
    if (!nodes.has(endKey)) {
      nodes.set(endKey, endpoints.end);
    }

    if (startKey !== endKey) {
      graph.get(startKey).add(endKey);
      graph.get(endKey).add(startKey);
    }
  });

  return {
    graph,
    nodes
  };
}

function countConnectedComponents(graph) {
  let count = 0;
  const visited = new Set();

  graph.forEach((neighbors, key) => {
    if (visited.has(key)) {
      return;
    }

    count += 1;
    const stack = [key];
    visited.add(key);

    while (stack.length > 0) {
      const current = stack.pop();

      graph.get(current)?.forEach((neighbor) => {
        if (visited.has(neighbor)) {
          return;
        }

        visited.add(neighbor);
        stack.push(neighbor);
      });
    }
  });

  return count;
}

function countNearMissPairs(nodes, graph, nearMissDistance) {
  const entries = [...nodes.entries()];
  let nearMissCount = 0;

  for (let index = 0; index < entries.length; index += 1) {
    const [leftKey, leftPoint] = entries[index];

    for (let compareIndex = index + 1; compareIndex < entries.length; compareIndex += 1) {
      const [rightKey, rightPoint] = entries[compareIndex];

      if (graph.get(leftKey)?.has(rightKey)) {
        continue;
      }

      const distance = distanceBetween(leftPoint, rightPoint);

      if (distance > 0 && distance <= nearMissDistance) {
        nearMissCount += 1;
      }
    }
  }

  return nearMissCount;
}

function computeFeatureSimilarity(leftScores, rightScores) {
  const difference = FEATURE_NAMES.reduce((sum, key) => (
    sum + Math.abs((leftScores[key] ?? 0) - (rightScores[key] ?? 0))
  ), 0);

  return clamp(1 - (difference / FEATURE_NAMES.length));
}

function sanitizeOutput(analysis) {
  return {
    scores: { ...analysis.scores },
    metrics: {
      ...analysis.metrics,
      bbox: { ...analysis.metrics.bbox },
      centroidOffset: { ...analysis.metrics.centroidOffset }
    }
  };
}

function buildWeightsUsed(weights, scores) {
  const activeEntries = Object.entries(weights).filter(([key, weight]) => (
    weight > 0 && Number.isFinite(scores[key])
  ));
  const totalWeight = activeEntries.reduce((sum, [, weight]) => sum + weight, 0);

  if (totalWeight <= 0) {
    return {};
  }

  return Object.fromEntries(activeEntries.map(([key, weight]) => [key, weight / totalWeight]));
}

function calculateOverall(scores, weights) {
  const weightsUsed = buildWeightsUsed(weights, scores);
  const overall = Object.entries(weightsUsed).reduce((sum, [key, weight]) => (
    sum + (scores[key] * weight)
  ), 0);

  return {
    overall,
    weightsUsed
  };
}

function normalizeReference(reference, options) {
  const referenceOptions = {
    ...options,
    references: null
  };

  if (typeof reference === "string") {
    return analyzeGlyphDefinition(reference, referenceOptions);
  }

  if (Array.isArray(reference)) {
    return analyzeSegments(reference, referenceOptions);
  }

  throw new Error("references must contain glyph definition strings or segment arrays");
}

function analyzeSegments(segments, rawOptions = {}) {
  const options = resolveScoreOptions(rawOptions);
  const visible = visibleSegments(segments);
  const processedSegments = normalizeSegments(visible, options);
  const pointCloud = buildPointCloud(processedSegments, options.sampleSteps);
  const occupied = buildOccupancySet(pointCloud, options.gridSize);
  const bbox = measureSegments(processedSegments);
  const centroid = computeCentroid(pointCloud);
  const centroidDistance = distanceBetween(centroid, [0, 0]);
  const centroidOffset = {
    x: centroid[0],
    y: centroid[1],
    distance: centroidDistance,
    normalizedDistance: clamp(centroidDistance / Math.hypot(HALF_DEFAULT_SIZE, HALF_DEFAULT_SIZE))
  };
  const { graph, nodes } = buildEndpointGraph(processedSegments, options.endpointSnapDecimals);
  const componentCount = countConnectedComponents(graph);
  const danglingEndpointCount = [...graph.values()].filter((neighbors) => neighbors.size <= 1).length;
  const nearMissCount = countNearMissPairs(nodes, graph, options.nearMissDistance);
  const verticalSymmetry = computeMirrorSymmetry(pointCloud, "vertical");
  const horizontalSymmetry = computeMirrorSymmetry(pointCloud, "horizontal");
  const verticalSymmetryCoverage = computeMirrorCoverageSymmetry(
    pointCloud,
    "vertical",
    options.symmetryCoverageThreshold
  );
  const horizontalSymmetryCoverage = computeMirrorCoverageSymmetry(
    pointCloud,
    "horizontal",
    options.symmetryCoverageThreshold
  );
  const connectivity = clamp(
    1
      - (Math.max(0, componentCount - 1) * 0.2)
      - (danglingEndpointCount * 0.05)
      - (nearMissCount * 0.1)
  );
  const occupiedCellRatio = occupied.size / (options.gridSize * options.gridSize);
  const density = triangularScore(occupiedCellRatio, 0.05, 0.18, 0.4);
  const balance = clamp(1 - centroidOffset.normalizedDistance);
  const complexity = triangularScore(processedSegments.length, 1, 8, 16);
  const scores = {
    verticalSymmetry,
    horizontalSymmetry,
    verticalSymmetryCoverage,
    horizontalSymmetryCoverage,
    connectivity,
    density,
    balance,
    complexity
  };
  const metrics = {
    bbox,
    segmentCount: processedSegments.length,
    componentCount,
    danglingEndpointCount,
    nearMissCount,
    occupiedCellRatio,
    centroidOffset
  };

  if (options.references && options.references.length > 0) {
    const referenceAnalyses = options.references.map((reference) => normalizeReference(reference, options));
    const maxSimilarity = referenceAnalyses.reduce((highest, referenceAnalysis) => {
      const occupancySimilarity = computeSetIoU(occupied, referenceAnalysis.occupied);
      const featureSimilarity = computeFeatureSimilarity(scores, referenceAnalysis.scores);
      return Math.max(highest, (occupancySimilarity * 0.7) + (featureSimilarity * 0.3));
    }, 0);

    scores.novelty = clamp(1 - maxSimilarity);
  }

  return {
    processedSegments,
    pointCloud,
    occupied,
    scores,
    metrics
  };
}

function analyzeGlyphDefinition(definition, options = {}) {
  const compiled = compileGlyphDefinition(definition);
  return analyzeSegments(compiled.segments, options);
}

export function extractSegmentFeatures(segments, options = {}) {
  return sanitizeOutput(analyzeSegments(segments, options));
}

export function extractGlyphFeatures(definition, options = {}) {
  return sanitizeOutput(analyzeGlyphDefinition(definition, options));
}

export function scoreSegments(segments, options = {}) {
  const resolvedOptions = resolveScoreOptions(options);
  const analysis = analyzeSegments(segments, resolvedOptions);
  const { overall, weightsUsed } = calculateOverall(analysis.scores, resolvedOptions.weights);

  return {
    ...sanitizeOutput(analysis),
    overall,
    weightsUsed
  };
}

export function scoreGlyph(definition, options = {}) {
  const resolvedOptions = resolveScoreOptions(options);
  const analysis = analyzeGlyphDefinition(definition, resolvedOptions);
  const { overall, weightsUsed } = calculateOverall(analysis.scores, resolvedOptions.weights);

  return {
    ...sanitizeOutput(analysis),
    overall,
    weightsUsed
  };
}
