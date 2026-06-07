import {
  compileGlyphDefinition,
  createPrimitiveNodeFromSpec,
  parseGlyphDefinition
} from "./glyph-core.mjs";
import { getGlyphDefinitions } from "./glyph-definitions.mjs";
import { scoreGlyph } from "./glyph-score.mjs";

export const SET_GRAMMAR_VERSION = "1";

export const DEFAULT_SET_GRAMMAR_DEFAULTS = Object.freeze({
  backoffWeight: 0.15,
  maxDepth: 4,
  maxAttemptsPerGlyph: 200,
  maxSetAttempts: 10,
  overallScoreFloor: 0.42,
  slotFitFloor: 0.62,
  connectivityFloor: 0,
  verticalSymmetryCoverageFloor: 0,
  horizontalSymmetryCoverageFloor: 0,
  complexityFloor: 0,
  complexityCeiling: 1,
  noveltyFloor: 0.04,
  featureDistanceFloor: 0.05,
  minRepeatedGlyphCount: 0,
  scorePadding: 0.22,
  densityPadding: 0.08,
  occupiedCellRatioPadding: 0.08,
  segmentCountPadding: 2,
  componentCountPadding: 1,
  rowCountPadding: 1,
  columnCountPadding: 1,
  overlayCountPadding: 1,
  primitiveCountPadding: 2,
  maxRepeatedStructureCount: 2
});

const STRUCTURE_CONTEXTS = ["root", "grid", "overlay", "any"];
const NODE_FAMILIES = ["primitive", "grid", "overlay"];
const PRIMITIVE_KIND_TO_SYMBOL = Object.freeze({
  triangle: "T",
  square: "R",
  arcCircle: "C",
  starburst: "S"
});
const SYMBOL_TO_PRIMITIVE_KIND = Object.freeze(
  Object.fromEntries(Object.entries(PRIMITIVE_KIND_TO_SYMBOL).map(([kind, symbol]) => [symbol, kind]))
);
const EDGE_COUNTS = Object.freeze({
  triangle: 3,
  square: 4,
  arcCircle: 4,
  starburst: 8
});
const FEATURE_KEYS = Object.freeze([
  "verticalSymmetry",
  "horizontalSymmetry",
  "connectivity",
  "density",
  "balance",
  "complexity"
]);
const STRUCTURE_KEYS = Object.freeze([
  "segmentCount",
  "componentCount",
  "occupiedCellRatio",
  "rowCount",
  "columnCount",
  "overlayCount",
  "primitiveCount"
]);

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function clone(value) {
  return structuredClone(value);
}

function formatNumber(value) {
  if (Number.isInteger(value)) {
    return String(value);
  }

  return Number(value.toFixed(4)).toString();
}

function hashSeed(seed) {
  const text = String(seed);
  let hash = 2166136261;

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function createRng(seed) {
  let state = hashSeed(seed);

  return () => {
    state = (state + 0x6D2B79F5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function randomIndex(length, rng) {
  return Math.min(length - 1, Math.floor(rng() * length));
}

function sampleFromDistribution(entries, rng) {
  if (!entries || entries.length === 0) {
    throw new Error("Cannot sample from an empty distribution");
  }

  const target = rng();
  let running = 0;

  for (const entry of entries) {
    running += entry.probability;
    if (target <= running + 1e-9) {
      return clone(entry.value);
    }
  }

  return clone(entries[entries.length - 1].value);
}

function incrementCount(bucket, key, amount = 1) {
  bucket.set(key, (bucket.get(key) || 0) + amount);
}

function encodeValue(value) {
  return JSON.stringify(value);
}

function decodeValue(value) {
  return JSON.parse(value);
}

function countsToDistribution(counts) {
  const total = [...counts.values()].reduce((sum, count) => sum + count, 0);

  if (total <= 0) {
    return [];
  }

  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, count]) => ({
      value: decodeValue(key),
      probability: count / total
    }));
}

function mergeDistribution(primary = [], fallback = [], fallbackWeight = DEFAULT_SET_GRAMMAR_DEFAULTS.backoffWeight) {
  if (primary.length === 0) {
    return fallback.map((entry) => ({ value: clone(entry.value), probability: entry.probability }));
  }

  if (fallback.length === 0 || fallbackWeight <= 0) {
    return primary.map((entry) => ({ value: clone(entry.value), probability: entry.probability }));
  }

  const merged = new Map();

  primary.forEach((entry) => {
    merged.set(encodeValue(entry.value), entry.probability * (1 - fallbackWeight));
  });
  fallback.forEach((entry) => {
    const key = encodeValue(entry.value);
    merged.set(key, (merged.get(key) || 0) + (entry.probability * fallbackWeight));
  });

  const normalized = [...merged.entries()].map(([key, probability]) => ({
    value: decodeValue(key),
    probability
  }));
  const total = normalized.reduce((sum, entry) => sum + entry.probability, 0);

  return normalized.map((entry) => ({
    value: entry.value,
    probability: total > 0 ? entry.probability / total : 0
  }));
}

function approxEqual(left, right, epsilon = 1e-6) {
  return Math.abs(left - right) <= epsilon;
}

function hiddenEdgesToBitmask(hiddenEdges = [], edgeCount) {
  let bitmask = 0;

  for (let index = 0; index < edgeCount; index += 1) {
    if (!hiddenEdges.includes(index)) {
      bitmask |= (1 << index);
    }
  }

  return bitmask;
}

function bitmaskToHiddenEdges(bitmask, edgeCount) {
  const hiddenEdges = [];

  for (let index = 0; index < edgeCount; index += 1) {
    if (((bitmask >> index) & 1) === 0) {
      hiddenEdges.push(index);
    }
  }

  return hiddenEdges;
}

function extractRotation(modifiers = []) {
  let rotation = null;
  const remaining = [];

  modifiers.forEach((modifier) => {
    if (modifier.type === "rotate" && rotation === null) {
      rotation = modifier.args[0];
      return;
    }

    remaining.push({
      type: modifier.type,
      args: [...modifier.args]
    });
  });

  return {
    rotation,
    modifiers: remaining
  };
}

function normalizeModifierSequence(modifiers = []) {
  return modifiers.map((modifier) => ({
    type: modifier.type,
    args: modifier.args.map((value) => Number(value.toFixed ? value.toFixed(4) : value))
  }));
}

function baseSpecForPrimitiveKind(kind) {
  if (kind === "triangle") {
    return {
      primitive: "triangle",
      width: 60,
      height: 60,
      hiddenEdges: []
    };
  }

  if (kind === "square") {
    return {
      primitive: "square",
      width: 60,
      height: 60,
      hiddenEdges: []
    };
  }

  if (kind === "arcCircle") {
    return {
      primitive: "arcCircle",
      radius: 30,
      hiddenEdges: []
    };
  }

  if (kind === "starburst") {
    return {
      primitive: "starburst",
      points: 8,
      radius: 30,
      mode: "radius",
      hiddenEdges: []
    };
  }

  throw new Error(`Unsupported primitive kind: ${kind}`);
}

function nodeFamily(node) {
  if (node.type === "primitive") {
    return "primitive";
  }

  return node.layout === "overlay" ? "overlay" : "grid";
}

function canonicalizeNode(node) {
  if (node.type === "primitive") {
    return {
      type: "primitive",
      primitive: node.primitive,
      spec: clone(node.spec),
      modifiers: normalizeModifierSequence(node.modifiers || [])
    };
  }

  const rows = node.rows.map((row) => row.map(canonicalizeNode));

  if (node.layout === "overlay") {
    rows[0].sort((left, right) => canonicalStructureSignature(left).localeCompare(canonicalStructureSignature(right)));
  }

  return {
    type: "composite",
    layout: node.layout,
    rows,
    modifiers: normalizeModifierSequence(node.modifiers || [])
  };
}

function canonicalStructureValue(node) {
  if (node.type === "primitive") {
    return {
      type: "primitive",
      primitive: node.primitive
    };
  }

  return {
    type: "composite",
    layout: node.layout,
    rows: node.rows.map((row) => row.map(canonicalStructureValue))
  };
}

function canonicalStructureSignature(node) {
  return encodeValue(canonicalStructureValue(canonicalizeNode(node)));
}

function serializeModifier(modifier) {
  const modifierName = {
    translate: "t",
    scale: "s",
    curve: "c",
    heart: "h",
    bounds: "b"
  }[modifier.type];

  if (!modifierName) {
    throw new Error(`Unknown modifier type: ${modifier.type}`);
  }

  return `${modifierName}(${modifier.args.map(formatNumber).join(",")})`;
}

function serializePrimitive(node) {
  const symbol = PRIMITIVE_KIND_TO_SYMBOL[node.primitive];

  if (!symbol) {
    throw new Error(`Unknown primitive kind for serialization: ${node.primitive}`);
  }

  const { rotation, modifiers } = extractRotation(node.modifiers || []);
  const edgeCount = EDGE_COUNTS[node.primitive];
  const bitmask = hiddenEdgesToBitmask(node.spec.hiddenEdges || [], edgeCount);
  const isFullMask = bitmask === ((1 << edgeCount) - 1);
  let token = symbol;

  if (!isFullMask) {
    token += String(bitmask);
  }

  if (rotation !== null && !approxEqual(rotation, 0)) {
    token += `r${formatNumber(rotation)}`;
  }

  const suffixes = modifiers.map(serializeModifier);
  return [token, ...suffixes].join(" ");
}

function serializeNode(node, nested = false) {
  if (node.type === "primitive") {
    return serializePrimitive(node);
  }

  const inner = node.rows
    .map((row) => row.map((child) => serializeNode(child, true)).join(node.layout === "overlay" ? "*" : " "))
    .join("|");
  const needsBrackets = nested;
  const base = needsBrackets ? `[${inner}]` : inner;
  const suffixes = (node.modifiers || []).map(serializeModifier);

  return [base, ...suffixes].join(" ");
}

function resolveSourceGlyphMap(source) {
  if (typeof source === "string") {
    const glyphs = getGlyphDefinitions(source);
    return {
      label: source,
      glyphs
    };
  }

  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new Error("source must be a built-in glyph set name or a glyph definition map");
  }

  const entries = Object.entries(source);

  if (entries.length === 0) {
    throw new Error("source glyph map cannot be empty");
  }

  entries.forEach(([key, definition]) => {
    if (typeof definition !== "string") {
      throw new Error(`Glyph definition for ${key} must be a string`);
    }
  });

  return {
    label: "custom",
    glyphs: Object.fromEntries(entries)
  };
}

function summarizeNode(node) {
  const summary = {
    rowCount: 0,
    columnCount: 0,
    overlayCount: 0,
    primitiveCount: 0,
    modifierTypes: new Set()
  };

  function visit(current) {
    (current.modifiers || []).forEach((modifier) => {
      summary.modifierTypes.add(modifier.type);
    });

    if (current.type === "primitive") {
      summary.primitiveCount += 1;
      return;
    }

    if (current.layout === "grid") {
      summary.rowCount = Math.max(summary.rowCount, current.rows.length);
      summary.columnCount = Math.max(summary.columnCount, ...current.rows.map((row) => row.length));
    } else {
      summary.overlayCount += 1;
    }

    current.rows.flat().forEach(visit);
  }

  visit(node);

  return {
    rowCount: Math.max(1, summary.rowCount || 1),
    columnCount: Math.max(1, summary.columnCount || 1),
    overlayCount: summary.overlayCount,
    primitiveCount: summary.primitiveCount,
    modifierTypes: [...summary.modifierTypes].sort()
  };
}

function makeRange(value, padding, min = 0, max = Number.POSITIVE_INFINITY) {
  return {
    min: Math.max(min, value - padding),
    max: Math.min(max, value + padding)
  };
}

function buildSlotProfile(key, definition, node, analysis, defaults) {
  const summary = summarizeNode(node);

  return {
    key,
    sourceDefinition: definition,
    structureSignature: canonicalStructureSignature(node),
    target: {
      overall: analysis.overall,
      scores: clone(analysis.scores),
      metrics: {
        segmentCount: analysis.metrics.segmentCount,
        componentCount: analysis.metrics.componentCount,
        occupiedCellRatio: analysis.metrics.occupiedCellRatio,
        rowCount: summary.rowCount,
        columnCount: summary.columnCount,
        overlayCount: summary.overlayCount,
        primitiveCount: summary.primitiveCount
      }
    },
    ranges: {
      overall: makeRange(analysis.overall, defaults.scorePadding, 0, 1),
      scores: {
        verticalSymmetry: makeRange(analysis.scores.verticalSymmetry, defaults.scorePadding, 0, 1),
        horizontalSymmetry: makeRange(analysis.scores.horizontalSymmetry, defaults.scorePadding, 0, 1),
        connectivity: makeRange(analysis.scores.connectivity, defaults.scorePadding, 0, 1),
        density: makeRange(analysis.scores.density, defaults.densityPadding, 0, 1),
        balance: makeRange(analysis.scores.balance, defaults.scorePadding, 0, 1),
        complexity: makeRange(analysis.scores.complexity, defaults.scorePadding, 0, 1)
      },
      metrics: {
        segmentCount: makeRange(analysis.metrics.segmentCount, defaults.segmentCountPadding, 1),
        componentCount: makeRange(analysis.metrics.componentCount, defaults.componentCountPadding, 1),
        occupiedCellRatio: makeRange(analysis.metrics.occupiedCellRatio, defaults.occupiedCellRatioPadding, 0, 1),
        rowCount: makeRange(summary.rowCount, defaults.rowCountPadding, 1),
        columnCount: makeRange(summary.columnCount, defaults.columnCountPadding, 1),
        overlayCount: makeRange(summary.overlayCount, defaults.overlayCountPadding, 0),
        primitiveCount: makeRange(summary.primitiveCount, defaults.primitiveCountPadding, 1)
      }
    },
    modifierTypes: summary.modifierTypes
  };
}

function createCountBuckets() {
  const distributions = {};

  STRUCTURE_CONTEXTS.forEach((context) => {
    distributions[context] = new Map();
  });

  return distributions;
}

function recordContextCount(distributions, context, value) {
  incrementCount(distributions[context], encodeValue(value));
  incrementCount(distributions.any, encodeValue(value));
}

function inferCountsFromNode(node, context, counts) {
  const family = nodeFamily(node);
  recordContextCount(counts.structure.nodeFamilies, context, family);

  if (family === "primitive") {
    const { rotation, modifiers } = extractRotation(node.modifiers || []);
    const bitmask = hiddenEdgesToBitmask(node.spec.hiddenEdges || [], EDGE_COUNTS[node.primitive]);

    recordContextCount(counts.attributes.primitiveKinds, context, node.primitive);
    recordContextCount(counts.attributes.bitmasks[node.primitive], context, bitmask);
    recordContextCount(counts.attributes.rotations[node.primitive], context, rotation);
    recordContextCount(counts.attributes.primitiveModifiers[node.primitive], context, normalizeModifierSequence(modifiers));
    return;
  }

  if (node.layout === "grid") {
    recordContextCount(counts.structure.gridPatterns, context, node.rows.map((row) => row.length));
  } else {
    recordContextCount(counts.structure.overlayChildCounts, context, node.rows[0].length);
  }

  recordContextCount(
    counts.attributes.compositeModifiers[node.layout],
    context,
    normalizeModifierSequence(node.modifiers || [])
  );

  node.rows.flat().forEach((child) => inferCountsFromNode(child, node.layout, counts));
}

function finalizeDistributions(counts) {
  const structureModel = {
    nodeFamilies: Object.fromEntries(
      Object.entries(counts.structure.nodeFamilies).map(([context, bucket]) => [context, countsToDistribution(bucket)])
    ),
    gridPatterns: Object.fromEntries(
      Object.entries(counts.structure.gridPatterns).map(([context, bucket]) => [context, countsToDistribution(bucket)])
    ),
    overlayChildCounts: Object.fromEntries(
      Object.entries(counts.structure.overlayChildCounts).map(([context, bucket]) => [context, countsToDistribution(bucket)])
    ),
    backoff: {
      fallbackContext: "any",
      weight: DEFAULT_SET_GRAMMAR_DEFAULTS.backoffWeight
    }
  };
  const attributeModel = {
    primitiveKinds: Object.fromEntries(
      Object.entries(counts.attributes.primitiveKinds).map(([context, bucket]) => [context, countsToDistribution(bucket)])
    ),
    bitmasks: Object.fromEntries(
      Object.entries(counts.attributes.bitmasks).map(([primitiveKind, contexts]) => [
        primitiveKind,
        Object.fromEntries(Object.entries(contexts).map(([context, bucket]) => [context, countsToDistribution(bucket)]))
      ])
    ),
    rotations: Object.fromEntries(
      Object.entries(counts.attributes.rotations).map(([primitiveKind, contexts]) => [
        primitiveKind,
        Object.fromEntries(Object.entries(contexts).map(([context, bucket]) => [context, countsToDistribution(bucket)]))
      ])
    ),
    modifierSequences: {
      primitive: Object.fromEntries(
        Object.entries(counts.attributes.primitiveModifiers).map(([primitiveKind, contexts]) => [
          primitiveKind,
          Object.fromEntries(Object.entries(contexts).map(([context, bucket]) => [context, countsToDistribution(bucket)]))
        ])
      ),
      composite: Object.fromEntries(
        Object.entries(counts.attributes.compositeModifiers).map(([layout, contexts]) => [
          layout,
          Object.fromEntries(Object.entries(contexts).map(([context, bucket]) => [context, countsToDistribution(bucket)]))
        ])
      )
    }
  };

  return {
    structureModel,
    attributeModel
  };
}

function buildCounts() {
  return {
    structure: {
      nodeFamilies: createCountBuckets(),
      gridPatterns: createCountBuckets(),
      overlayChildCounts: createCountBuckets()
    },
    attributes: {
      primitiveKinds: createCountBuckets(),
      bitmasks: Object.fromEntries(Object.keys(EDGE_COUNTS).map((kind) => [kind, createCountBuckets()])),
      rotations: Object.fromEntries(Object.keys(EDGE_COUNTS).map((kind) => [kind, createCountBuckets()])),
      primitiveModifiers: Object.fromEntries(Object.keys(EDGE_COUNTS).map((kind) => [kind, createCountBuckets()])),
      compositeModifiers: {
        grid: createCountBuckets(),
        overlay: createCountBuckets()
      }
    }
  };
}

function buildInductionDiagnostics(slotProfiles, canonicalNodes) {
  return {
    slotCount: slotProfiles.length,
    uniqueStructureCount: new Set(slotProfiles.map((profile) => profile.structureSignature)).size,
    primitiveKinds: [...new Set(canonicalNodes.flatMap((node) => listPrimitiveKinds(node)))].sort(),
    modifierTypes: [...new Set(slotProfiles.flatMap((profile) => profile.modifierTypes))].sort()
  };
}

function listPrimitiveKinds(node) {
  if (node.type === "primitive") {
    return [node.primitive];
  }

  return node.rows.flat().flatMap(listPrimitiveKinds);
}

function deriveMaxRepeatedStructureCount(slotCount) {
  return Math.max(DEFAULT_SET_GRAMMAR_DEFAULTS.maxRepeatedStructureCount, Math.ceil(slotCount * 0.2));
}

export function induceSetGrammar(source, options = {}) {
  const resolvedSource = resolveSourceGlyphMap(source);
  const counts = buildCounts();
  const slotProfiles = [];
  const canonicalNodes = [];

  Object.entries(resolvedSource.glyphs).forEach(([key, definition]) => {
    const parsed = parseGlyphDefinition(definition);
    compileGlyphDefinition(definition);

    const canonicalNode = canonicalizeNode(parsed);
    const analysis = scoreGlyph(definition);
    const profile = buildSlotProfile(
      key,
      definition,
      canonicalNode,
      analysis,
      DEFAULT_SET_GRAMMAR_DEFAULTS
    );

    canonicalNodes.push(canonicalNode);
    slotProfiles.push(profile);
    inferCountsFromNode(canonicalNode, "root", counts);
  });

  const { structureModel, attributeModel } = finalizeDistributions(counts);
  const defaults = {
    ...DEFAULT_SET_GRAMMAR_DEFAULTS,
    ...(options.defaults || {}),
    maxRepeatedStructureCount: deriveMaxRepeatedStructureCount(slotProfiles.length)
  };
  const grammar = {
    version: SET_GRAMMAR_VERSION,
    metadata: {
      sourceLabel: resolvedSource.label,
      glyphCount: slotProfiles.length,
      supportedPrimitiveKinds: [...new Set(canonicalNodes.flatMap((node) => listPrimitiveKinds(node)))].sort(),
      supportedModifierTypes: [...new Set(slotProfiles.flatMap((profile) => profile.modifierTypes))].sort()
    },
    setPriors: {
      slotOrder: slotProfiles.map((profile) => profile.key),
      slotProfiles: Object.fromEntries(slotProfiles.map((profile) => [profile.key, profile])),
      diversity: {
        noveltyFloor: defaults.noveltyFloor,
        featureDistanceFloor: defaults.featureDistanceFloor,
        maxRepeatedStructureCount: defaults.maxRepeatedStructureCount,
        minRepeatedGlyphCount: defaults.minRepeatedGlyphCount
      },
      acceptance: {
        overallScoreFloor: defaults.overallScoreFloor,
        slotFitFloor: defaults.slotFitFloor,
        connectivityFloor: defaults.connectivityFloor,
        verticalSymmetryCoverageFloor: defaults.verticalSymmetryCoverageFloor,
        horizontalSymmetryCoverageFloor: defaults.horizontalSymmetryCoverageFloor,
        complexityFloor: defaults.complexityFloor,
        complexityCeiling: defaults.complexityCeiling
      }
    },
    structureModel,
    attributeModel,
    defaults
  };

  return {
    grammar,
    diagnostics: buildInductionDiagnostics(slotProfiles, canonicalNodes)
  };
}

function validateProbabilityDistribution(entries, label) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error(`${label} must be a non-empty probability distribution`);
  }

  const total = entries.reduce((sum, entry) => sum + entry.probability, 0);

  if (entries.some((entry) => typeof entry.probability !== "number" || entry.probability < 0)) {
    throw new Error(`${label} contains an invalid probability`);
  }

  if (Math.abs(total - 1) > 1e-3) {
    throw new Error(`${label} probabilities must sum to 1`);
  }
}

export function validateSetGrammar(grammar) {
  if (!grammar || typeof grammar !== "object") {
    throw new Error("grammar must be an object");
  }

  if (grammar.version !== SET_GRAMMAR_VERSION) {
    throw new Error(`Unsupported grammar version: ${grammar.version}`);
  }

  if (!grammar.metadata || typeof grammar.metadata !== "object") {
    throw new Error("grammar.metadata is required");
  }

  if (!grammar.setPriors || typeof grammar.setPriors !== "object") {
    throw new Error("grammar.setPriors is required");
  }

  if (!Array.isArray(grammar.setPriors.slotOrder) || grammar.setPriors.slotOrder.length === 0) {
    throw new Error("grammar.setPriors.slotOrder must be a non-empty array");
  }

  if (!grammar.setPriors.slotProfiles || typeof grammar.setPriors.slotProfiles !== "object") {
    throw new Error("grammar.setPriors.slotProfiles is required");
  }

  grammar.setPriors.slotOrder.forEach((key) => {
    if (!grammar.setPriors.slotProfiles[key]) {
      throw new Error(`Missing slot profile for ${key}`);
    }
  });

  if (!grammar.structureModel || typeof grammar.structureModel !== "object") {
    throw new Error("grammar.structureModel is required");
  }

  if (!grammar.attributeModel || typeof grammar.attributeModel !== "object") {
    throw new Error("grammar.attributeModel is required");
  }

  if (!grammar.structureModel.nodeFamilies || !grammar.structureModel.nodeFamilies.root) {
    throw new Error("grammar.structureModel.nodeFamilies.root is required");
  }

  validateProbabilityDistribution(grammar.structureModel.nodeFamilies.root, "grammar.structureModel.nodeFamilies.root");
  validateProbabilityDistribution(grammar.attributeModel.primitiveKinds?.any || [], "grammar.attributeModel.primitiveKinds.any");
}

function normalizeGrammar(grammar) {
  validateSetGrammar(grammar);

  const defaults = {
    ...DEFAULT_SET_GRAMMAR_DEFAULTS,
    ...(grammar.defaults || {})
  };
  const normalized = clone(grammar);

  normalized.defaults = defaults;
  normalized.setPriors.diversity = {
    noveltyFloor: defaults.noveltyFloor,
    featureDistanceFloor: defaults.featureDistanceFloor,
    maxRepeatedStructureCount: defaults.maxRepeatedStructureCount,
    minRepeatedGlyphCount: defaults.minRepeatedGlyphCount,
    ...(normalized.setPriors.diversity || {})
  };
  normalized.setPriors.acceptance = {
    overallScoreFloor: defaults.overallScoreFloor,
    slotFitFloor: defaults.slotFitFloor,
    connectivityFloor: defaults.connectivityFloor,
    verticalSymmetryCoverageFloor: defaults.verticalSymmetryCoverageFloor,
    horizontalSymmetryCoverageFloor: defaults.horizontalSymmetryCoverageFloor,
    complexityFloor: defaults.complexityFloor,
    complexityCeiling: defaults.complexityCeiling,
    ...(normalized.setPriors.acceptance || {})
  };
  normalized.structureModel.backoff = {
    fallbackContext: "any",
    weight: defaults.backoffWeight,
    ...(normalized.structureModel.backoff || {})
  };

  return normalized;
}

function getDistribution(table, context, fallbackWeight, defaultFallback = []) {
  const direct = table?.[context] || [];
  const fallback = table?.any || defaultFallback;
  return mergeDistribution(direct, fallback, fallbackWeight);
}

function createCompositeNode(layout, rows, modifiers = []) {
  return {
    type: "composite",
    layout,
    rows,
    modifiers: clone(modifiers)
  };
}

function samplePrimitiveNode(grammar, context, rng) {
  const fallbackWeight = grammar.structureModel.backoff.weight;
  const primitiveKind = sampleFromDistribution(
    getDistribution(grammar.attributeModel.primitiveKinds, context, fallbackWeight),
    rng
  );
  const bitmask = sampleFromDistribution(
    getDistribution(grammar.attributeModel.bitmasks[primitiveKind], context, fallbackWeight),
    rng
  );
  const rotation = sampleFromDistribution(
    getDistribution(grammar.attributeModel.rotations[primitiveKind], context, fallbackWeight),
    rng
  );
  const modifiers = sampleFromDistribution(
    getDistribution(grammar.attributeModel.modifierSequences.primitive[primitiveKind], context, fallbackWeight),
    rng
  );
  const spec = baseSpecForPrimitiveKind(primitiveKind);

  spec.hiddenEdges = bitmask === null
    ? []
    : bitmaskToHiddenEdges(bitmask, EDGE_COUNTS[primitiveKind]);

  const finalModifiers = clone(modifiers);

  if (rotation !== null && !approxEqual(rotation, 0)) {
    finalModifiers.unshift({
      type: "rotate",
      args: [rotation]
    });
  }

  return createPrimitiveNodeFromSpec(spec, finalModifiers);
}

function sampleNode(grammar, context, rng, depth, maxDepth) {
  const fallbackWeight = grammar.structureModel.backoff.weight;
  let family = sampleFromDistribution(
    getDistribution(grammar.structureModel.nodeFamilies, context, fallbackWeight),
    rng
  );

  if (depth >= maxDepth && family !== "primitive") {
    family = "primitive";
  }

  if (family === "primitive") {
    return samplePrimitiveNode(grammar, context, rng);
  }

  if (family === "grid") {
    const rowPattern = sampleFromDistribution(
      getDistribution(grammar.structureModel.gridPatterns, context, fallbackWeight),
      rng
    );
    const rows = rowPattern.map((length) => (
      Array.from({ length }, () => sampleNode(grammar, "grid", rng, depth + 1, maxDepth))
    ));
    const modifiers = sampleFromDistribution(
      getDistribution(grammar.attributeModel.modifierSequences.composite.grid, context, fallbackWeight),
      rng
    );

    return createCompositeNode("grid", rows, modifiers);
  }

  const childCount = sampleFromDistribution(
    getDistribution(grammar.structureModel.overlayChildCounts, context, fallbackWeight),
    rng
  );
  const children = Array.from({ length: childCount }, () => sampleNode(grammar, "overlay", rng, depth + 1, maxDepth));
  children.sort((left, right) => canonicalStructureSignature(left).localeCompare(canonicalStructureSignature(right)));

  const modifiers = sampleFromDistribution(
    getDistribution(grammar.attributeModel.modifierSequences.composite.overlay, context, fallbackWeight),
    rng
  );

  return createCompositeNode("overlay", [children], modifiers);
}

function nodeAtPath(root, path) {
  let current = root;

  for (const step of path) {
    current = current.rows[step.rowIndex][step.childIndex];
  }

  return current;
}

function collectReplaceablePaths(node, path = [], parentLayout = "root", results = []) {
  if (node.type !== "composite") {
    return results;
  }

  node.rows.forEach((row, rowIndex) => {
    row.forEach((child, childIndex) => {
      results.push({
        path: [...path, { rowIndex, childIndex }],
        context: node.layout
      });
      collectReplaceablePaths(child, [...path, { rowIndex, childIndex }], node.layout, results);
    });
  });

  return results;
}

function mutateNode(root, grammar, rng) {
  const locations = collectReplaceablePaths(root);

  if (locations.length === 0) {
    return sampleNode(grammar, "root", rng, 0, grammar.defaults.maxDepth);
  }

  const location = locations[randomIndex(locations.length, rng)];
  const mutated = clone(root);
  const parentPath = location.path.slice(0, -1);
  const finalStep = location.path[location.path.length - 1];
  const parent = parentPath.length === 0
    ? mutated
    : nodeAtPath(mutated, parentPath);

  parent.rows[finalStep.rowIndex][finalStep.childIndex] = sampleNode(
    grammar,
    location.context,
    rng,
    location.path.length,
    grammar.defaults.maxDepth
  );

  return canonicalizeNode(mutated);
}

function featureVectorFromAnalysis(analysis) {
  return [
    analysis.scores.verticalSymmetry,
    analysis.scores.horizontalSymmetry,
    analysis.scores.connectivity,
    analysis.scores.density,
    analysis.scores.balance,
    analysis.scores.complexity,
    analysis.metrics.occupiedCellRatio
  ];
}

function vectorDistance(left, right) {
  let total = 0;

  for (let index = 0; index < left.length; index += 1) {
    const diff = left[index] - right[index];
    total += diff * diff;
  }

  return Math.sqrt(total / left.length);
}

function scoreRangeFit(value, range) {
  if (value >= range.min && value <= range.max) {
    return 1;
  }

  const span = Math.max(1e-6, range.max - range.min);
  if (value < range.min) {
    return clamp(1 - ((range.min - value) / span));
  }

  return clamp(1 - ((value - range.max) / span));
}

function calculateSlotFit(profile, analysis, node) {
  const summary = summarizeNode(node);
  const metricValues = {
    segmentCount: analysis.metrics.segmentCount,
    componentCount: analysis.metrics.componentCount,
    occupiedCellRatio: analysis.metrics.occupiedCellRatio,
    rowCount: summary.rowCount,
    columnCount: summary.columnCount,
    overlayCount: summary.overlayCount,
    primitiveCount: summary.primitiveCount
  };
  const scoreFits = FEATURE_KEYS.map((key) => scoreRangeFit(analysis.scores[key], profile.ranges.scores[key]));
  const metricFits = STRUCTURE_KEYS.map((key) => scoreRangeFit(metricValues[key], profile.ranges.metrics[key]));
  const overallFit = scoreRangeFit(analysis.overall, profile.ranges.overall);
  const combined = [...scoreFits, ...metricFits, overallFit];

  return {
    overallFit,
    combined,
    value: combined.reduce((sum, fit) => sum + fit, 0) / combined.length,
    summary
  };
}

function evaluateCandidate({
  definition,
  node,
  profile,
  acceptedDefinitions,
  acceptedVectors,
  acceptedStructureCounts,
  sourceDefinitions,
  grammar
}) {
  const references = [...sourceDefinitions, ...acceptedDefinitions];
  const analysis = scoreGlyph(definition, references.length > 0 ? { references } : {});
  const slotFit = calculateSlotFit(profile, analysis, node);
  const novelty = analysis.scores.novelty ?? 1;
  const vector = featureVectorFromAnalysis(analysis);
  const minFeatureDistance = acceptedVectors.length === 0
    ? Number.POSITIVE_INFINITY
    : Math.min(...acceptedVectors.map((candidate) => vectorDistance(vector, candidate)));
  const structureSignature = canonicalStructureSignature(node);
  const repeatedStructureCount = (acceptedStructureCounts.get(structureSignature) || 0) + 1;
  const rejectionReasons = [];

  if (analysis.metrics.segmentCount <= 0) {
    rejectionReasons.push("empty-geometry");
  }
  if (analysis.overall < grammar.setPriors.acceptance.overallScoreFloor) {
    rejectionReasons.push("overall-score");
  }
  if (slotFit.value < grammar.setPriors.acceptance.slotFitFloor) {
    rejectionReasons.push("slot-fit");
  }
  if (analysis.scores.connectivity < grammar.setPriors.acceptance.connectivityFloor) {
    rejectionReasons.push("connectivity");
  }
  if (analysis.scores.verticalSymmetryCoverage < grammar.setPriors.acceptance.verticalSymmetryCoverageFloor) {
    rejectionReasons.push("vertical-symmetry-coverage");
  }
  if (analysis.scores.horizontalSymmetryCoverage < grammar.setPriors.acceptance.horizontalSymmetryCoverageFloor) {
    rejectionReasons.push("horizontal-symmetry-coverage");
  }
  if (analysis.scores.complexity < grammar.setPriors.acceptance.complexityFloor) {
    rejectionReasons.push("complexity-floor");
  }
  if (analysis.scores.complexity > grammar.setPriors.acceptance.complexityCeiling) {
    rejectionReasons.push("complexity-ceiling");
  }
  if (acceptedDefinitions.includes(definition)) {
    rejectionReasons.push("duplicate-definition");
  }
  if (novelty < grammar.setPriors.diversity.noveltyFloor) {
    rejectionReasons.push("novelty");
  }
  if (acceptedVectors.length > 0 && minFeatureDistance < grammar.setPriors.diversity.featureDistanceFloor) {
    rejectionReasons.push("feature-distance");
  }
  if (repeatedStructureCount > grammar.setPriors.diversity.maxRepeatedStructureCount) {
    rejectionReasons.push("repeated-structure");
  }

  return {
    accepted: rejectionReasons.length === 0,
    definition,
    node,
    analysis,
    slotFit: slotFit.value,
    slotFitBreakdown: slotFit.combined,
    structureSummary: slotFit.summary,
    novelty,
    featureVector: vector,
    minFeatureDistance,
    structureSignature,
    rejectionReasons
  };
}

function compareCandidates(left, right) {
  const leftScore = (left.accepted ? 1000 : 0) + left.slotFit + left.analysis.overall + left.novelty;
  const rightScore = (right.accepted ? 1000 : 0) + right.slotFit + right.analysis.overall + right.novelty;
  return leftScore - rightScore;
}

function countRepeatedGlyphs(acceptedStructureCounts) {
  return [...acceptedStructureCounts.values()]
    .filter((count) => count > 1)
    .reduce((sum, count) => sum + count, 0);
}

function compareSets(left, right) {
  if (left.setDiagnostics.meetsMinRepeatedGlyphCount !== right.setDiagnostics.meetsMinRepeatedGlyphCount) {
    return left.setDiagnostics.meetsMinRepeatedGlyphCount ? 1 : -1;
  }

  if (left.setDiagnostics.acceptedCount !== right.setDiagnostics.acceptedCount) {
    return left.setDiagnostics.acceptedCount - right.setDiagnostics.acceptedCount;
  }

  if (left.setDiagnostics.slotFitAverage !== right.setDiagnostics.slotFitAverage) {
    return left.setDiagnostics.slotFitAverage - right.setDiagnostics.slotFitAverage;
  }

  return left.setDiagnostics.overallAverage - right.setDiagnostics.overallAverage;
}

export function generateGlyphSet({
  grammar,
  seed,
  maxAttemptsPerGlyph,
  maxSetAttempts
} = {}) {
  if (seed === undefined || seed === null) {
    throw new Error("generateGlyphSet requires a seed");
  }

  const normalizedGrammar = normalizeGrammar(grammar);
  const attemptsPerGlyph = maxAttemptsPerGlyph ?? normalizedGrammar.defaults.maxAttemptsPerGlyph;
  const totalSetAttempts = maxSetAttempts ?? normalizedGrammar.defaults.maxSetAttempts;
  const sourceDefinitions = normalizedGrammar.setPriors.slotOrder.map((key) => (
    normalizedGrammar.setPriors.slotProfiles[key].sourceDefinition
  ));

  let bestSet = null;

  for (let setAttempt = 0; setAttempt < totalSetAttempts; setAttempt += 1) {
    const rng = createRng(`${seed}:${setAttempt}`);
    const acceptedDefinitions = [];
    const acceptedVectors = [];
    const acceptedStructureCounts = new Map();
    const glyphs = {};
    const definitions = {};

    normalizedGrammar.setPriors.slotOrder.forEach((key) => {
      const profile = normalizedGrammar.setPriors.slotProfiles[key];
      const rejectionCounts = {};
      let bestCandidate = null;
      let previousNode = null;

      for (let attempt = 0; attempt < attemptsPerGlyph; attempt += 1) {
        let node;

        if (previousNode && rng() < 0.65) {
          node = mutateNode(previousNode, normalizedGrammar, rng);
        } else {
          node = canonicalizeNode(sampleNode(
            normalizedGrammar,
            "root",
            rng,
            0,
            normalizedGrammar.defaults.maxDepth
          ));
        }

        const definition = serializeNode(node);

        let candidate;
        try {
          compileGlyphDefinition(definition);
          candidate = evaluateCandidate({
            definition,
            node,
            profile,
            acceptedDefinitions,
            acceptedVectors,
            acceptedStructureCounts,
            sourceDefinitions,
            grammar: normalizedGrammar
          });
        } catch (error) {
          candidate = {
            accepted: false,
            definition,
            node,
            rejectionReasons: ["compile-error"],
            analysis: {
              overall: 0,
              scores: {
                verticalSymmetry: 0,
                horizontalSymmetry: 0,
                connectivity: 0,
                density: 0,
                balance: 0,
                complexity: 0,
                novelty: 0
              },
              metrics: {
                segmentCount: 0,
                componentCount: 0,
                occupiedCellRatio: 0
              }
            },
            slotFit: 0,
            novelty: 0,
            featureVector: [0, 0, 0, 0, 0, 0, 0],
            minFeatureDistance: 0,
            structureSignature: canonicalStructureSignature(node),
            structureSummary: summarizeNode(node)
          };
        }

        candidate.rejectionReasons.forEach((reason) => {
          rejectionCounts[reason] = (rejectionCounts[reason] || 0) + 1;
        });

        if (!bestCandidate || compareCandidates(candidate, bestCandidate) > 0) {
          bestCandidate = candidate;
          previousNode = node;
        }

        if (candidate.accepted) {
          break;
        }
      }

      const warnings = [];

      if (!bestCandidate.accepted) {
        warnings.push("accepted-best-effort-candidate");
      }

      definitions[key] = bestCandidate.definition;
      glyphs[key] = {
        definition: bestCandidate.definition,
        overall: bestCandidate.analysis.overall,
        scores: clone(bestCandidate.analysis.scores),
        metrics: clone(bestCandidate.analysis.metrics),
        slotFit: bestCandidate.slotFit,
        novelty: bestCandidate.novelty,
        accepted: bestCandidate.accepted,
        attemptCount: attemptsPerGlyph,
        rejectionCounts,
        warnings,
        structureSignature: bestCandidate.structureSignature,
        sourceProfileKey: key
      };

      acceptedDefinitions.push(bestCandidate.definition);
      acceptedVectors.push(bestCandidate.featureVector);
      acceptedStructureCounts.set(
        bestCandidate.structureSignature,
        (acceptedStructureCounts.get(bestCandidate.structureSignature) || 0) + 1
      );
    });

    const values = Object.values(glyphs);
    const acceptedCount = values.filter((glyph) => glyph.accepted).length;
    const minNovelty = Math.min(...values.map((glyph) => glyph.novelty));
    const overallAverage = values.reduce((sum, glyph) => sum + glyph.overall, 0) / values.length;
    const slotFitAverage = values.reduce((sum, glyph) => sum + glyph.slotFit, 0) / values.length;
    const repeatedGlyphCount = countRepeatedGlyphs(acceptedStructureCounts);
    const meetsMinRepeatedGlyphCount = repeatedGlyphCount >= normalizedGrammar.setPriors.diversity.minRepeatedGlyphCount;
    const warnings = [];

    if (acceptedCount !== values.length) {
      warnings.push("returned-best-effort-set");
    }
    if (!meetsMinRepeatedGlyphCount) {
      warnings.push("below-min-repeated-glyph-count");
    }

    const setDiagnostics = {
      seed: `${seed}:${setAttempt}`,
      acceptedCount,
      totalGlyphs: values.length,
      minNovelty,
      overallAverage,
      slotFitAverage,
      repeatedGlyphCount,
      meetsMinRepeatedGlyphCount,
      repeatedStructures: Object.fromEntries(acceptedStructureCounts.entries()),
      warnings
    };
    const currentSet = {
      definitions,
      glyphs,
      setDiagnostics,
      grammarSummary: {
        version: normalizedGrammar.version,
        sourceLabel: normalizedGrammar.metadata.sourceLabel,
        slotCount: normalizedGrammar.setPriors.slotOrder.length
      }
    };

    if (!bestSet || compareSets(currentSet, bestSet) > 0) {
      bestSet = currentSet;
    }

    if (acceptedCount === values.length && meetsMinRepeatedGlyphCount) {
      return bestSet;
    }
  }

  return bestSet;
}
