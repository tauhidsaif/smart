(() => {
  const button = document.getElementById("boldToggle");
  const buttonText = document.getElementById("boldToggleText");
  const front = document.getElementById("frontPreview");
  const back = document.getElementById("backPreview");
  const frontLink = document.getElementById("frontPng");
  const backLink = document.getElementById("backPng");

  if (!button || !buttonText || !front || !back || !frontLink || !backLink) return;

  let bold = false;
  let originals = { front: "", back: "" };
  let processed = { front: "", back: "" };
  let busy = false;

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function isDark(r, g, b, a) {
    return a > 170 && r < 105 && g < 105 && b < 105;
  }

  function thickenText(source, side) {
    const canvas = document.createElement("canvas");
    canvas.width = source.naturalWidth;
    canvas.height = source.naturalHeight;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(source, 0, 0);

    const w = canvas.width;
    const h = canvas.height;
    const image = ctx.getImageData(0, 0, w, h);
    const src = image.data;
    const copy = new Uint8ClampedArray(src);

    // These are the information areas of the generated card. They intentionally
    // exclude the portrait, header artwork, QR code and footer icons.
    const box = side === "front"
      ? { x0: Math.floor(w * 0.29), y0: Math.floor(h * 0.22), x1: Math.floor(w * 0.91), y1: Math.floor(h * 0.89) }
      : { x0: Math.floor(w * 0.04), y0: Math.floor(h * 0.24), x1: Math.floor(w * 0.68), y1: Math.floor(h * 0.90) };

    const radius = Math.max(1, Math.round(Math.min(w, h) / 1500));
    const offsets = [];
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        if (dx * dx + dy * dy <= radius * radius) offsets.push([dx, dy]);
      }
    }

    for (let y = box.y0; y < box.y1; y += 1) {
      for (let x = box.x0; x < box.x1; x += 1) {
        const i = (y * w + x) * 4;
        if (!isDark(copy[i], copy[i + 1], copy[i + 2], copy[i + 3])) continue;

        for (const [dx, dy] of offsets) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < box.x0 || nx >= box.x1 || ny < box.y0 || ny >= box.y1) continue;
          const ni = (ny * w + nx) * 4;
          // Only thicken into near-white pixels. This avoids bleeding into
          // coloured artwork or changing existing non-text graphics.
          if (copy[ni] > 210 && copy[ni + 1] > 210 && copy[ni + 2] > 210) {
            src[ni] = 0;
            src[ni + 1] = 0;
            src[ni + 2] = 0;
            src[ni + 3] = 255;
          }
        }
      }
    }

    ctx.putImageData(image, 0, 0);
    return canvas.toDataURL("image/png");
  }

  function setDownload(link, dataUrl) {
    link.href = dataUrl;
  }

  async function applyOne(img, link, side) {
    if (!img.src || !img.complete || !img.naturalWidth) return;
    const original = originals[side];
    if (!original || original !== img.src) return;
    if (!bold) {
      if (processed[side]) {
        img.src = original;
        setDownload(link, original);
        processed[side] = "";
      }
      return;
    }
    if (processed[side] === original) return;

    const dataUrl = thickenText(img, side);
    processed[side] = original;
    img.src = dataUrl;
    setDownload(link, dataUrl);
  }

  async function refresh() {
    if (busy) return;
    busy = true;
    try {
      await wait(20);
      await applyOne(front, frontLink, "front");
      await applyOne(back, backLink, "back");
    } finally {
      busy = false;
    }
  }

  function rememberNewSource(img, side) {
    if (!img.src) return;
    if (processed[side] && img.src === processed[side]) return;
    originals[side] = img.src;
    processed[side] = "";
    if (bold) refresh();
  }

  const observer = new MutationObserver(() => {
    rememberNewSource(front, "front");
    rememberNewSource(back, "back");
  });
  observer.observe(front, { attributes: true, attributeFilter: ["src"] });
  observer.observe(back, { attributes: true, attributeFilter: ["src"] });

  button.addEventListener("click", () => {
    bold = !bold;
    button.setAttribute("aria-pressed", String(bold));
    buttonText.textContent = bold ? "Make all text normal" : "Make all text bold";
    if (!bold) {
      if (originals.front) front.src = originals.front;
      if (originals.back) back.src = originals.back;
      if (originals.front) setDownload(frontLink, originals.front);
      if (originals.back) setDownload(backLink, originals.back);
      processed.front = "";
      processed.back = "";
    } else {
      refresh();
    }
  });
})();
