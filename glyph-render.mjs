import {
  DEFAULT_SIZE,
  compileGlyphNode,
  fitSegmentsToTarget
} from "./glyph-core.mjs";

const DEFAULT_STROKE = { width: 2, color: "#000" };
const DEFAULT_BRUSH_COLOR = "#000";
const DEFAULT_SEGMENT_PROFILE = { kind: "segment", angle: 30, length: 8 };
const DEFAULT_CIRCLE_PROFILE = { kind: "circle", diameter: 8 };
const DEFAULT_RECTANGLE_PROFILE = { kind: "rectangle", angle: 30, width: 10, height: 4 };
const EPSILON = 1e-6;

function approxEqual(a, b) {
  return Math.abs(a - b) < EPSILON;
}

function clonePoint([x, y]) {
  return [x, y];
}

function pointToSvg([x, y]) {
  return `${x},${y}`;
}

function rotatePoint([x, y], degrees) {
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);

  return [
    x * cos - y * sin,
    x * sin + y * cos
  ];
}

function translatePoint([x, y], dx, dy) {
  return [x + dx, y + dy];
}

function sampleQuadraticPoint(segment, t) {
  const mt = 1 - t;
  return [
    (mt * mt * segment.start[0]) + (2 * mt * t * segment.control[0]) + (t * t * segment.end[0]),
    (mt * mt * segment.start[1]) + (2 * mt * t * segment.control[1]) + (t * t * segment.end[1])
  ];
}

function sampleArcPoint(segment, angle) {
  const [rx, ry] = segment.radii;
  const localPoint = [Math.cos(angle) * rx, Math.sin(angle) * ry];
  const rotated = rotatePoint(localPoint, segment.rotation || 0);
  return translatePoint(rotated, segment.center[0], segment.center[1]);
}

function normalizeBrushProfile(profile = {}) {
  const kind = profile.kind || "segment";

  if (kind === "segment") {
    return {
      kind,
      angle: profile.angle ?? DEFAULT_SEGMENT_PROFILE.angle,
      length: Math.max(0, profile.length ?? profile.thickness ?? DEFAULT_SEGMENT_PROFILE.length)
    };
  }

  if (kind === "circle") {
    return {
      kind,
      diameter: Math.max(0, profile.diameter ?? DEFAULT_CIRCLE_PROFILE.diameter)
    };
  }

  if (kind === "rectangle") {
    return {
      kind,
      angle: profile.angle ?? DEFAULT_RECTANGLE_PROFILE.angle,
      width: Math.max(0, profile.width ?? DEFAULT_RECTANGLE_PROFILE.width),
      height: Math.max(0, profile.height ?? DEFAULT_RECTANGLE_PROFILE.height)
    };
  }

  throw new Error(`Unknown brush profile kind: ${kind}`);
}

export function normalizeBrushOptions(brush = {}, fallbackColor = DEFAULT_STROKE.color) {
  const color = brush.color || fallbackColor || DEFAULT_BRUSH_COLOR;

  if (brush.profile) {
    return {
      color,
      profile: normalizeBrushProfile(brush.profile)
    };
  }

  if ("diameter" in brush) {
    return {
      color,
      profile: normalizeBrushProfile({
        kind: "circle",
        diameter: brush.diameter
      })
    };
  }

  if ("width" in brush || "height" in brush) {
    return {
      color,
      profile: normalizeBrushProfile({
        kind: "rectangle",
        angle: brush.angle,
        width: brush.width,
        height: brush.height
      })
    };
  }

  return {
    color,
    profile: normalizeBrushProfile({
      kind: "segment",
      angle: brush.angle,
      length: brush.length ?? brush.thickness
    })
  };
}

function isLegacyStrokeOptions(options) {
  return options
    && !("mode" in options)
    && !("stroke" in options)
    && !("brush" in options)
    && ("width" in options || "color" in options);
}

function normalizeRenderOptions(options = {}) {
  if (isLegacyStrokeOptions(options)) {
    const stroke = {
      ...DEFAULT_STROKE,
      ...options
    };

    return {
      mode: "stroke",
      stroke,
      brush: normalizeBrushOptions({}, stroke.color)
    };
  }

  const stroke = {
    ...DEFAULT_STROKE,
    ...(options.stroke || {})
  };

  return {
    mode: options.mode || "stroke",
    stroke,
    brush: normalizeBrushOptions(options.brush, stroke.color)
  };
}

function translateSegmentExact(segment, dx, dy) {
  if (segment.kind === "line") {
    return {
      kind: "line",
      start: translatePoint(segment.start, dx, dy),
      end: translatePoint(segment.end, dx, dy),
      visible: segment.visible !== false
    };
  }

  if (segment.kind === "quadratic") {
    return {
      kind: "quadratic",
      start: translatePoint(segment.start, dx, dy),
      control: translatePoint(segment.control, dx, dy),
      end: translatePoint(segment.end, dx, dy),
      visible: segment.visible !== false
    };
  }

  if (segment.kind === "arc") {
    return {
      ...segment,
      center: translatePoint(segment.center, dx, dy),
      radii: clonePoint(segment.radii),
      visible: segment.visible !== false
    };
  }

  throw new Error(`Unknown segment kind: ${segment.kind}`);
}

function arcEndpoints(segment) {
  return {
    start: sampleArcPoint(segment, segment.startAngle),
    end: sampleArcPoint(segment, segment.endAngle)
  };
}

function arcCommandForSegment(segment, endPoint, sweepFlagOverride) {
  const delta = segment.endAngle - segment.startAngle;
  return {
    type: "A",
    radii: clonePoint(segment.radii),
    rotation: segment.rotation || 0,
    largeArcFlag: Math.abs(delta) > Math.PI ? 1 : 0,
    sweepFlag: sweepFlagOverride ?? (delta >= 0 ? 1 : 0),
    point: clonePoint(endPoint)
  };
}

function shapeCommandsToPath(commands) {
  return commands.map((command) => {
    if (command.type === "M" || command.type === "L") {
      return `${command.type}${pointToSvg(command.point)}`;
    }

    if (command.type === "Q") {
      return `Q${pointToSvg(command.control)} ${pointToSvg(command.point)}`;
    }

    if (command.type === "A") {
      return `A${command.radii[0]},${command.radii[1]} ${command.rotation} ${command.largeArcFlag},${command.sweepFlag} ${pointToSvg(command.point)}`;
    }

    if (command.type === "Z") {
      return "Z";
    }

    throw new Error(`Unknown path command: ${command.type}`);
  }).join(" ");
}

function buildCompoundShape(shapes) {
  if (shapes.length === 1) {
    return shapes[0];
  }

  return {
    kind: "compound",
    shapes
  };
}

function createCircularStampPoints(radius, steps = 16) {
  const points = [];

  for (let index = 0; index < steps; index += 1) {
    const angle = (index / steps) * Math.PI * 2;
    points.push([
      Math.cos(angle) * radius,
      Math.sin(angle) * radius
    ]);
  }

  return points;
}

function createRectangleStampPoints(profile) {
  const halfWidth = profile.width / 2;
  const halfHeight = profile.height / 2;
  const base = [
    [-halfWidth, -halfHeight],
    [halfWidth, -halfHeight],
    [halfWidth, halfHeight],
    [-halfWidth, halfHeight]
  ];

  return base.map((point) => rotatePoint(point, profile.angle));
}

function estimateSampleSteps(segment) {
  if (segment.kind === "line") {
    const dx = segment.end[0] - segment.start[0];
    const dy = segment.end[1] - segment.start[1];
    return Math.max(1, Math.ceil(Math.hypot(dx, dy) / 10));
  }

  if (segment.kind === "quadratic") {
    const span = (
      Math.hypot(segment.control[0] - segment.start[0], segment.control[1] - segment.start[1])
      + Math.hypot(segment.end[0] - segment.control[0], segment.end[1] - segment.control[1])
    );
    return Math.max(8, Math.min(48, Math.ceil(span / 8)));
  }

  if (segment.kind === "arc") {
    const averageRadius = (segment.radii[0] + segment.radii[1]) / 2;
    const arcLength = averageRadius * Math.abs(segment.endAngle - segment.startAngle);
    return Math.max(8, Math.min(48, Math.ceil(arcLength / 8)));
  }

  throw new Error(`Unknown segment kind: ${segment.kind}`);
}

function sampleSegmentPoints(segment, steps = estimateSampleSteps(segment)) {
  if (segment.kind === "line") {
    return [clonePoint(segment.start), clonePoint(segment.end)];
  }

  if (segment.kind === "quadratic") {
    const points = [];

    for (let index = 0; index <= steps; index += 1) {
      points.push(sampleQuadraticPoint(segment, index / steps));
    }

    return points;
  }

  if (segment.kind === "arc") {
    const points = [];

    for (let index = 0; index <= steps; index += 1) {
      const t = index / steps;
      const angle = segment.startAngle + ((segment.endAngle - segment.startAngle) * t);
      points.push(sampleArcPoint(segment, angle));
    }

    return points;
  }

  throw new Error(`Unknown segment kind: ${segment.kind}`);
}

function translatePolygon(points, dx, dy) {
  return points.map((point) => translatePoint(point, dx, dy));
}

function cross(o, a, b) {
  return ((a[0] - o[0]) * (b[1] - o[1])) - ((a[1] - o[1]) * (b[0] - o[0]));
}

function convexHull(points) {
  if (points.length <= 1) {
    return points.map(clonePoint);
  }

  const sorted = points
    .map(clonePoint)
    .sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));

  const lower = [];
  sorted.forEach((point) => {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) {
      lower.pop();
    }
    lower.push(point);
  });

  const upper = [];
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const point = sorted[index];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) {
      upper.pop();
    }
    upper.push(point);
  }

  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function buildPolygonSweepShape(segment, localStamp) {
  const centers = sampleSegmentPoints(segment);

  if (centers.length === 1) {
    return {
      kind: "polygon",
      points: translatePolygon(localStamp, centers[0][0], centers[0][1])
    };
  }

  const shapes = [];

  for (let index = 0; index < centers.length - 1; index += 1) {
    const fromStamp = translatePolygon(localStamp, centers[index][0], centers[index][1]);
    const toStamp = translatePolygon(localStamp, centers[index + 1][0], centers[index + 1][1]);
    shapes.push({
      kind: "polygon",
      points: convexHull(fromStamp.concat(toStamp))
    });
  }

  return buildCompoundShape(shapes);
}

function segmentHalfVector(profile) {
  const radians = (profile.angle * Math.PI) / 180;
  const halfLength = profile.length / 2;
  return [
    Math.cos(radians) * halfLength,
    Math.sin(radians) * halfLength
  ];
}

export function buildBrushSegmentShape(segment, brushOptions = {}) {
  const { profile } = normalizeBrushOptions(brushOptions);
  const [dx, dy] = segmentHalfVector(profile);
  const positive = translateSegmentExact(segment, dx, dy);
  const negative = translateSegmentExact(segment, -dx, -dy);

  if (segment.kind === "line") {
    return {
      kind: "polygon",
      points: [
        clonePoint(positive.start),
        clonePoint(positive.end),
        clonePoint(negative.end),
        clonePoint(negative.start)
      ]
    };
  }

  if (segment.kind === "quadratic") {
    return {
      kind: "path",
      commands: [
        { type: "M", point: clonePoint(positive.start) },
        {
          type: "Q",
          control: clonePoint(positive.control),
          point: clonePoint(positive.end)
        },
        { type: "L", point: clonePoint(negative.end) },
        {
          type: "Q",
          control: clonePoint(negative.control),
          point: clonePoint(negative.start)
        },
        { type: "Z" }
      ]
    };
  }

  if (segment.kind === "arc") {
    const positiveEndpoints = arcEndpoints(positive);
    const negativeEndpoints = arcEndpoints(negative);
    const topArc = arcCommandForSegment(positive, positiveEndpoints.end);
    const bottomArc = arcCommandForSegment(
      negative,
      negativeEndpoints.start,
      topArc.sweepFlag === 1 ? 0 : 1
    );

    return {
      kind: "path",
      commands: [
        { type: "M", point: clonePoint(positiveEndpoints.start) },
        topArc,
        { type: "L", point: clonePoint(negativeEndpoints.end) },
        bottomArc,
        { type: "Z" }
      ]
    };
  }

  throw new Error(`Unknown segment kind: ${segment.kind}`);
}

function buildCircleLineBrushShape(segment, profile) {
  const radius = profile.diameter / 2;
  const dx = segment.end[0] - segment.start[0];
  const dy = segment.end[1] - segment.start[1];
  const length = Math.hypot(dx, dy);

  if (length <= EPSILON) {
    return {
      kind: "path",
      commands: [
        { type: "M", point: [segment.start[0] + radius, segment.start[1]] },
        {
          type: "A",
          radii: [radius, radius],
          rotation: 0,
          largeArcFlag: 0,
          sweepFlag: 1,
          point: [segment.start[0] - radius, segment.start[1]]
        },
        {
          type: "A",
          radii: [radius, radius],
          rotation: 0,
          largeArcFlag: 0,
          sweepFlag: 1,
          point: [segment.start[0] + radius, segment.start[1]]
        },
        { type: "Z" }
      ]
    };
  }

  const normal = [(-dy / length) * radius, (dx / length) * radius];
  const startTop = translatePoint(segment.start, normal[0], normal[1]);
  const endTop = translatePoint(segment.end, normal[0], normal[1]);
  const endBottom = translatePoint(segment.end, -normal[0], -normal[1]);
  const startBottom = translatePoint(segment.start, -normal[0], -normal[1]);

  return {
    kind: "path",
    commands: [
      { type: "M", point: startTop },
      { type: "L", point: endTop },
      {
        type: "A",
        radii: [radius, radius],
        rotation: 0,
        largeArcFlag: 0,
        sweepFlag: 1,
        point: endBottom
      },
      { type: "L", point: startBottom },
      {
        type: "A",
        radii: [radius, radius],
        rotation: 0,
        largeArcFlag: 0,
        sweepFlag: 1,
        point: startTop
      },
      { type: "Z" }
    ]
  };
}

function buildCircleArcBrushShape(segment, profile) {
  if (!approxEqual(segment.radii[0], segment.radii[1])) {
    return buildPolygonSweepShape(segment, createCircularStampPoints(profile.diameter / 2));
  }

  const radius = profile.diameter / 2;
  const innerRadius = segment.radii[0] - radius;

  if (innerRadius <= EPSILON) {
    return buildPolygonSweepShape(segment, createCircularStampPoints(radius));
  }

  const outer = {
    ...segment,
    radii: [segment.radii[0] + radius, segment.radii[1] + radius]
  };
  const inner = {
    ...segment,
    radii: [innerRadius, innerRadius]
  };
  const outerEndpoints = arcEndpoints(outer);
  const innerEndpoints = arcEndpoints(inner);
  const outerArc = arcCommandForSegment(outer, outerEndpoints.end);
  const innerArc = arcCommandForSegment(
    inner,
    innerEndpoints.start,
    outerArc.sweepFlag === 1 ? 0 : 1
  );

  return {
    kind: "path",
    commands: [
      { type: "M", point: clonePoint(outerEndpoints.start) },
      outerArc,
      { type: "L", point: clonePoint(innerEndpoints.end) },
      innerArc,
      { type: "Z" }
    ]
  };
}

function buildCircleBrushShape(segment, profile) {
  if (segment.kind === "line") {
    return buildCircleLineBrushShape(segment, profile);
  }

  if (segment.kind === "arc") {
    return buildCircleArcBrushShape(segment, profile);
  }

  return buildPolygonSweepShape(segment, createCircularStampPoints(profile.diameter / 2));
}

function buildRectangleBrushShape(segment, profile) {
  return buildPolygonSweepShape(segment, createRectangleStampPoints(profile));
}

export function buildBrushRenderShape(segment, brushOptions = {}) {
  const { profile } = normalizeBrushOptions(brushOptions);

  if (profile.kind === "segment") {
    return buildBrushSegmentShape(segment, {
      profile
    });
  }

  if (profile.kind === "circle") {
    return buildCircleBrushShape(segment, profile);
  }

  if (profile.kind === "rectangle") {
    return buildRectangleBrushShape(segment, profile);
  }

  throw new Error(`Unknown brush profile kind: ${profile.kind}`);
}

function renderFilledShape(group, shape, color) {
  if (shape.kind === "polygon") {
    group.polygon(shape.points.map(pointToSvg).join(" "))
      .fill(color)
      .stroke("none");
    return;
  }

  if (shape.kind === "path") {
    group.path(shapeCommandsToPath(shape.commands))
      .fill(color)
      .stroke("none");
    return;
  }

  if (shape.kind === "compound") {
    shape.shapes.forEach((child) => renderFilledShape(group, child, color));
    return;
  }

  throw new Error(`Unknown brush shape kind: ${shape.kind}`);
}

function renderStrokeSegment(group, segment, stroke) {
  if (segment.kind === "line") {
    group.line(segment.start[0], segment.start[1], segment.end[0], segment.end[1])
      .stroke(stroke)
      .attr({ "vector-effect": "non-scaling-stroke" });
    return;
  }

  if (segment.kind === "quadratic") {
    const path = [
      `M${pointToSvg(segment.start)}`,
      `Q${pointToSvg(segment.control)} ${pointToSvg(segment.end)}`
    ].join(" ");
    group.path(path)
      .fill("none")
      .stroke(stroke)
      .attr({ "vector-effect": "non-scaling-stroke" });
    return;
  }

  if (segment.kind === "arc") {
    const { start, end } = arcEndpoints(segment);
    const path = [
      `M${pointToSvg(start)}`,
      shapeCommandsToPath([arcCommandForSegment(segment, end)])
    ].join(" ");
    group.path(path)
      .fill("none")
      .stroke(stroke)
      .attr({ "vector-effect": "non-scaling-stroke" });
    return;
  }

  throw new Error(`Unknown segment kind: ${segment.kind}`);
}

function renderBrushSegment(group, segment, brush) {
  renderFilledShape(group, buildBrushRenderShape(segment, brush), brush.color);
}

export function renderSegments(group, segments, options = {}) {
  const renderOptions = normalizeRenderOptions(options);

  segments.forEach((segment) => {
    if (segment.visible === false) {
      return;
    }

    if (renderOptions.mode === "brush") {
      renderBrushSegment(group, segment, renderOptions.brush);
      return;
    }

    renderStrokeSegment(group, segment, renderOptions.stroke);
  });
}

export function renderGlyphNode(node, group, options = {}) {
  const compiled = compileGlyphNode(node);
  const fitted = fitSegmentsToTarget(
    compiled.segments,
    options.targetWidth || DEFAULT_SIZE,
    options.targetHeight || DEFAULT_SIZE
  );
  renderSegments(group, fitted, options);
  return fitted;
}
