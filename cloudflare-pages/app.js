import * as pdfjsLib from "https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/build/pdf.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/build/pdf.worker.mjs";

const $ = (id) => document.getElementById(id);

const fileInput = $("pdfFile");
const fileName = $("fileName");
const passwordInput = $("pdfPassword");
const generateBtn = $("generateBtn");
const generateBtnText = $("generateBtnText");
const spinner = $("spinner");
const statusBox = $("status");
const boldToggle = $("boldToggle");
const boldToggleText = $("boldToggleText");
const photoSettingsOpenBtn = $("photoSettingsOpenBtn");
const photoSettingsDialog = $("photoSettingsDialog");
const closePhotoSettings = $("closePhotoSettings");
const cancelPhotoSettings = $("cancelPhotoSettings");
const savePhotoSettings = $("savePhotoSettings");
const photoSettingsPreview = $("photoSettingsPreview");
const photoPreviewPlaceholder = $("photoPreviewPlaceholder");
const photoSettingsStatus = $("photoSettingsStatus");
const photoBrightness = $("photoBrightness");
const photoBrightnessValue = $("photoBrightnessValue");
const photoContrast = $("photoContrast");
const photoContrastValue = $("photoContrastValue");
const photoBorder = $("photoBorder");
const photoBorderWidth = $("photoBorderWidth");
const photoBorderWidthValue = $("photoBorderWidthValue");
const photoBorderColor = $("photoBorderColor");
const resetPhotoSettings = $("resetPhotoSettings");
const dobPanel = $("dobPanel");
const fullDobInput = $("fullDob");
const results = $("results");
const frontPreview = $("frontPreview");
const backPreview = $("backPreview");
const frontPng = $("frontPng");
const backPng = $("backPng");
const downloadPdfBtn = $("downloadPdfBtn");

let addressBold = false;
let staged = null;
let generated = null;
let isBusy = false;
let hindiFontReady = false;
let photoSettingsSnapshot = null;
let savedPhotoSettings = {
  brightness: 1.25,
  contrast: 1.35,
  borderEnabled: true,
  borderWidth: 12,
  borderColor: "#111827",
};

const TEMPLATE_PATHS = {
  adultFront: "./assets/templates/adult-front.png",
  adultBack: "./assets/templates/adult-back.png",
  childFront: "./assets/templates/child-front.png",
  childBack: "./assets/templates/child-back.png",
};
const templateCache = new Map();

// Where the Hindi address is cropped from the source PDF page, as fractions of
// the page width (left/right) and page height (top/bottom).
// Adult and child sheets are set separately so one can be tuned without
// touching the other. Increase `top`/`bottom` to move the crop down the page,
// decrease them to move it up.
const HINDI_ADDRESS_CROP = {
  adult: { left: 0.526, right: 0.757, top: 0.773, bottom: 0.802 },
  child: { left: 0.526, right: 0.757, top: 0.7700, bottom: 0.800 },
};

function readPhotoSettings() {
  return {
    brightness: Number(photoBrightness.value) / 100,
    contrast: Number(photoContrast.value) / 100,
    borderEnabled: photoBorder.checked,
    borderWidth: photoBorder.checked ? Number(photoBorderWidth.value) : 0,
    borderColor: photoBorderColor.value,
  };
}

function writePhotoSettings(settings) {
  photoBrightness.value = String(Math.round(settings.brightness * 100));
  photoContrast.value = String(Math.round(settings.contrast * 100));
  photoBorder.checked = Boolean(settings.borderEnabled);
  photoBorderWidth.value = String(settings.borderWidth || 12);
  photoBorderColor.value = settings.borderColor || "#111827";
  updatePhotoSettingLabels();
  updatePhotoLivePreview();
}

function updatePhotoSettingLabels() {
  photoBrightnessValue.value = photoBrightness.value + "%";
  photoBrightnessValue.textContent = photoBrightness.value + "%";
  photoContrastValue.value = photoContrast.value + "%";
  photoContrastValue.textContent = photoContrast.value + "%";
  photoBorderWidthValue.value = photoBorderWidth.value + " px";
  photoBorderWidthValue.textContent = photoBorderWidth.value + " px";
}

function updatePhotoLivePreview() {
  if (!photoSettingsPreview) return;
  const settings = readPhotoSettings();
  photoSettingsPreview.style.filter =
    "brightness(" + settings.brightness + ") contrast(" + settings.contrast + ")";
  photoSettingsPreview.style.boxShadow = settings.borderEnabled && settings.borderWidth > 0
    ? "0 0 0 " + Math.max(1, settings.borderWidth * 0.24) + "px " + settings.borderColor
    : "none";
}

[photoBrightness, photoContrast, photoBorder, photoBorderWidth, photoBorderColor].forEach((control) => {
  control.addEventListener("input", () => {
    updatePhotoSettingLabels();
    updatePhotoLivePreview();
  });
});

resetPhotoSettings.addEventListener("click", () => {
  writePhotoSettings({
    brightness: 1.25,
    contrast: 1.35,
    borderEnabled: true,
    borderWidth: 12,
    borderColor: "#111827",
  });
  photoSettingsStatus.textContent = "Recommended settings restored. Select Save & apply to keep them.";
});

photoSettingsOpenBtn.addEventListener("click", async () => {
  const file = fileInput.files && fileInput.files[0];
  if (!file) {
    setStatus("Choose your PDF first, then open Photo & print settings.", "error");
    return;
  }

  photoSettingsOpenBtn.disabled = true;
  photoSettingsStatus.textContent = "Reading the portrait from your PDF locally…";
  try {
    await prepareStagedPdf(file);
    photoSettingsSnapshot = { ...savedPhotoSettings };
    writePhotoSettings(savedPhotoSettings);
    photoSettingsPreview.src = staged.photo.toDataURL("image/png");
    photoSettingsPreview.hidden = false;
    photoPreviewPlaceholder.hidden = true;
    photoSettingsStatus.textContent = "Live preview is ready. Unsaved changes will be discarded if you cancel.";
    if (!photoSettingsDialog.open) photoSettingsDialog.showModal();
    updatePhotoLivePreview();
  } catch (error) {
    console.error("Could not open photo editor:", error);
    setStatus(error instanceof Error ? error.message : "Could not load the photo preview.", "error");
    photoSettingsStatus.textContent = "Could not load the portrait. Check the PDF password and try again.";
  } finally {
    photoSettingsOpenBtn.disabled = false;
  }
});

function discardPhotoSettings() {
  if (photoSettingsSnapshot) writePhotoSettings(photoSettingsSnapshot);
  if (photoSettingsDialog.open) photoSettingsDialog.close();
}

closePhotoSettings.addEventListener("click", discardPhotoSettings);
cancelPhotoSettings.addEventListener("click", discardPhotoSettings);
photoSettingsDialog.addEventListener("cancel", () => {
  if (photoSettingsSnapshot) writePhotoSettings(photoSettingsSnapshot);
});

savePhotoSettings.addEventListener("click", async () => {
  savedPhotoSettings = { ...readPhotoSettings() };
  photoSettingsSnapshot = { ...savedPhotoSettings };
  photoSettingsDialog.close();

  if (!generated || !staged) {
    setStatus("Photo settings saved. Generate the card to apply them.", "info");
    return;
  }

  savePhotoSettings.disabled = true;
  savePhotoSettings.textContent = "Applying…";
  try {
    setStatus("Applying photo settings to the card…", "info");
    const isChild = determineChild(generated.fields.dob);
    const frontCanvas = await renderFront(generated.fields, staged.photo, isChild, savedPhotoSettings);
    const backCanvas = await renderBack(
      generated.fields,
      staged.qr,
      isChild,
      addressBold,
      staged.hindiAddressRaster
    );
    generated = { ...generated, frontCanvas, backCanvas, isChild };
    updateGeneratedPreviews();
    setStatus("Photo settings applied. Download the updated card image or PDF.", "success");
  } catch (error) {
    console.error("Could not apply photo settings:", error);
    setStatus(error instanceof Error ? error.message : "Could not apply photo settings.", "error");
  } finally {
    savePhotoSettings.disabled = false;
    savePhotoSettings.textContent = "Save & apply";
  }
});

writePhotoSettings(savedPhotoSettings);

fileInput.addEventListener("change", () => {
  staged = null;
  generated = null;
  results.hidden = true;
  dobPanel.hidden = true;
  fullDobInput.value = "";
  passwordInput.value = "";
  passwordInput.placeholder = "Leave empty to try the filename as password";
  photoSettingsPreview.removeAttribute("src");
  photoSettingsPreview.hidden = true;
  photoPreviewPlaceholder.hidden = false;
  if (photoSettingsDialog.open) photoSettingsDialog.close();
  clearStatus();

  const file = fileInput.files && fileInput.files[0];
  fileName.textContent = file ? file.name + " · " + formatBytes(file.size) : "No file selected";
});

boldToggle.addEventListener("click", () => {
  addressBold = !addressBold;
  boldToggle.setAttribute("aria-pressed", String(addressBold));
  boldToggleText.textContent = addressBold ? "Make address normal" : "Make address bold";
  if (generated) {
    setStatus("Formatting preference changed. Generate the card again to apply it.", "info");
  }
});

generateBtn.addEventListener("click", async () => {
  if (isBusy) return;
  const file = fileInput.files && fileInput.files[0];
  if (!file) {
    setStatus("Choose an e-Aadhaar PDF first.", "error");
    return;
  }

  isBusy = true;
  generateBtn.disabled = true;
  spinner.hidden = false;
  generateBtnText.textContent = staged && staged.file === file ? "Generating images…" : "Reading PDF locally…";
  clearStatus();

  try {
    await prepareStagedPdf(file);
    const fields = { ...staged.fields };

    if (fields.yob && !fields.dob) {
      const chosenDob = fullDobInput.value;
      if (!chosenDob) {
        dobPanel.hidden = false;
        setStatus("This PDF has only a year of birth. Enter the actual full date of birth, then generate again.", "info");
        return;
      }
      const parts = chosenDob.split("-");
      if (parts.length !== 3 || parts[0] !== String(fields.yob)) {
        dobPanel.hidden = false;
        throw new Error("The entered date's year must match " + fields.yob + ".");
      }
      fields.dob = parts[2] + "/" + parts[1] + "/" + parts[0];
    }

    if (!fields.aadhaar) {
      throw new Error("The Aadhaar number could not be read from this PDF. No image was generated.");
    }

    setStatus("Drawing card templates and preparing downloads…", "info");
    await loadHindiFont();
    const isChild = determineChild(fields.dob);
    const frontCanvas = await renderFront(fields, staged.photo, isChild, savedPhotoSettings);
    const backCanvas = await renderBack(
      fields,
      staged.qr,
      isChild,
      addressBold,
      staged.hindiAddressRaster
    );

    generated = { frontCanvas, backCanvas, fields, isChild };
    updateGeneratedPreviews();
    results.hidden = false;
    dobPanel.hidden = true;
    setStatus(
      staged.hindiAddressRaster
        ? "Card generated. The Hindi address is rendered from the source PDF to preserve its original glyphs."
        : "Card generated locally. Review the Hindi address carefully before printing.",
      staged.hindiAddressRaster ? "success" : "info"
    );
    results.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    console.error("Smart PDF browser processing failed:", error);
    setStatus(error instanceof Error ? error.message : "Unable to process this PDF.", "error");
  } finally {
    isBusy = false;
    generateBtn.disabled = false;
    spinner.hidden = true;
    generateBtnText.textContent = "Generate card";
  }
});

async function prepareStagedPdf(file) {
  if (staged && staged.file === file) return staged;

  const pdf = await openPdfFromDevice(file);
  setStatus("Reading the PDF locally…", "info");
  const textColumns = await extractLines(pdf);
  const fields = extractFields(textColumns.left, textColumns.right);
  const hindiAddressRaster = await extractHindiAddressRaster(pdf, fields, determineChild(fields.dob));
  const images = await extractEmbeddedImages(pdf);
  const chosen = choosePhotoAndQr(images);

  if (!chosen.photo || !chosen.qr) {
    throw new Error("The PDF's portrait or QR image could not be identified safely. No card was generated.");
  }
  if (!(chosen.photo.canvas instanceof HTMLCanvasElement) || !(chosen.qr.canvas instanceof HTMLCanvasElement)) {
    throw new Error("The embedded portrait or QR code could not be converted into a browser canvas.");
  }

  staged = {
    file,
    pdf,
    fields,
    photo: chosen.photo.canvas,
    qr: chosen.qr.canvas,
    hindiAddressRaster,
    imageCount: images.length,
  };
  return staged;
}

function updateGeneratedPreviews() {
  if (!generated) return;
  frontPreview.src = generated.frontCanvas.toDataURL("image/png");
  backPreview.src = generated.backCanvas.toDataURL("image/png");
  frontPng.href = frontPreview.src;
  backPng.href = backPreview.src;
  const file = fileInput.files && fileInput.files[0];
  const baseName = safeName(file ? file.name : "smart");
  frontPng.download = baseName + "-front.png";
  backPng.download = baseName + "-back.png";
}

downloadPdfBtn.addEventListener("click", async () => {
  if (!generated) {
    setStatus("Generate the card before downloading the PDF.", "error");
    return;
  }
  if (!window.PDFLib || !window.PDFLib.PDFDocument) {
    setStatus("The PDF creation library did not load. Check your internet connection and refresh the page.", "error");
    return;
  }

  downloadPdfBtn.disabled = true;
  downloadPdfBtn.textContent = "Creating PDF…";
  try {
    const { PDFDocument } = window.PDFLib;
    const doc = await PDFDocument.create();
    const pageWidth = (210 * 72) / 25.4;
    const pageHeight = (297 * 72) / 25.4;
    const cardWidth = (85 * 72) / 25.4;
    const cardHeight = (55 * 72) / 25.4;
    const xLeft = (20 * 72) / 25.4;
    const xRight = (105 * 72) / 25.4;
    const y = (pageHeight - cardHeight) / 2;
    const page = doc.addPage([pageWidth, pageHeight]);
    const front = await doc.embedPng(generated.frontCanvas.toDataURL("image/png"));
    const back = await doc.embedPng(generated.backCanvas.toDataURL("image/png"));
    page.drawImage(front, { x: xLeft, y, width: cardWidth, height: cardHeight });
    page.drawRectangle({ x: xLeft, y, width: cardWidth, height: cardHeight, borderColor: window.PDFLib.rgb(0, 0, 0), borderWidth: 0.6 });
    page.drawImage(back, { x: xRight, y, width: cardWidth, height: cardHeight });
    page.drawRectangle({ x: xRight, y, width: cardWidth, height: cardHeight, borderColor: window.PDFLib.rgb(0, 0, 0), borderWidth: 0.6 });
    const bytes = await doc.save();
    const blob = new Blob([bytes], { type: "application/pdf" });
    downloadBlob(blob, safeName((fileInput.files[0] || {}).name || "smart") + "-card.pdf");
  } catch (error) {
    console.error("Browser PDF export failed:", error);
    setStatus("PDF download failed: " + (error instanceof Error ? error.message : String(error)), "error");
  } finally {
    downloadPdfBtn.disabled = false;
    downloadPdfBtn.textContent = "Download A4 PDF";
  }
});

function setStatus(message, type) {
  statusBox.textContent = message;
  statusBox.className = "status" + (type ? " " + type : "");
}
function clearStatus() {
  statusBox.textContent = "";
  statusBox.className = "status";
}
function formatBytes(size) {
  if (size < 1024 * 1024) return Math.max(1, Math.round(size / 1024)) + " KB";
  return (size / (1024 * 1024)).toFixed(1) + " MB";
}
function safeName(name) {
  return String(name || "smart").replace(/\.pdf$/i, "").replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "") || "smart";
}
function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

async function openPdfFromDevice(file) {
  const bytes = await file.arrayBuffer();
  const filenamePassword = file.name.replace(/\.pdf$/i, "");
  const manualPassword = passwordInput.value.trim();
  const password = manualPassword || filenamePassword;

  try {
    return await pdfjsLib.getDocument({ data: new Uint8Array(bytes), password }).promise;
  } catch (error) {
    const needsPassword =
      error && (
        error.name === "PasswordException" ||
        /password|encrypted/i.test(String(error.message || ""))
      );
    if (needsPassword) {
      passwordInput.focus();
      passwordInput.placeholder = "Enter the correct PDF password, then try again";
      throw new Error("Could not open this PDF with the filename password. Enter the correct PDF password above and try again.");
    }
    throw error;
  }
}

async function extractLines(pdf) {
  const leftLines = [];
  const rightLines = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const pageView = page.view || [0, 0, 612, 792];
    const pageWidth = Math.abs(pageView[2] - pageView[0]) || 612;
    const columnSplitX = pageView[0] + pageWidth / 2;

    // This card PDF has the front content on the left and the back content
    // on the right. Parse each half separately, otherwise aligned rows from
    // those two independent cards get merged together.
    const items = content.items
      .filter((item) => item && typeof item.str === "string" && item.str.trim())
      .map((item) => ({
        str: item.str,
        x: item.transform ? item.transform[4] : 0,
        y: item.transform ? item.transform[5] : 0,
        width: Number(item.width) || 0,
        size: item.transform
          ? Math.hypot(item.transform[0], item.transform[1])
          : (Number(item.height) || 10),
        hasEOL: Boolean(item.hasEOL),
      }));

    for (const column of ["left", "right"]) {
      const columnItems = items
        .filter((item) => column === "left" ? item.x < columnSplitX : item.x >= columnSplitX)
        .sort((a, b) => b.y - a.y || a.x - b.x);

      const rows = [];
      for (const item of columnItems) {
        const tolerance = Math.max(1.5, Math.min(5, item.size * 0.35));
        let row = rows.find((candidate) => Math.abs(candidate.y - item.y) <= tolerance);
        if (!row) {
          row = { y: item.y, items: [] };
          rows.push(row);
        }
        row.items.push(item);
        row.y = row.items.reduce((sum, part) => sum + part.y, 0) / row.items.length;
      }

      rows.sort((a, b) => b.y - a.y);
      const destination = column === "left" ? leftLines : rightLines;

      for (const row of rows) {
        row.items.sort((a, b) => a.x - b.x);
        let line = "";
        let previous = null;

        for (const item of row.items) {
          const value = item.str.trim();
          if (!value) continue;

          if (previous) {
            const gap = item.x - (previous.x + previous.width);
            const fontSize = Math.max(previous.size, item.size);
            // Word gaps in the embedded Hindi text are small. Use a modest
            // threshold instead of adding spaces for every visual glyph gap.
            const threshold = Math.max(1.2, Math.min(4.5, fontSize * 0.22));
            const hasExplicitSpace = /\s$/.test(previous.str) || /^\s/.test(item.str);
            const needsSpace = hasExplicitSpace || gap > threshold;
            if (needsSpace && line && !line.endsWith(" ")) line += " ";
          }

          line += value;
          previous = item;
        }

        line = line.normalize("NFC").replace(/\s{2,}/g, " ").trim();
        if (line) destination.push(line);
      }
    }
  }

  return { left: leftLines, right: rightLines };
}

function extractFields(leftLines, rightLines = []) {
  // Front and back are separate visual columns in the source PDF.
  // Use front text for name/DOB/gender/mobile, and back text for addresses.
  const frontText = leftLines.join("\n");
  const backText = rightLines.join("\n");
  const allLines = [...leftLines, ...rightLines];
  const allText = frontText + "\n" + backText;

  const toIndex = leftLines.findIndex((line) => /^to\s*:?$/i.test(line.trim()));
  let hindiName = "";
  let englishName = "";
  if (toIndex >= 0) {
    hindiName = leftLines[toIndex + 1] || "";
    englishName = leftLines[toIndex + 2] || "";
  }
  hindiName = cleanName(hindiName);
  englishName = cleanName(englishName);

  const dobMatch = frontText.match(/DOB\s*[:\-]?\s*(\d{2}\/\d{2}\/\d{4}|(?:19|20)\d{2})/i);
  const yobMatch =
    frontText.match(/Year\s*of\s*Birth\s*[:\-]?\s*((?:19|20)\d{2})/i) ||
    frontText.match(/\bYOB\s*[:\-]?\s*((?:19|20)\d{2})/i) ||
    frontText.match(/DOB\s*[:\-]?\s*((?:19|20)\d{2})(?!\/)/i) ||
    frontText.match(/जन्म\s*वर्ष\s*[:\-]?\s*((?:19|20)\d{2})/u);

  const genderMatch = frontText.match(/\b(FEMALE|MALE)\b|महिला|पुरुष/iu);
  let gender = genderMatch ? genderMatch[0].toUpperCase() : "";
  if (/FEMALE|महिला/u.test(gender)) gender = "महिला / FEMALE";
  else if (/MALE|पुरुष/u.test(gender)) gender = "पुरुष / MALE";

  let aadhaar = "";
  for (const line of allLines) {
    if (/\bVID\b/i.test(line)) continue;
    const match = line.match(/\b(\d{4})[\s-]*(\d{4})[\s-]*(\d{4})\b/);
    if (match) {
      aadhaar = match[1] + " " + match[2] + " " + match[3];
      break;
    }
  }

  let vid = "";
  const vidLine = allLines.find((line) => /\bVID\b/i.test(line));
  if (vidLine) {
    const vidMatch = vidLine.match(/(?:\d[\s-]*){16,20}/);
    if (vidMatch) {
      const digits = vidMatch[0].replace(/\D/g, "").slice(0, 16);
      if (digits.length === 16) vid = digits.replace(/(\d{4})(?=\d)/g, "$1 ").trim();
    }
  }

  const mobileMatch = frontText.match(/Mobile\s*[:\-]?\s*(\d{10})/i);
  const issueDateMatch = frontText.match(/issued\s*[:\-]?\s*(\d{2}\/\d{2}\/\d{4})/i);
  const detailsDateMatch = backText.match(/Details\s+as\s+on\s*[:\-]?\s*(\d{2}\/\d{2}\/\d{4})/i);

  return {
    hindiName,
    englishName,
    dob: dobMatch && dobMatch[1].includes("/") ? dobMatch[1] : "",
    yob: (yobMatch && yobMatch[1]) || (dobMatch && !dobMatch[1].includes("/") ? dobMatch[1] : ""),
    gender,
    aadhaar,
    mobile: mobileMatch ? mobileMatch[1] : "",
    vid,
    issueDate: issueDateMatch ? issueDateMatch[1] : "",
    detailsDate: detailsDateMatch ? detailsDateMatch[1] : "",
    addressHindi: extractAddress(rightLines, /पता\s*[:：]?/u, "hindi"),
    addressEnglish: extractAddress(rightLines, /Address\s*[:：]?/i, "english"),
  };
}

function cleanName(value) {
  return String(value || "")
    .normalize("NFC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractAddress(lines, labelPattern, language) {
  const start = lines.findIndex((line) => labelPattern.test(line));
  if (start < 0) return "";
  const first = lines[start].replace(labelPattern, "").replace(/^[\s:：,]+/, "").trim();
  const address = first ? [first] : [];
  const endLabels = language === "english"
    ? /^(?:VID\b|DOB\b|Mobile\b|Gender\b|Details\s+as\s+on\b|Aadhaar\b)/i
    : /^(?:Address\s*[:：]?|VID\b|DOB\b|Mobile\b|Gender\b|Details\s+as\s+on\b)/iu;

  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) continue;
    if (endLabels.test(line)) break;
    address.push(line);
    if (/(?:[-–]\s*)?\b\d{6}\s*$/.test(line)) break;
    if (address.length > 14) break;
  }

  return address
    .join(" ")
    .replace(/\s+([,.:;])/g, "$1")
    .replace(/,(\S)/g, ", $1")
    .replace(/,{2,}/g, ",")
    .replace(/\s{2,}/g, " ")
    .trim();
}

async function extractEmbeddedImages(pdf) {
  const found = [];
  const seen = new Set();
  const OPS = pdfjsLib.OPS || {};

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const list = await page.getOperatorList();
    const count = list.fnArray.length;

    for (let index = 0; index < count; index += 1) {
      const operation = list.fnArray[index];
      const args = list.argsArray[index] || [];
      let source = null;
      let identity = "";

      if (
        operation === OPS.paintImageXObject ||
        operation === OPS.paintJpegXObject ||
        operation === OPS.paintImageXObjectRepeat
      ) {
        const objectId = args[0];
        if (typeof objectId !== "string") continue;
        identity = pageNumber + ":" + objectId;
        if (seen.has(identity)) continue;
        seen.add(identity);
        source = await resolvePdfObject(page.objs, objectId);
        if (!source && page.commonObjs) source = await resolvePdfObject(page.commonObjs, objectId);
      } else if (operation === OPS.paintInlineImageXObject) {
        source = args[0];
        identity = pageNumber + ":inline:" + index;
      } else {
        continue;
      }

      const canvas = objectToCanvas(source);
      if (!canvas || canvas.width < 48 || canvas.height < 48) continue;
      found.push({
        canvas,
        width: canvas.width,
        height: canvas.height,
        area: canvas.width * canvas.height,
        aspect: canvas.width / canvas.height,
        identity,
        pageNumber,
        operationIndex: index,
      });
    }
  }
  return found;
}

function resolvePdfObject(objects, id) {
  return new Promise((resolve) => {
    if (!objects || typeof objects.get !== "function") return resolve(null);
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value || null);
    };
    const timer = setTimeout(() => finish(null), 5000);
    try {
      const immediate = objects.get(id, finish);
      if (immediate !== undefined && immediate !== null) finish(immediate);
    } catch (_error) {
      finish(null);
    }
  });
}

function objectToCanvas(source) {
  if (!source) return null;
  const width = Number(source.naturalWidth || source.videoWidth || source.width || (source.bitmap && source.bitmap.width));
  const height = Number(source.naturalHeight || source.videoHeight || source.height || (source.bitmap && source.bitmap.height));
  if (!width || !height || width > 6000 || height > 6000) return null;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });

  const pixels = source.data;
  if (pixels && ArrayBuffer.isView(pixels)) {
    const area = width * height;
    const output = context.createImageData(width, height);
    if (pixels.length === area * 4) {
      output.data.set(pixels);
    } else if (pixels.length === area * 3) {
      for (let sourceIndex = 0, targetIndex = 0; sourceIndex < pixels.length; sourceIndex += 3, targetIndex += 4) {
        output.data[targetIndex] = pixels[sourceIndex];
        output.data[targetIndex + 1] = pixels[sourceIndex + 1];
        output.data[targetIndex + 2] = pixels[sourceIndex + 2];
        output.data[targetIndex + 3] = 255;
      }
    } else if (pixels.length === area) {
      for (let sourceIndex = 0, targetIndex = 0; sourceIndex < area; sourceIndex += 1, targetIndex += 4) {
        output.data[targetIndex] = pixels[sourceIndex];
        output.data[targetIndex + 1] = pixels[sourceIndex];
        output.data[targetIndex + 2] = pixels[sourceIndex];
        output.data[targetIndex + 3] = 255;
      }
    } else if (pixels.length === Math.ceil(width / 8) * height) {
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const byte = pixels[y * Math.ceil(width / 8) + (x >> 3)];
          const value = (byte >> (7 - (x & 7))) & 1 ? 0 : 255;
          const targetIndex = (y * width + x) * 4;
          output.data[targetIndex] = value;
          output.data[targetIndex + 1] = value;
          output.data[targetIndex + 2] = value;
          output.data[targetIndex + 3] = 255;
        }
      }
    } else {
      return null;
    }
    context.putImageData(output, 0, 0);
    return canvas;
  }

  const drawable = source.bitmap || source.canvas || source;
  try {
    context.drawImage(drawable, 0, 0, width, height);
    return canvas;
  } catch (_error) {
    return null;
  }
}

function choosePhotoAndQr(images) {
  const valid = images.filter((image) => image.width >= 90 && image.height >= 90);

  // Aadhaar PDFs also embed a large, portrait-shaped information panel. The
  // old "largest portrait wins" rule selected that panel as the user's photo.
  // Real embedded portraits are much smaller; cap the candidate size to exclude
  // full card panels while still supporting high-resolution portrait photos.
  const photoCandidates = valid
    .filter((image) =>
      image.width <= 800 &&
      image.height <= 1000 &&
      image.aspect >= 0.48 &&
      image.aspect <= 0.92 &&
      image.area >= 9000
    )
    .sort((a, b) => {
      const aspectPenaltyA = Math.abs(a.aspect - 0.8);
      const aspectPenaltyB = Math.abs(b.aspect - 0.8);
      if (Math.abs(aspectPenaltyA - aspectPenaltyB) > 0.08) {
        return aspectPenaltyA - aspectPenaltyB;
      }
      return b.area - a.area;
    });

  const qrCandidates = valid
    .filter((image) =>
      image.aspect >= 0.88 &&
      image.aspect <= 1.12 &&
      image.width >= 120 &&
      image.height >= 120
    )
    .sort((a, b) => b.area - a.area);

  const photo = photoCandidates[0] || null;
  const qr = qrCandidates.find((image) => !photo || image.identity !== photo.identity) || null;
  return { photo, qr };
}

async function loadHindiFont() {
  if (hindiFontReady && document.fonts.check('16px "NotoSansHindi"')) return;
  const font = new FontFace("NotoSansHindi", 'url("./assets/fonts/NotoSansDevanagari-Regular.ttf")');
  await font.load();
  document.fonts.add(font);
  hindiFontReady = true;
}

function loadTemplate(path) {
  if (templateCache.has(path)) return templateCache.get(path);
  const promise = new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not load template image: " + path));
    image.src = path;
  });
  templateCache.set(path, promise);
  return promise;
}

async function renderFront(fields, photoImage, isChild, photoSettings = readPhotoSettings()) {
  const template = await loadTemplate(isChild ? TEMPLATE_PATHS.childFront : TEMPLATE_PATHS.adultFront);
  const canvas = document.createElement("canvas");
  canvas.width = template.naturalWidth;
  canvas.height = template.naturalHeight;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(template, 0, 0);
  ctx.fillStyle = "#000";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.direction = "ltr";
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  ctx.font = 'bold 66pt "NotoSansHindi", "Noto Sans Devanagari", sans-serif';
  wrapCanvasText(ctx, fields.hindiName || "नाम नहीं मिला", 982, 553, 1400, 86, { maxLines: 2, autoShrink: true, minSize: 28 });

  ctx.font = "bold 69pt Arial";
  ctx.fillText(fields.englishName || "Name Not Found", 982, 677);
  ctx.fillText(fields.dob || "—", 1559, 805);
  ctx.font = 'bold 66pt "NotoSansHindi", "Noto Sans Devanagari", sans-serif';
  ctx.fillText(fields.gender || "—", 982, 917);
  ctx.font = "70pt Arial";
  ctx.fillText(fields.mobile || "—", 1245, 1061);
  ctx.font = "bold 130pt Arial";
  ctx.fillText(fields.aadhaar || "—", 947, 1609);
  ctx.font = "60pt Arial";
  ctx.fillText(fields.vid || "—", 1255, 1703);

  ctx.save();
  ctx.translate(140, 820);
  ctx.rotate(-Math.PI / 2);
  ctx.font = "bold 40pt sans-serif";
  ctx.fillText(fields.issueDate || "", 0, 0);
  ctx.restore();

  const photoX = 220;
  const photoY = 510;
  const photoWidth = 687;
  const photoHeight = 862;

  ctx.save();
  ctx.filter = `brightness(${photoSettings.brightness}) contrast(${photoSettings.contrast})`;
  ctx.drawImage(photoImage, photoX, photoY, photoWidth, photoHeight);
  ctx.restore();

  if (photoSettings.borderEnabled && photoSettings.borderWidth > 0) {
    ctx.save();
    ctx.filter = "none";
    ctx.strokeStyle = photoSettings.borderColor;
    ctx.lineWidth = photoSettings.borderWidth;
    const bleed = ctx.lineWidth / 2;
    ctx.strokeRect(
      photoX - bleed,
      photoY - bleed,
      photoWidth + ctx.lineWidth,
      photoHeight + ctx.lineWidth
    );
    ctx.restore();
  }

  return canvas;
}

async function renderBack(fields, qrImage, isChild, addressIsBold = false, hindiAddressRaster = null) {
  const template = await loadTemplate(isChild ? TEMPLATE_PATHS.childBack : TEMPLATE_PATHS.adultBack);
  const canvas = document.createElement("canvas");
  canvas.width = template.naturalWidth;
  canvas.height = template.naturalHeight;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(template, 0, 0);
  ctx.fillStyle = "#000";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.direction = "ltr";
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  const qrX = 2103;
  const paddingRight = 20;
  const hindiX = 200;
  const englishX = 200;
  const hindiMaxWidth = Math.max(300, qrX - paddingRight - hindiX);

  if (hindiAddressRaster) {
    // Render the Devanagari address from the PDF itself. This bypasses guessed
    // character spacing entirely, preserving ligatures and rare vowel signs.
    const drawWidth = hindiMaxWidth;
    const drawHeight = drawWidth * (hindiAddressRaster.height / hindiAddressRaster.width);
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(hindiAddressRaster, hindiX, 620, drawWidth, drawHeight);
    ctx.restore();
  } else {
    ctx.font = (addressIsBold ? "bold " : "") + '75pt "NotoSansHindi", "Noto Sans Devanagari", sans-serif';
    wrapCanvasText(ctx, fields.addressHindi || "—", hindiX, 705, hindiMaxWidth, 120, {
      maxLines: 6, autoShrink: true, minSize: 30
    });
  }

  const englishMaxWidth = Math.max(300, qrX - paddingRight - englishX);
  ctx.font = (addressIsBold ? "bold " : "") + "62pt Arial";
  wrapCanvasText(ctx, fields.addressEnglish || "—", englishX, 1170, englishMaxWidth, 120, {
    maxLines: 6, autoShrink: true, minSize: 26
  });

  ctx.save();
  ctx.translate(145, 870);
  ctx.rotate(-Math.PI / 2);
  ctx.font = "bold 40pt sans-serif";
  ctx.fillText(fields.detailsDate || "", 0, 0);
  ctx.restore();

  ctx.font = "bold 130pt Arial";
  ctx.fillText(fields.aadhaar || "—", 947, 1600);
  ctx.font = "60pt Arial";
  ctx.fillText(fields.vid || "—", 1245, 1688);
  if (qrImage) ctx.drawImage(qrImage, qrX, 463, 1000, 1000);
  return canvas;
}


async function extractHindiAddressRaster(pdf, fields, isChildLayout = false) {
  // This path targets the standard one-page, letter-size e-Aadhaar sheet.
  // Unrecognized PDFs continue through the text-based fallback.
  if (
    pdf.numPages !== 1 ||
    !fields.dob ||
    !fields.aadhaar ||
    !fields.addressEnglish ||
    !fields.detailsDate
  ) {
    return null;
  }

  const page = await pdf.getPage(1);
  const pageView = page.view || [0, 0, 612, 792];
  const pageWidth = Math.abs(pageView[2] - pageView[0]) || 612;
  const pageHeight = Math.abs(pageView[3] - pageView[1]) || 792;
  const aspect = pageWidth / pageHeight;
  if (aspect < 0.72 || aspect > 0.81) return null;

  // In this standard print sheet the Hindi address is in the lower-right
  // card, between the Hindi "पता:" label and the English "Address:" label.
  // PDF.js rasterizes the embedded glyphs with correct Devanagari shaping.
  const renderScale = 5.5;
  const viewport = page.getViewport({ scale: renderScale });
  const source = document.createElement("canvas");
  source.width = Math.ceil(viewport.width);
  source.height = Math.ceil(viewport.height);
  const sourceContext = source.getContext("2d", { willReadFrequently: true });
  sourceContext.fillStyle = "#fff";
  sourceContext.fillRect(0, 0, source.width, source.height);
  await page.render({
    canvasContext: sourceContext,
    viewport,
    background: "rgb(255,255,255)",
  }).promise;

  const region = isChildLayout ? HINDI_ADDRESS_CROP.child : HINDI_ADDRESS_CROP.adult;
  let sy = Math.round(region.top * source.height);
  let sh = Math.round((region.bottom - region.top) * source.height);

  const sx = Math.round(region.left * source.width);
  const sw = Math.round((region.right - region.left) * source.width);
  if (sh <= 0 || sy + sh > source.height) {
    source.width = 0;
    source.height = 0;
    return null;
  }

  const crop = document.createElement("canvas");
  crop.width = sw;
  crop.height = sh;
  const cropContext = crop.getContext("2d", { willReadFrequently: true });
  cropContext.drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh);

  // If these coordinates land on a different layout or blank paper, do not
  // stamp an incorrect crop over the template.
  const imageData = cropContext.getImageData(0, 0, sw, sh);
  const pixels = imageData.data;
  let darkPixels = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i] < 120 && pixels[i + 1] < 120 && pixels[i + 2] < 120) {
      darkPixels += 1;
      if (darkPixels > 350) break;
    }
  }

  if (darkPixels <= 350) {
    source.width = 0;
    source.height = 0;
    return null;
  }

  // The adult template uses a white background. The child template is pale
  // blue, so remove the scanned white paper from the child crop while keeping
  // anti-aliased black glyph edges transparent and smooth.
  if (isChildLayout) {
    // The child sheet's panel is not pure white, so a plain "255 - luminance"
    // alpha leaves a faint grey rectangle over the template. Measure the actual
    // paper tone and make only the ink opaque.
    const histogram = new Uint32Array(256);
    for (let i = 0; i < pixels.length; i += 4) {
      histogram[Math.round((pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3)] += 1;
    }
    let background = 255;
    let bestCount = -1;
    for (let value = 255; value >= 128; value -= 1) {
      if (histogram[value] > bestCount) {
        bestCount = histogram[value];
        background = value;
      }
    }

    const noiseFloor = background - 3;
    const inkRange = Math.max(1, background - 25);
    for (let i = 0; i < pixels.length; i += 4) {
      const luminance = (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3;
      pixels[i] = 0;
      pixels[i + 1] = 0;
      pixels[i + 2] = 0;
      pixels[i + 3] = luminance >= noiseFloor
        ? 0
        : Math.min(255, Math.round(((background - luminance) / inkRange) * 255));
    }
    cropContext.putImageData(imageData, 0, 0);
  }

  source.width = 0;
  source.height = 0;
  return crop;
}

function wrapCanvasText(ctx, text, x, y, maxWidth, lineHeight, options) {
  const settings = options || {};
  const maxLines = Number.isFinite(settings.maxLines) ? settings.maxLines : Infinity;
  const autoShrink = !!settings.autoShrink;
  const minSize = Number(settings.minSize) || 14;
  const originalFont = ctx.font;
  const fontMatch = originalFont.match(/(\d+(?:\.\d+)?)pt/);
  const clean = String(text || "").normalize("NFC").replace(/[\u200B-\u200D\uFEFF]/g, "").replace(/\s+/gu, " ").trim();
  if (!clean) {
    ctx.fillText("—", x, y);
    return;
  }

  const words = clean.split(" ");
  function buildLines() {
    const lines = [];
    let current = "";
    for (const word of words) {
      const candidate = current ? current + " " + word : word;
      if (ctx.measureText(candidate).width <= maxWidth) {
        current = candidate;
      } else {
        if (current) lines.push(current);
        if (ctx.measureText(word).width <= maxWidth) {
          current = word;
        } else {
          let chunk = "";
          for (const grapheme of splitGraphemes(word)) {
            if (ctx.measureText(chunk + grapheme).width > maxWidth && chunk) {
              lines.push(chunk);
              chunk = grapheme;
            } else {
              chunk += grapheme;
            }
          }
          current = chunk;
        }
      }
    }
    if (current) lines.push(current);
    return lines;
  }

  if (autoShrink && fontMatch) {
    let size = Number(fontMatch[1]);
    while (size > minSize && buildLines().length > maxLines) {
      size = Math.max(minSize, size - 2);
      ctx.font = originalFont.replace(/(\d+(?:\.\d+)?)pt/, size + "pt");
    }
  }

  let lines = buildLines();
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    if (lines.length) {
      const finalIndex = lines.length - 1;
      let chars = splitGraphemes(lines[finalIndex]);
      while (chars.length && ctx.measureText(chars.join("") + "…").width > maxWidth) chars.pop();
      lines[finalIndex] = chars.join("").trimEnd() + "…";
    }
  }
  lines.forEach((line, index) => ctx.fillText(line, x, y + index * lineHeight));
}

function splitGraphemes(value) {
  if (typeof Intl !== "undefined" && Intl.Segmenter) {
    const segmenter = new Intl.Segmenter("hi", { granularity: "grapheme" });
    return Array.from(segmenter.segment(value), (part) => part.segment);
  }
  return Array.from(value);
}

function determineChild(dob) {
  const match = String(dob || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return false;
  const day = Number(match[1]);
  const month = Number(match[2]) - 1;
  const year = Number(match[3]);
  const now = new Date();
  let age = now.getFullYear() - year;
  const birthdayNotReached = now.getMonth() < month || (now.getMonth() === month && now.getDate() < day);
  if (birthdayNotReached) age -= 1;
  return age < 5;
}
