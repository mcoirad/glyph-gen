import {
  DEFAULT_SIZE,
  compileGlyphNode,
  fitSegmentsToTarget
} from "./glyph-core.mjs";

const DEFAULT_STROKE = { width: 2, color: "#000" };
const DEFAULT_BRUSH = { angle: 30, thickness: 8, color: "#000" };

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

function sampleArcPoint(segment, angle) {
  const [rx, ry] = segment.radii;
  const localPoint = [Math.cos(angle) * rx, Math.sin(angle) * ry];
  const rotated = rotatePoint(localPoint, segment.rotation || 0);
  return translatePoint(rotated, segment.center[0], segment.center[1]);
}

function normalizeBrushOptions(brush = {}, fallbackColor = DEFAULT_STROKE.color) {
  return {
    angle: brush.angle ?? DEFAULT_BRUSH.angle,
    thickness: Math.max(0, brush.thickness ?? DEFAULT_BRUSH.thickness),
    color: brush.color || fallbackColor || DEFAULT_BRUSH.color
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

function brushHalfVector(brush) {
  const radians = (brush.angle * Math.PI) / 180;
  const halfThickness = brush.thickness / 2;
  return [
    Math.cos(radians) * halfThickness,
    Math.sin(radians) * halfThickness
  ];
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

export function buildBrushSegmentShape(segment, brushOptions = {}) {
  const brush = normalizeBrushOptions(brushOptions);
  const [dx, dy] = brushHalfVector(brush);
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
  const shape = buildBrushSegmentShape(segment, brush);

  if (shape.kind === "polygon") {
    group.polygon(shape.points.map(pointToSvg).join(" "))
      .fill(brush.color)
      .stroke("none");
    return;
  }

  if (shape.kind === "path") {
    group.path(shapeCommandsToPath(shape.commands))
      .fill(brush.color)
      .stroke("none");
    return;
  }

  throw new Error(`Unknown brush shape kind: ${shape.kind}`);
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
