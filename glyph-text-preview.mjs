export const PREVIEW_MODES = Object.freeze(["ltr", "rtl", "ttb", "boustrophedon"]);

export const DEFAULT_PREVIEW_LAYOUT = Object.freeze({
  glyphCellSize: 12,
  glyphGap: 1,
  wordGap: 4,
  lineGap: 10,
  paragraphGap: 18,
  paragraphCount: 2,
  inset: 14,
  minWordLength: 2,
  maxWordLength: 8,
  targetWordCount: 52,
  width: 560,
  height: 260
});

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
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

export function createPreviewBrush(brush) {
  const previewBrush = structuredClone(brush);
  const profile = previewBrush?.profile;

  if (!profile) {
    return previewBrush;
  }

  if (profile.kind === "segment") {
    profile.length = profile.length / 4;
  }

  if (profile.kind === "circle") {
    profile.diameter = profile.diameter / 4;
  }

  if (profile.kind === "rectangle") {
    profile.width = profile.width / 4;
    profile.height = profile.height / 4;
  }

  return previewBrush;
}

export function createPreviewCorpus({
  definitions,
  seed,
  sourceSetName,
  targetWordCount = DEFAULT_PREVIEW_LAYOUT.targetWordCount,
  minWordLength = DEFAULT_PREVIEW_LAYOUT.minWordLength,
  maxWordLength = DEFAULT_PREVIEW_LAYOUT.maxWordLength
}) {
  const glyphKeys = Object.keys(definitions || {});

  if (glyphKeys.length === 0) {
    return [];
  }

  const signature = glyphKeys
    .map((key) => `${key}:${definitions[key]}`)
    .join("|");
  const rng = createRng(`preview:${seed}:${sourceSetName}:${signature}`);
  const words = [];

  for (let index = 0; index < targetWordCount; index += 1) {
    const wordLength = minWordLength + Math.floor(rng() * (maxWordLength - minWordLength + 1));
    const glyphs = [];

    for (let glyphIndex = 0; glyphIndex < wordLength; glyphIndex += 1) {
      glyphs.push(glyphKeys[randomIndex(glyphKeys.length, rng)]);
    }

    words.push(glyphs);
  }

  return words;
}

function lineWidth(word, glyphCellSize, glyphGap) {
  if (word.length === 0) {
    return 0;
  }

  return (word.length * glyphCellSize) + ((word.length - 1) * glyphGap);
}

function columnHeight(word, glyphCellSize, glyphGap) {
  if (word.length === 0) {
    return 0;
  }

  return (word.length * glyphCellSize) + ((word.length - 1) * glyphGap);
}

function placeHorizontalWords(words, layout, direction = "ltr", alternate = false) {
  const placements = [];
  const {
    width,
    inset,
    glyphCellSize,
    glyphGap,
    wordGap,
    lineGap,
    paragraphGap,
    paragraphCount
  } = layout;
  const usableWidth = Math.max(glyphCellSize, width - (inset * 2));
  const lineHeight = glyphCellSize + lineGap;
  let rowIndex = 0;
  let cursorX = 0;
  let lineWords = [];
  let wordsPlaced = 0;
  const paragraphBreaks = new Set();

  if (paragraphCount > 1 && words.length > 0) {
    const wordsPerParagraph = Math.max(1, Math.ceil(words.length / paragraphCount));

    for (let paragraphIndex = 1; paragraphIndex < paragraphCount; paragraphIndex += 1) {
      paragraphBreaks.add(paragraphIndex * wordsPerParagraph);
    }
  }

  function flushLine() {
    const isRtl = alternate ? rowIndex % 2 === 1 : direction === "rtl";
    let lineCursor = isRtl ? width - inset : inset;

    lineWords.forEach((word) => {
      const wordWidth = lineWidth(word, glyphCellSize, glyphGap);
      if (isRtl) {
        lineCursor -= wordWidth;
      }

      word.forEach((key, glyphIndex) => {
        const x = isRtl
          ? lineCursor + wordWidth - glyphCellSize - (glyphIndex * (glyphCellSize + glyphGap))
          : lineCursor + (glyphIndex * (glyphCellSize + glyphGap));
        const y = inset + (rowIndex * lineHeight);
        placements.push({ key, x, y });
      });

      lineCursor += isRtl ? -wordGap : (wordWidth + wordGap);
    });

    rowIndex += 1;
    cursorX = 0;
    lineWords = [];
  }

  words.forEach((word) => {
    if (paragraphBreaks.has(wordsPlaced) && lineWords.length > 0) {
      flushLine();
      rowIndex += Math.max(1, Math.round(paragraphGap / Math.max(1, lineHeight)));
    }

    const wordWidth = lineWidth(word, glyphCellSize, glyphGap);
    if (lineWords.length > 0 && cursorX + wordWidth > usableWidth) {
      flushLine();
    }
    lineWords.push(word);
    cursorX += wordWidth + wordGap;
    wordsPlaced += 1;
  });

  if (lineWords.length > 0) {
    flushLine();
  }

  return placements;
}

function placeVerticalWords(words, layout) {
  const placements = [];
  const {
    width,
    height,
    inset,
    glyphCellSize,
    glyphGap,
    wordGap,
    paragraphGap,
    paragraphCount
  } = layout;
  const usableHeight = Math.max(glyphCellSize, height - (inset * 2));
  let columnIndex = 0;
  let cursorY = 0;
  let columnWords = [];
  let wordsPlaced = 0;
  const paragraphBreaks = new Set();

  if (paragraphCount > 1 && words.length > 0) {
    const wordsPerParagraph = Math.max(1, Math.ceil(words.length / paragraphCount));

    for (let paragraphIndex = 1; paragraphIndex < paragraphCount; paragraphIndex += 1) {
      paragraphBreaks.add(paragraphIndex * wordsPerParagraph);
    }
  }

  function flushColumn() {
    let columnCursor = inset;
    const x = width - inset - glyphCellSize - (columnIndex * (glyphCellSize + wordGap));

    columnWords.forEach((word) => {
      word.forEach((key, glyphIndex) => {
        placements.push({
          key,
          x,
          y: columnCursor + (glyphIndex * (glyphCellSize + glyphGap))
        });
      });
      columnCursor += columnHeight(word, glyphCellSize, glyphGap) + wordGap;
    });

    columnIndex += 1;
    cursorY = 0;
    columnWords = [];
  }

  words.forEach((word) => {
    if (paragraphBreaks.has(wordsPlaced) && columnWords.length > 0) {
      flushColumn();
      columnIndex += Math.max(1, Math.round(paragraphGap / Math.max(1, glyphCellSize + wordGap)));
    }

    const wordHeight = columnHeight(word, glyphCellSize, glyphGap);
    if (columnWords.length > 0 && cursorY + wordHeight > usableHeight) {
      flushColumn();
    }
    columnWords.push(word);
    cursorY += wordHeight + wordGap;
    wordsPlaced += 1;
  });

  if (columnWords.length > 0) {
    flushColumn();
  }

  return placements;
}

export function createPreviewPlacements(words, mode, options = {}) {
  const layout = {
    ...DEFAULT_PREVIEW_LAYOUT,
    ...options
  };

  if (mode === "rtl") {
    return placeHorizontalWords(words, layout, "rtl");
  }

  if (mode === "ttb") {
    return placeVerticalWords(words, layout);
  }

  if (mode === "boustrophedon") {
    return placeHorizontalWords(words, layout, "ltr", true);
  }

  return placeHorizontalWords(words, layout, "ltr");
}

export function createPreviewLayoutOptions(width, height) {
  return {
    ...DEFAULT_PREVIEW_LAYOUT,
    width,
    height,
    glyphCellSize: clamp(Math.floor(width / 36), 8, 14),
    inset: clamp(Math.floor(width / 42), 10, 16),
    glyphGap: clamp(Math.floor(width / 320), 1, 3),
    wordGap: clamp(Math.floor(width / 110), 3, 6),
    lineGap: clamp(Math.floor(height / 28), 6, 12),
    paragraphGap: clamp(Math.floor(height / 16), 14, 26)
  };
}
