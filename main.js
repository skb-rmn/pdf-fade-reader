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

  for (const block of struct.blocks) {
    // Add placeholder for big vertical gaps (non-text / images / diagrams)
    if (lastY !== null && block.yGap && block.yGap > 40) {
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
    if (typeof x !== "number" || typeof y !== "number") continue;
    pts.push({ x });
  }

  if (pts.length < 30) return { mode: "single", cols: [items] };

  const xs = pts.map(p => p.x).sort((a, b) => a - b);
  const minX = xs[0];
  const maxX = xs[xs.length - 1];
  const width = maxX - minX;

  if (width < 200) return { mode: "single", cols: [items] };

  const mid = (minX + maxX) / 2;

  const left = items.filter(it => (it.transform?.[4] ?? 0) < mid);
  const right = items.filter(it => (it.transform?.[4] ?? 0) >= mid);

  if (left.length < items.length * 0.2 || right.length < items.length * 0.2) {
    return { mode: "single", cols: [items] };
  }

  return { mode: "two", cols: [left, right] };
}

function reconstructStructure(textContent) {
  const items = textContent.items;

  function buildBlocksFromItems(itemsForOneFlow) {
    const yTol = 2;
    const lines = [];

    for (const it of itemsForOneFlow) {
      const s = (it.str ?? "").trimEnd();
      if (!s) continue;

      const x = it.transform[4];
      const y = it.transform[5];
      const h = it.height || 0;

      let line = lines.find(L => Math.abs(L.y - y) <= yTol);
      if (!line) {
        line = { y, parts: [], avgHeight: 0, text: "" };
        lines.push(line);
      }
      line.parts.push({ x, y, h, s });
    }

    lines.sort((a, b) => b.y - a.y);

    const builtLines = lines.map(line => {
      line.parts.sort((a, b) => a.x - b.x);
      const avgH =
        line.parts.reduce((sum, p) => sum + p.h, 0) / Math.max(1, line.parts.length);

      let text = "";
      let prev = null;

      for (const p of line.parts) {
        if (prev) {
          const gap = p.x - prev.x;
          const spaceThresh = Math.max(4, avgH * 0.6);
          if (gap > spaceThresh) text += " ";
        }
        text += p.s;
        prev = p;
      }    

      return {
        y: line.y,
        avgHeight: avgH,
        text: text.replace(/\s+/g, " ").trim(),
      };
    }).filter(l => l.text.length > 0);

    // Estimate typical body font size (median height)
    if (builtLines.length > 0) {
      const heights = builtLines
        .map(l => l.avgHeight)
        .sort((a, b) => a - b);

      estimatedBodyFont = heights[Math.floor(heights.length / 2)];
    }

    const blocks = [];
    let prevLine = null;
    let currentPara = null;

    for (const line of builtLines) {
      const yGap = prevLine ? (prevLine.y - line.y) : 0;

      const heading = isHeadingLike(line) && (!prevLine || yGap > 18);

      if (heading) {
        if (currentPara) {
          blocks.push({ type: "para", text: currentPara.text, y: currentPara.y, yGap: currentPara.yGap });
          currentPara = null;
        }
        blocks.push({ type: "heading", text: line.text, y: line.y, yGap });
      } else {
        const newPara = !currentPara || yGap > 16;

        if (newPara) {
          if (currentPara) {
            blocks.push({ type: "para", text: currentPara.text, y: currentPara.y, yGap: currentPara.yGap });
          }
          currentPara = { text: line.text, y: line.y, yGap };
        } else {
          if (currentPara.text.endsWith("-")) {
            currentPara.text =
              currentPara.text.slice(0, -1) + line.text;
          } else {
            currentPara.text += " " + line.text;
          }
        }
      }

      prevLine = line;
    }

    if (currentPara) {
      blocks.push({ type: "para", text: currentPara.text, y: currentPara.y, yGap: currentPara.yGap });
    }

    return { blocks };
  }

  const { mode, cols } = splitIntoColumns(items);

  if (mode === "single") {
    return buildBlocksFromItems(cols[0]);
  }

  const left = buildBlocksFromItems(cols[0]);
  const right = buildBlocksFromItems(cols[1]);

  const merged = [...left.blocks, ...right.blocks];
  merged.sort((a, b) => b.y - a.y);
  return { blocks: merged };

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
  if (!pdfDoc) return;

  isRendering = true;

  try {
    const page = await pdfDoc.getPage(pageNumber);

    // 1) Reading mode (your main goal)
    reading.innerHTML = "Extracting text…";
    const textContent = await page.getTextContent();
    const struct = reconstructStructure(textContent);
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
