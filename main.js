import * as pdfjsLib from "https://unpkg.com/pdfjs-dist@4.10.38/build/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://unpkg.com/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";

const fileInput = document.getElementById("file");
const prevBtn = document.getElementById("prev");
const nextBtn = document.getElementById("next");
const pageInfo = document.getElementById("pageInfo");

const fadeSlider = document.getElementById("fade");
const fadeVal = document.getElementById("fadeVal");

const reading = document.getElementById("reading");
const viewer = document.getElementById("viewer");

const showOriginal = document.getElementById("showOriginal");
const layout = document.querySelector(".layout");
const originalPane = document.getElementById("originalPane");

const fadeStartSlider = document.getElementById("fadeStart");
const fadeStartVal = document.getElementById("fadeStartVal");
const forceSingleCol = document.getElementById("forceSingleCol");

let pdfDoc = null;
let currentPage = 1;
let isRendering = false;
let pendingPage = null;

let fadeStart = parseFloat(fadeStartSlider.value);

let forceSingle = false;

let estimatedBodyFont = 0;

function getBodyFontEstimate() {
  return estimatedBodyFont || 10;
}

fadeStartVal.textContent = fadeStart.toFixed(2);

forceSingleCol.addEventListener("change", () => {
  forceSingle = forceSingleCol.checked;
  if (pdfDoc) queueRender(currentPage);
});

function setFadeOpacity(v) {
  document.documentElement.style.setProperty("--fadeOpacity", v);
  fadeVal.textContent = v;
}

setFadeOpacity(fadeSlider.value);

fadeSlider.addEventListener("input", () => {
  setFadeOpacity(fadeSlider.value);
});

fadeStartSlider.addEventListener("input", () => {
  fadeStart = parseFloat(fadeStartSlider.value);
  fadeStartVal.textContent = fadeStart.toFixed(2);
  // re-render current page for clean update
  if (pdfDoc) queueRender(currentPage);
});

showOriginal.addEventListener("change", () => {
  layout.classList.toggle("showOriginal", showOriginal.checked);
  // re-render original if user just enabled it
  if (pdfDoc) queueRender(currentPage);
});

fileInput.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;

  const arrayBuffer = await file.arrayBuffer();
  pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  currentPage = 1;
  updateUI();
  queueRender(currentPage);
});

prevBtn.addEventListener("click", () => {
  if (!pdfDoc || currentPage <= 1) return;
  currentPage--;
  updateUI();
  queueRender(currentPage);
});

nextBtn.addEventListener("click", () => {
  if (!pdfDoc || currentPage >= pdfDoc.numPages) return;
  currentPage++;
  updateUI();
  queueRender(currentPage);
});

function updateUI() {
  if (!pdfDoc) {
    pageInfo.textContent = "Page 0 / 0";
    prevBtn.disabled = true;
    nextBtn.disabled = true;
    return;
  }
  pageInfo.textContent = `Page ${currentPage} / ${pdfDoc.numPages}`;
  prevBtn.disabled = currentPage <= 1;
  nextBtn.disabled = currentPage >= pdfDoc.numPages;
}

function queueRender(pageNumber) {
  if (isRendering) {
    pendingPage = pageNumber;
  } else {
    renderPage(pageNumber);
  }
}

// ---------- Reading-mode extraction ----------

function fadeWord(word) {
  const half = Math.ceil(word.length * fadeStart);
  const first = word.slice(0, half);
  const second = word.slice(half);

  const span = document.createElement("span");
  span.appendChild(document.createTextNode(first));

  if (second) {
    const tail = document.createElement("span");
    tail.className = "fadeTail";
    tail.textContent = second;
    span.appendChild(tail);
  }
  return span;
}

function isHeadingLike(line) {
  const text = line.text.trim();

  // Empty lines are not headings
  if (!text) return false;

  // Detect numbered headings: "2", "2.1", "3 Background"
  if (/^\d+(\.\d+)*\s+[A-Z]/.test(text)) return true;

  // Detect single number section headings: "2"
  if (/^\d+(\.\d+)*$/.test(text)) return true;

  // Detect ALL CAPS short lines
  if (text.length < 80 && text === text.toUpperCase() && /[A-Z]/.test(text)) {
    return true;
  }

  // Detect "Abstract"
  if (/^abstract$/i.test(text)) return true;

  // Font-size based fallback
  if (line.avgHeight > 1.3 * getBodyFontEstimate()) {
    return true;
  }

  return false;
}

function buildReadingDOM(struct) {
  reading.innerHTML = "";

  let lastY = null;
  let seenBodyPara = false;

  for (const block of struct.blocks) {
    // Add placeholder for big vertical gaps (non-text / images / diagrams)
    if (
      seenBodyPara &&
      lastY !== null &&
      block.section === "body" &&
      block.yGap &&
      block.yGap > 60 &&
      block.type === "para"
    ) {
      const nontext = document.createElement("div");
      nontext.className = "nontext";
      nontext.textContent = "[Non-text content here (image/table/diagram)]";
      reading.appendChild(nontext);
    }

    if (block.type === "heading") {
      const h = document.createElement("h2");
      appendFadedText(h, block.text);
      reading.appendChild(h);
    } else {
      const p = document.createElement("p");
      appendFadedText(p, block.text);
      reading.appendChild(p);
    }

    if (block.section === "body" && block.type === "para") {
      seenBodyPara = true;
    }

    lastY = block.y;
  }
}

function appendFadedText(el, text) {
  // keep punctuation with word; split on spaces
  const tokens = text.split(/\s+/).filter(Boolean);
  tokens.forEach((t, i) => {
    el.appendChild(fadeWord(t));
    if (i !== tokens.length - 1) el.appendChild(document.createTextNode(" "));
  });
}

function splitIntoColumns(items) {
  if (forceSingle) return { mode: "single", cols: [items] };

  const pts = [];

  for (const it of items) {
    const s = (it.str ?? "").trim();
    if (!s) continue;

    const x = it.transform?.[4];
    const y = it.transform?.[5];
    const h = it.height || 0;

    if (typeof x !== "number" || typeof y !== "number") continue;

    pts.push({ x, y, h });
  }

  if (pts.length < 50) return { mode: "single", cols: [items] };

  // Estimate body font height (median)
  const heights = pts.map(p => p.h).sort((a,b)=>a-b);
  const bodyH = heights[Math.floor(heights.length / 2)];

  // Filter likely body text
  const bodyPts = pts.filter(p => p.h <= bodyH * 1.2);

  if (bodyPts.length < 30) return { mode: "single", cols: [items] };

  const xs = bodyPts.map(p => p.x).sort((a,b)=>a-b);

  const minX = xs[0];
  const maxX = xs[xs.length - 1];
  const width = maxX - minX;

  // 🔥 adaptive width check instead of fixed 250
  if (width < bodyH * 15) {
    return { mode: "single", cols: [items] };
  }

  // Detect largest horizontal gap (true column separator)
  let maxGap = 0;
  let gapIndex = -1;

  for (let i = 1; i < xs.length; i++) {
    const gap = xs[i] - xs[i - 1];
    if (gap > maxGap) {
      maxGap = gap;
      gapIndex = i;
    }
  }

  // If no strong gap → single column
  // Require a substantial whitespace gap
  if (maxGap < width * 0.15) {
    return { mode: "single", cols: [items] };
  }

  // Separator is between these two X clusters
  const separator = (xs[gapIndex - 1] + xs[gapIndex]) / 2;

  const left = [];
  const right = [];

  for (const it of items) {
    const x = it.transform?.[4];
    if (typeof x !== "number") continue;

    if (x < separator) left.push(it);
    else right.push(it);
  }

  // Validate real separation using X-centroids
  const leftXs = left.map(it => it.transform?.[4]).filter(x=>typeof x==="number");
  const rightXs = right.map(it => it.transform?.[4]).filter(x=>typeof x==="number");

  if (!leftXs.length || !rightXs.length) {
    return { mode: "single", cols: [items] };
  }

  const leftAvg = leftXs.reduce((a,b)=>a+b,0)/leftXs.length;
  const rightAvg = rightXs.reduce((a,b)=>a+b,0)/rightXs.length;

  // 🔥 If columns are too close, it's actually single
  if (Math.abs(rightAvg - leftAvg) < bodyH * 10) {
    return { mode: "single", cols: [items] };
  }

  return { mode: "two", cols: [left, right] };
}

function normalizeLineText(raw) {
  let t = raw ?? "";

  // 0) normalize common PDF hyphen/dash glyphs to ASCII '-'
  t = t.replace(/[\u2010\u2011\u2012\u2013\u2212]/g, "-"); // ‐-‒–−

  // 1) remove soft hyphen (common in PDFs)
  t = t.replace(/\u00AD/g, "");

  // 2) collapse whitespace
  t = t.replace(/\s{2,}/g, " ").trim();

  // 3) fix bullet spacing (•Something -> • Something)
  t = t.replace(/^•\s*/, "• ");

  // 4) SAFE de-hyphenation ONLY when it looks like a broken word:
  // "stud- ies" -> "studies"
  t = t.replace(/([A-Za-z])-\s+([A-Za-z])/g, (m, a, b) => {
    if (b === b.toLowerCase()) return a + b; // broken word
    return a + "-" + b;                       // keep real hyphen
  });

  return t;
}

function buildBlocksFromItems(itemsForOneFlow) {
  const yTol = 2;
  const lines = [];

  for (const it of itemsForOneFlow) {
    const s = (it.str ?? "").trimEnd();
    if (!s) continue;

    const x = it.transform?.[4];
    const y = it.transform?.[5];
    const h = it.height || 0;

    if (typeof x !== "number" || typeof y !== "number") continue;

    let line = lines.find((L) => {
      if (Math.abs(L.y - y) > yTol) return false;

      // NEW: prevent cross-column merge
      const existingX = L.parts[0]?.x ?? 0;
      return Math.abs(existingX - x) < 200; // column separation threshold
    });

    if (!line) {
      line = { y, parts: [], avgHeight: 0 };
      lines.push(line);
    }

    const w = typeof it.width === "number" ? it.width : 0;
    line.parts.push({ x, y, h, w, s });
  }

  // sort lines top → bottom
  lines.sort((a, b) => b.y - a.y);

  const builtLines = lines
    .map((line) => {
      line.parts.sort((a, b) => a.x - b.x);

      const avgH =
        line.parts.reduce((sum, p) => sum + p.h, 0) /
        Math.max(1, line.parts.length);

      let text = "";
      let prev = null;

      for (const p of line.parts) {
        const raw = (p.s ?? "");
        if (!raw) continue;

        // Detect if PDF.js embedded a leading space inside the fragment (very common)
        const hadLeadingWS = /^\s+/.test(raw);

        // Strip leading whitespace; we decide spaces ourselves
        const cur = raw.replace(/^\s+/, "");
        if (!cur) continue;

        if (prev) {
          // measure gap from end of previous fragment, not its start
          const prevEndX = prev.x + (prev.w || 0);
          const gap = p.x - prevEndX;

          const spaceThresh = Math.max(4, avgH * 0.6);
          const tinyGap = gap >= -1 && gap < avgH * 0.35;

          const prevRaw = (prev.s ?? "");
          const prevTrim = prevRaw.trim();
          const prevLast = prevTrim.slice(-1);
          const curFirst = cur.charAt(0);

          const prevAllCapsShort = /^[A-Z]{2,5}$/.test(prevTrim);
          const curStartsLower = /^[a-z]/.test(curFirst);

          const curIsPunct = /^[,.;:!?)]/.test(curFirst);

          // 1) If the PDF fragment itself had leading whitespace, respect it (but normalize to ONE space)
          if (hadLeadingWS && !text.endsWith(" ") && !curIsPunct) {
            text += " ";
          }
          // 2) glue lowercase fragments when gap is tiny: "Nat"+"ral" => "Natral"
          else if (tinyGap && /[a-z]/.test(prevLast) && /[a-z]/.test(curFirst)) {
            // glue (no space)
          }
          // 3) acronym + lowercase fragment should have space: "HCI"+"ral" => "HCI ral"
          else if (tinyGap && prevAllCapsShort && curStartsLower) {
            if (!text.endsWith(" ")) text += " ";
          }
          // 4) normal spacing from geometry
          else if (gap > spaceThresh) {
            if (!text.endsWith(" ") && !curIsPunct) text += " ";
          }
        }

        text += cur;
        prev = p;
      }

      return {
        y: line.y,
        x: line.parts[0]?.x || 0,
        avgHeight: avgH,
        text: normalizeLineText(text),
      };
    })
    .filter((l) => l.text.length > 0);

  // Update estimated body font once per page/flow (median line height)
  if (builtLines.length) {
    const hs = builtLines.map(l => l.avgHeight).sort((a,b) => a-b);
    estimatedBodyFont = hs[Math.floor(hs.length / 2)] || estimatedBodyFont;
  }

  const blocks = [];
  let prevLine = null;
  let currentPara = null;

  for (const line of builtLines) {
    const yGap = prevLine ? prevLine.y - line.y : 0;

    const heading = isHeadingLike(line) && (!prevLine || yGap > 18);

    if (heading) {
      if (currentPara) {
        blocks.push({
          type: "para",
          text: currentPara.text,
          y: currentPara.y,
          yGap: currentPara.yGap,
        });
        currentPara = null;
      }

      blocks.push({
        type: "heading",
        text: line.text,
        y: line.y,
        x: line.x,
        yGap,
      });
    } else {
      const newPara = !currentPara || yGap > estimatedBodyFont * 1.4;

      if (newPara) {
        if (currentPara) {
          blocks.push({
            type: "para",
            text: currentPara.text,
            y: currentPara.y,
            x: line.x,
            yGap: currentPara.yGap,
          });
        }

        currentPara = {
          text: line.text,
          y: line.y,
          x: line.x || 0,
          yGap,
        };
      } else {
        if (/[‐-‒–−-]$/.test(currentPara.text)) {
          // join hyphenated line-break words: "capabilit-" + "ies" => "capabilities"
          currentPara.text = currentPara.text.replace(/[‐-‒–−-]$/, "") + line.text.trimStart();
        } else {
          currentPara.text += " " + line.text;
        }
        currentPara.text = normalizeLineText(currentPara.text);
      }
    }

    prevLine = line;
  }

  if (currentPara) {
    blocks.push({
      type: "para",
      text: currentPara.text,
      y: currentPara.y,
      yGap: currentPara.yGap,
    });
  }

  return { blocks };
}

function reconstructStructure(textContent) {
  const items = textContent.items;

  // --- split header vs body by font height (always) ---
  const allHeights = items
    .map((it) => it.height || 0)
    .filter((h) => h > 0)
    .sort((a, b) => a - b);

  const medianH = allHeights[Math.floor(allHeights.length / 2)] || 10;

  const headerItems = [];
  const bodyItems = [];

  for (const it of items) {
    const h = it.height || 0;
    if (h > medianH * 1.3) {
      headerItems.push(it);
    } else {
      const txt = (it.str || "").trim();

      // FILTER NAVIGATION / PAGE CHROME
      if (
        /Table of Contents/i.test(txt) ||
        /^previous$/i.test(txt) ||
        /^next$/i.test(txt) ||
        /^\|\s*$/.test(txt)
      ) {
        continue;
      }
      bodyItems.push(it);
    }
  }

  const headerStruct = buildBlocksFromItems(headerItems);
  headerStruct.blocks.forEach(b => (b.section = "header"));

  // --- BODY ---
  // If forceSingle: skip column logic but still use body-only
  if (forceSingle) {
    const bodyStruct = buildBlocksFromItems(bodyItems);
    bodyStruct.blocks.forEach(b => (b.section = "body"));
    return { blocks: [...headerStruct.blocks, ...bodyStruct.blocks] };
  }

  const { mode, cols } = splitIntoColumns(bodyItems);

  if (mode === "two") {
    const leftStruct = buildBlocksFromItems(cols[0]);
    const rightStruct = buildBlocksFromItems(cols[1]);

    leftStruct.blocks.forEach(b => (b.section = "body"));
    rightStruct.blocks.forEach(b => (b.section = "body"));

    // 🧠 Academic PDF reading order:
    // Entire LEFT column first
    // Then entire RIGHT column

    return {
      blocks: [
        ...headerStruct.blocks,
        ...leftStruct.blocks,
        ...rightStruct.blocks
      ]
    };
  }

  const bodyStruct = buildBlocksFromItems(bodyItems);
  bodyStruct.blocks.forEach(b => (b.section = "body"));
  return { blocks: [...headerStruct.blocks, ...bodyStruct.blocks] };
}
// ---------- Optional original view (side) ----------

async function renderOriginalCanvas(page) {
  viewer.innerHTML = "";

  const viewport = page.getViewport({ scale: 1.2 });

  const pageDiv = document.createElement("div");
  pageDiv.className = "page";

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  pageDiv.appendChild(canvas);

  viewer.appendChild(pageDiv);

  await page.render({ canvasContext: ctx, viewport }).promise;
}

// ---------- Main render ----------

async function renderPage(pageNumber) {
  reading.scrollTop = 0;

  if (!pdfDoc) return;

  isRendering = true;

  try {
    const page = await pdfDoc.getPage(pageNumber);

    // 1) Reading mode (your main goal)
    reading.innerHTML = "Extracting text…";
    const textContent = await page.getTextContent();
    const struct = reconstructStructure(textContent);
    console.log(struct);
    buildReadingDOM(struct);

    // 2) Optional original view
    if (showOriginal.checked) {
      await renderOriginalCanvas(page);
      originalPane.style.display = "block";
    } else {
      viewer.innerHTML = "";
      originalPane.style.display = "none";
    }
  } catch (e) {
    console.error(e);
    reading.innerHTML = `<div class="nontext">Error extracting page. Check console.</div>`;
  }

  isRendering = false;

  if (pendingPage !== null) {
    const next = pendingPage;
    pendingPage = null;
    renderPage(next);
  }
}

document.addEventListener("keydown", (e) => {
  if (e.key === "ArrowRight") nextBtn.click();
  if (e.key === "ArrowLeft") prevBtn.click();
});
