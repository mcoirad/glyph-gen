const DEFAULT_SAMPLE_STEPS = 24;

function clonePoint([x, y]) {
  return [x, y];
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

export function sampleArcPoint(segment, angle) {
  const [rx, ry] = segment.radii;
  const localPoint = [Math.cos(angle) * rx, Math.sin(angle) * ry];
  const rotated = rotatePoint(localPoint, segment.rotation || 0);
  return translatePoint(rotated, segment.center[0], segment.center[1]);
}

export function sampleSegmentPoints(segment, steps = DEFAULT_SAMPLE_STEPS) {
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

export function getSegmentEndpoints(segment) {
  if (segment.kind === "line" || segment.kind === "quadratic") {
    return {
      start: clonePoint(segment.start),
      end: clonePoint(segment.end)
    };
  }

  if (segment.kind === "arc") {
    return {
      start: sampleArcPoint(segment, segment.startAngle),
      end: sampleArcPoint(segment, segment.endAngle)
    };
  }

  throw new Error(`Unknown segment kind: ${segment.kind}`);
}

export function endpointKey([x, y], decimals = 4) {
  return `${x.toFixed(decimals)},${y.toFixed(decimals)}`;
}
