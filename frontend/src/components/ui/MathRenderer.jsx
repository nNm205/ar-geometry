import React, { useRef } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";

// Preprocesses raw LaTeX commands that are not wrapped in $ or $$
const autoWrapRawLaTeX = (text) => {
  if (!text) return "";

  // Mask blocks that are already inside $...$ or $$...$$ to avoid double wrapping
  const placeholders = [];
  let temp = text;

  // Mask $$...$$ (display math)
  temp = temp.replace(/\$\$(.*?)\$\$/gs, (match) => {
    placeholders.push(match);
    return `___MATH_PLACEHOLDER_${placeholders.length - 1}___`;
  });

  // Mask $...$ (inline math)
  temp = temp.replace(/\$(.*?)\$/g, (match) => {
    placeholders.push(match);
    return `___MATH_PLACEHOLDER_${placeholders.length - 1}___`;
  });

  // Apply regexes to wrap raw LaTeX in $...$

  // 1. Angle: e.g. \angle IMS or \angle A or \angle ABC
  temp = temp.replace(/\\angle\s*([A-Za-z0-9_{}]+)/g, "$\\angle $1$");

  // 2. Degree: e.g. 90^\circ or 90\circ or 90 ^ \circ or a^\circ
  temp = temp.replace(/([a-zA-Z0-9_]+)\s*\^?\s*\\circ/g, "$$1^\\circ$");

  // 3. Fraction: e.g. \frac{1}{2} or \frac{a}{b}
  temp = temp.replace(/\\frac\s*(\{[^{}]*\}\s*\{[^{}]*\})/g, "$\\frac$1$");

  // 4. Square root: e.g. \sqrt{3} or \sqrt{a}
  temp = temp.replace(/\\sqrt\s*(\{[^{}]*\})/g, "$\\sqrt$1$");
  temp = temp.replace(/\\sqrt\s*([a-zA-Z0-9_]+)/g, "$\\sqrt{$1}$");

  // 5. Relations: e.g. SA \perp (ABCD) or SA \perp BC or (SBC) \perp (ABCD)
  temp = temp.replace(
    /([A-Z0-9_]+(?:\s*\([^)]+\))?|\([^)]+\))\s*\\perp\s*([A-Z0-9_]+(?:\s*\([^)]+\))?|\([^)]+\))/g,
    "$$1 \\perp $2$"
  );
  temp = temp.replace(
    /([A-Z0-9_]+(?:\s*\([^)]+\))?|\([^)]+\))\s*\\parallel\s*([A-Z0-9_]+(?:\s*\([^)]+\))?|\([^)]+\))/g,
    "$$1 \\parallel $2$"
  );

  // 6. Standalone commands (if any are left unwrapped): e.g. \perp, \parallel, \Delta, \cdot
  temp = temp.replace(/\\perp(?!_)/g, "$\\perp$");
  temp = temp.replace(/\\parallel(?!_)/g, "$\\parallel$");
  temp = temp.replace(/\\Delta\s*([A-Za-z0-9_]+)/g, "$\\Delta $1$");
  temp = temp.replace(/\\cdot/g, "$\\cdot$");

  // Restore placeholders
  return temp.replace(/___MATH_PLACEHOLDER_(\d+)___/g, (_, index) => {
    return placeholders[parseInt(index, 10)];
  });
};

export default function MathRenderer({ text }) {
  const containerRef = useRef(null);

  const renderMathText = (rawText) => {
    if (!rawText) return "";

    // Auto-wrap raw LaTeX commands that don't have $ symbols
    const preprocessed = autoWrapRawLaTeX(rawText);

    // Split by $$ (display math) first
    const displayParts = preprocessed.split("$$");
    return displayParts
      .map((displayPart, idx) => {
        if (idx % 2 === 1) {
          // Inside $$...$$
          try {
            return `<div class="katex-display-wrapper" style="margin: 12px 0; overflow-x: auto; text-align: center;">${katex.renderToString(
              displayPart,
              { displayMode: true, throwOnError: false }
            )}</div>`;
          } catch (err) {
            return `$$${displayPart}$$`;
          }
        } else {
          // Outside $$...$$, now split by $ (inline math)
          const inlineParts = displayPart.split("$");
          return inlineParts
            .map((inlinePart, inlineIdx) => {
              if (inlineIdx % 2 === 1) {
                // Inside $...$
                try {
                  return katex.renderToString(inlinePart, {
                    displayMode: false,
                    throwOnError: false,
                  });
                } catch (err) {
                  return `$${inlinePart}$`;
                }
              } else {
                return inlinePart;
              }
            })
            .join("");
        }
      })
      .join("");
  };

  // A very basic markdown parser to format lists, headers, bold text and blocks
  const formatMarkdownToHTML = (rawText) => {
    if (!rawText) return "";

    // Escape basic HTML tags to prevent injections but keep LaTeX backslashes intact
    let html = rawText
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    // Render KaTeX math formulas
    html = renderMathText(html);

    // Headings: e.g. "### Bước 1: ..."
    html = html.replace(
      /^### (.*?)$/gm,
      '<h4 class="math-h4" style="color:var(--cyan); font-weight:600; margin-top:16px; margin-bottom:8px; font-size:15px; border-left: 3px solid var(--cyan); padding-left: 8px;">$1</h4>'
    );
    html = html.replace(
      /^## (.*?)$/gm,
      '<h3 class="math-h3" style="color:var(--text); font-weight:700; margin-top:20px; margin-bottom:10px; font-size:17px; border-bottom: 1px solid var(--border); padding-bottom: 6px;">$1</h3>'
    );
    html = html.replace(
      /^# (.*?)$/gm,
      '<h2 class="math-h2" style="color:var(--text); font-weight:800; margin-top:24px; margin-bottom:12px; font-size:20px;">$1</h2>'
    );

    // Bold: **text**
    html = html.replace(
      /\*\*(.*?)\*\*/g,
      '<strong style="color:var(--text); font-weight:600;">$1</strong>'
    );

    // Bullet points: lines starting with "- " or "* "
    html = html.replace(
      /^(?:-|\*)\s+(.*?)$/gm,
      '<li style="margin-left: 20px; margin-bottom: 6px; list-style-type: disc;">$1</li>'
    );

    // Numbered lists: lines starting with e.g. "1. " or "2. "
    html = html.replace(
      /^(\d+)\.\s+(.*?)$/gm,
      '<li style="margin-left: 20px; margin-bottom: 6px; list-style-type: decimal;">$2</li>'
    );

    // Paragraph splits by double newlines, ignoring list items, headings, and div blocks
    const lines = html.split("\n");
    const processedLines = lines.map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return "";
      // If it's already an HTML block tag (li, h2, h3, h4, div), return as is
      if (
        trimmed.startsWith("<li") ||
        trimmed.startsWith("<h") ||
        trimmed.startsWith("<ul") ||
        trimmed.startsWith("<ol") ||
        trimmed.startsWith("<div")
      ) {
        return line;
      }
      return `<p style="margin-bottom: 12px; color: var(--text2); text-align: justify; text-justify: inter-word; line-height: 1.7;">${line}</p>`;
    });

    return processedLines.join("\n");
  };

  return (
    <div
      ref={containerRef}
      className="math-renderer-content"
      style={{
        lineHeight: "1.7",
        fontSize: "14px",
        color: "var(--text2)",
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
      dangerouslySetInnerHTML={{ __html: formatMarkdownToHTML(text) }}
    />
  );
}

