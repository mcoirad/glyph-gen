import {
  generateGlyphSet,
  validateSetGrammar
} from "./glyph-generate.mjs";

function labelForSource(source) {
  const labels = {
    phoenician: "Phoenician",
    futhorc: "Futhorc",
    roman: "Roman"
  };

  return labels[source] || source || "source";
}

function formatProgressMessage(progress, request) {
  const sourceLabel = labelForSource(request?.source);

  switch (progress?.stage) {
    case "prepare":
      return `Preparing ${sourceLabel}-derived generation grammar…`;
    case "set-attempt":
      return `Exploring alphabet attempt ${progress.setAttempt} of ${progress.totalSetAttempts}…`;
    case "glyph":
      return `Scoring glyph ${progress.glyphIndex} of ${progress.totalGlyphs} for attempt ${progress.setAttempt}…`;
    case "set-evaluated":
      return `Reviewing candidate set ${progress.setAttempt} of ${progress.totalSetAttempts} (${progress.acceptedCount}/${progress.totalGlyphs} accepted, ${progress.repeatedGlyphCount} related glyphs)…`;
    default:
      return `Generating a ${sourceLabel}-derived sibling alphabet…`;
  }
}

self.addEventListener("message", (event) => {
  const { type, requestId, request } = event.data || {};

  if (type !== "generate" || !requestId || !request) {
    return;
  }

  try {
    self.postMessage({
      type: "progress",
      requestId,
      message: `Validating ${labelForSource(request.source)}-derived generation settings…`
    });

    validateSetGrammar(request.grammar);

    const result = generateGlyphSet({
      grammar: request.grammar,
      seed: request.seed,
      maxAttemptsPerGlyph: request.maxAttemptsPerGlyph,
      maxSetAttempts: request.maxSetAttempts,
      onProgress(progress) {
        self.postMessage({
          type: "progress",
          requestId,
          message: formatProgressMessage(progress, request)
        });
      }
    });

    self.postMessage({
      type: "result",
      requestId,
      result
    });
  } catch (error) {
    self.postMessage({
      type: "error",
      requestId,
      error: error instanceof Error ? error.message : String(error)
    });
  }
});
