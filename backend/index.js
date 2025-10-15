const express = require("express");
const multer = require("multer");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const { exec, execSync } = require("child_process");
const { createCanvas, loadImage, registerFont } = require("canvas");
// ---------- ADD THIS NEAR TOP ----------
const { pipeline } = require("stream");
const { promisify } = require("util");
const pipelineAsync = promisify(pipeline);
// ---------------------------------------
const gm = require("gm").subClass({ imageMagick: true });

const PDFDocument = require("pdfkit"); // <-- NEW

// ============================================
// HINDI TEXT PROCESSING FIX - START
// ============================================

/**
 * Enhanced Hindi text cleaning that preserves PDF structure
 */
function cleanHindiTextPreserveStructure(rawText) {
  if (!rawText || typeof rawText !== "string") return "";

  // Normalize Unicode composition for Hindi
  let cleaned = rawText.normalize("NFC");

  // Remove zero-width characters
  cleaned = cleaned.replace(/[\u200B-\u200D\uFEFF]/g, "");

  // Merge wrongly separated matras and consonants
  cleaned = cleaned.replace(
    /([\u0915-\u0939\u0958-\u095F])\s+([\u093E-\u094F\u0902\u0903])/g,
    "$1$2"
  );
  cleaned = cleaned.replace(
    /([\u093E-\u094F\u0902\u0903])\s+([\u0915-\u0939\u0958-\u095F])/g,
    "$1$2"
  );

  // Normalize repeated punctuation like ,, or , ,  -> single comma
  cleaned = cleaned.replace(/,+/g, ",").replace(/,\s*,+/g, ","); 

  // Remove spaces before commas and collapse multi-spaces
  cleaned = cleaned.replace(/\s+,/g, ",").replace(/\s{2,}/g, " ").trim();

  // Remove leading/trailing commas and whitespace
  cleaned = cleaned.replace(/^,+|,+$/g, "").trim();

  return cleaned;
}


/**
 * Extract name with minimal processing
 */
function extractNameSafely(lines, toIndex) {
  if (toIndex === -1 || toIndex + 2 >= lines.length) {
    return { hindiName: '', englishName: '' };
  }
  
  const rawHindi = lines[toIndex + 1].trim();
  const rawEnglish = lines[toIndex + 2].trim();
  
  const hindiName = cleanHindiTextPreserveStructure(rawHindi);
  const englishName = rawEnglish.replace(/\s+/g, ' ').trim();
  
  return { hindiName, englishName };
}

/**
 * Extract address with minimal processing
 */
function extractAddressSafely(lines, startIndex, language = "hindi") {
  if (startIndex === -1) return "";

  const addressLines = [];
  const pinRegex = /[-–]\s*\d{6}$/;

  for (let i = startIndex + 1; i < lines.length; i++) {
    let line = lines[i].trim();
    if (!line) continue;

    // Clean line by language
    if (language === "hindi") {
      line = cleanHindiTextPreserveStructure(line);
    } else {
      line = line.replace(/\s+/g, " ").trim();
    }

    // Remove leading/trailing commas and extra commas inside the line
    line = line.replace(/,+/g, ",").replace(/^,+|,+$/g, "").trim();
    if (!line) continue;

    addressLines.push(line);

    // stop if we reach a pin-like marker (common in Aadhaar)
    if (pinRegex.test(lines[i])) break;
  }

  // Filter out empty segments and join with single comma+space
  const joined = addressLines.filter(Boolean).join(", ").replace(/,+/g, ",").replace(/,\s*,/g, ",").trim();

  // Final cleanup: remove repeated commas and leading/trailing punctuation
  return joined.replace(/\s{2,}/g, " ").replace(/^,+|,+$/g, "").trim();
}

/**
 * Wrap and render text safely for Hindi + English mixed content.
 * It auto-breaks lines based on measured width and supports ellipsis + font shrinking.
 */
function wrapTextForCanvas(ctx, text, x, y, maxWidth, lineHeight, opts = {}) {
  const { maxLines = Infinity, ellipses = true, autoShrink = false, minFontSize = 14 } = opts;

  if (!text) {
    ctx.fillText("—", x, y);
    return;
  }

  // Split into Hindi and non-Hindi tokens, preserving graphemes
const tokens = Array.from(
  text.matchAll(/[\u0900-\u097F]+(?:[\u093E-\u094F\u0902\u0903]*)*|[A-Za-z]+|[0-9]+|[,.:;/-]+|\s+/g),
  m => m[0]
).filter(t => t.trim().length > 0);

  // ---- Auto shrink font if allowed ----
  if (autoShrink && isFinite(maxLines)) {
    const origFont = ctx.font;
    const fontMatch = origFont.match(/(\d+(?:\.\d+)?)pt/);
    if (fontMatch) {
      let size = parseFloat(fontMatch[1]);
      while (size >= minFontSize) {
        ctx.font = origFont.replace(/(\d+(?:\.\d+)?)pt/, `${size}pt`);
        const linesTest = buildLines(ctx, tokens, maxWidth);
        if (linesTest.length <= maxLines) break;
        size -= 2; // shrink gradually
      }
    }
  }

  // ---- Build actual lines based on width ----
  const lines = buildLines(ctx, tokens, maxWidth);

  // ---- Handle overflow (too many lines) ----
  const finalLines =
    lines.length > maxLines
      ? lines.slice(0, maxLines).map((line, i, arr) => {
          if (i === arr.length - 1 && ellipses) {
            while (ctx.measureText(line + "...").width > maxWidth && line.length > 0)
              line = line.slice(0, -1);
            return line.trim() + "...";
          }
          return line;
        })
      : lines;

  // ---- Draw lines ----
  finalLines.forEach((ln, i) => ctx.fillText(ln, x, y + i * lineHeight));

  // Helper that builds lines respecting Hindi graphemes
  function buildLines(ctxLocal, toks, widthLimit) {
    const out = [];
    let line = "";

    for (const token of toks) {
      const isPunct = /^[,.\-:;]+$/.test(token);
      const testLine = line ? (isPunct ? line + token : line + " " + token) : token;
      const w = ctxLocal.measureText(testLine).width;
      if (w > widthLimit && line) {
        out.push(line.trim());
        line = token;
      } else {
        line = testLine;
      }
    }
    if (line) out.push(line.trim());
    return out;
  }
}


// ============================================
// HINDI TEXT PROCESSING FIX - END
// ============================================


const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const uploadDir = path.join(__dirname, "..", "uploads");
const staticDir = path.join(__dirname, "..", "static");

if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
// Serve uploaded images with no caching (safer during generation)
app.use("/images", express.static(uploadDir, { etag: false, maxAge: 0 }));
app.use("/static", express.static(staticDir));

// ✅ Register Hindi font
registerFont(path.join(staticDir, "NotoSansDevanagari-Regular.ttf"), {
  family: "NotoSansHindi",
});

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, uploadDir),
  filename: (_, file, cb) => {
    const base = path.basename(
      file.originalname,
      path.extname(file.originalname)
    );
    const ext = path.extname(file.originalname) || ".pdf";
    cb(null, `${base}-${Date.now()}${ext}`);
  },
});
const upload = multer({ storage });

const qpdfPath = "qpdf";
const pdftotextPath = "pdftotext";
const pdfimagesPath = "pdfimages";

// --- DOB/YOB helpers ---
function isValidDDMMYYYY(s) {
  return /^([0-2]\d|3[01])\/(0\d|1[0-2])\/(19|20)\d{2}$/.test(s);
}
function yearOf(s) {
  const m = s.match(/(19|20)\d{2}/);
  return m ? m[0] : "";
}

app.post("/upload", upload.single("aadhaar"), async (req, res) => {
  console.log("UPLOAD RECEIVED");
  console.log("File:", req.file);
  console.log("Password:", req.body.password);

  const password = req.body.password;
  const originalPath = req.file.path;
  const baseName = path.basename(
    req.file.originalname,
    path.extname(req.file.originalname)
  );

  // ✅ Create subfolder inside /uploads using the base name
  const userDir = path.join(uploadDir, baseName);
  if (!fs.existsSync(userDir)) fs.mkdirSync(userDir);

  // ✅ Move uploaded file into that folder
  const newOriginalPath = path.join(userDir, req.file.filename);
  fs.renameSync(originalPath, newOriginalPath);

  // ✅ Update paths to use userDir
  const decryptedPath = path.join(userDir, `${baseName}_decrypted.pdf`);
  const txtPath = path.join(userDir, `${baseName}.txt`);
  const imagePrefix = path.join(userDir, `${baseName}_photo`);

  exec(
    `${qpdfPath} --password=${password} --decrypt "${newOriginalPath}" "${decryptedPath}"`,
    (err, stdout, stderr) => {
      if (err) {
        console.error("❌ QPDF error:", stderr || err.message);
        return res
          .status(400)
          .json({ error: "QPDF failed: " + (stderr || err.message) });
      }

      exec(`${pdftotextPath} "${decryptedPath}" "${txtPath}"`, (err) => {
        if (err)
          return res.status(500).json({ error: "Text extraction failed." });

        const text = fs.readFileSync(txtPath, "utf8");
        const lines = text
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean);

// ✅ Name extraction - UPDATED
        let hindiName = "";
        let englishName = "";
        const toIndex = lines.findIndex((line) => /^To$/i.test(line));

        const nameResult = extractNameSafely(lines, toIndex);
        hindiName = nameResult.hindiName;
        englishName = nameResult.englishName;

        console.log("📝 Extracted Names:");
        console.log("   Hindi:", hindiName);
        console.log("   English:", englishName);

        
        // --- DOB/YOB extraction (handles full DOB and year-only cases) ---
        let dob =
          (text.match(/DOB[:\s]*([0-9]{2}\/[0-9]{2}\/[0-9]{4})/i) || [])[1] ||
          "";

        // Try to get a YEAR even if DOB is year-only like "DOB: 2004"
        const yob =
          (text.match(/Year\s*of\s*Birth[:\s]*((19|20)\d{2})/i) || // Year of Birth: 2004
            text.match(/\bYOB[:\s]*((19|20)\d{2})/i) || // YOB: 2004
            text.match(/DOB[:\s]*((19|20)\d{2})(?!\/)/i) || // DOB: 2004 (no slashes)
            text.match(/जन्म\s*वर्ष[:\s]*((19|20)\d{2})/i) || // Hindi: जन्म वर्ष: 2004 (optional)
            (dob && !dob.includes("/") ? [null, yearOf(dob)] : null) || // fallback if dob somehow captured but no slashes
            [])[1] || "";

        const genderMatch = text.match(/(MALE|FEMALE|पुरुष|महिला)/i);
        let gender = genderMatch ? genderMatch[0].toUpperCase() : "";
        if (gender.includes("MALE") || gender.includes("पुरुष"))
          gender = "पुरुष / MALE";
        else if (gender.includes("FEMALE") || gender.includes("महिला"))
          gender = "महिला / FEMALE";

        const aadhaar = (text.match(/\d{4}\s\d{4}\s\d{4}/) || [])[0] || "";
        const mobile = (text.match(/Mobile[:\s]*(\d{10})/) || [])[1] || "";
        const vid = (text.match(/VID[:\s]*([\d\s]{16,20})/) || [])[1] || "";
        const issueDate =
          (text.match(/issued[:\s]*([0-9]{2}\/[0-9]{2}\/[0-9]{4})/) || [])[1] ||
          "";
        const detailsDate =
          (text.match(
            /Details\s+as\s+on[:\s]*([0-9]{2}\/[0-9]{2}\/[0-9]{4})/
          ) || [])[1] || "";

       let addressHindi = "";
        let addressEnglish = "";
        const hindiStartIndex = lines.findIndex((line) => /पता[:]?/i.test(line));
        const englishStartIndex = lines.findIndex((line) => /Address[:]?/i.test(line));

        addressHindi = extractAddressSafely(lines, hindiStartIndex, 'hindi');
        addressEnglish = extractAddressSafely(lines, englishStartIndex, 'english');

        console.log("📍 Extracted Addresses:");
        console.log("   Hindi:", addressHindi);
        console.log("   English:", addressEnglish);


        const cmdImage = `${pdfimagesPath} -j "${decryptedPath}" "${imagePrefix}"`;

        // If only Year of Birth exists, run pdfimages now so photo files exist for finalize step
        console.log("Extracted DOB:", dob, " | YOB:", yob);
        const needsFullDob =
          !!yob && (!dob || !/^\d{2}\/\d{2}\/\d{4}$/.test(dob));
        if (needsFullDob) {
          const pending = {
            baseName,
            userDir,
            extracted: {
              hindiName,
              englishName,
              gender,
              aadhaar,
              mobile,
              vid,
              issueDate,
              detailsDate,
              addressHindi,
              addressEnglish,
            },
            createdAt: Date.now(),
            yob,
          };

          // run pdfimages now so the photo-007 / photo-010 files get created in userDir
          exec(cmdImage, (imgErr, imgStdout, imgStderr) => {
            if (imgErr) {
              // don't crash — log and continue. finalize-dob will still proceed but
              // photo files may be missing.
              console.warn(
                "pdfimages failed while preparing pending-yob:",
                imgStderr || imgErr.message
              );
            } else {
              console.log("pdfimages completed for pending-yob:", userDir);
            }

            // --- convert pdfimages' photo-000.ppm -> <baseName>_qr.png synchronously ---
            try {
              const allNow = fs.readdirSync(userDir);
              const ppmFile = allNow.find(
                (f) =>
                  f.startsWith(baseName) &&
                  f.includes("photo-000") &&
                  f.toLowerCase().endsWith(".ppm")
              );

              if (ppmFile) {
                const ppmPathLocal = path.join(userDir, ppmFile);
                const qrPngLocal = path.join(userDir, `${baseName}_qr.png`);
                const convertCmdLocal = `convert "${ppmPathLocal}" "${qrPngLocal}"`;

                try {
                  execSync(convertCmdLocal); // BLOCKS briefly but guarantees PNG exists
                  console.log(
                    "✅ QR converted (sync) for pending-yob:",
                    qrPngLocal
                  );
                } catch (convErr) {
                  console.warn(
                    "Sync QR convert failed in pending-yob branch:",
                    convErr && convErr.message ? convErr.message : convErr
                  );
                }
              } else {
                console.log(
                  "No ppm (photo-000) found for pending-yob conversion."
                );
              }
            } catch (e) {
              console.warn(
                "Error while attempting QR convert for pending-yob:",
                e
              );
            }

            // write pending file once extraction attempt finished
            try {
              fs.writeFileSync(
                path.join(userDir, "pending-yob.json"),
                JSON.stringify(pending, null, 2),
                "utf8"
              );
            } catch (e) {
              console.error("Failed to write pending-yob.json:", e);
            }

            // respond to client asking for full DOB
            return res.json({
              requiresDob: true,
              yob,
              baseName,
              hindiName,
              englishName,
              gender,
              message:
                "Only Year of Birth found in Aadhaar. Please enter full DOB (dd/mm/yyyy).",
            });
          });

          // return here to avoid executing the later exec(cmdImage, ...) generation path
          return;
        }

        exec(cmdImage, async () => {
          const allFiles = fs.readdirSync(userDir);

          const qrFilename = allFiles.find(
            (f) =>
              f.startsWith(baseName) &&
              f.includes("photo-000") &&
              f.endsWith(".ppm")
          );
          let qrPath = "";

          if (qrFilename) {
            const ppmPath = path.join(userDir, qrFilename);
            qrPath = path.join(userDir, `${baseName}_qr.png`);
            const convertCmd = `convert "${ppmPath}" "${qrPath}"`;

            try {
              await new Promise((resolve, reject) => {
                exec(convertCmd, (err, stdout, stderr) => {
                  if (err) {
                    console.error(
                      "❌ QR conversion failed (magick):",
                      stderr || err.message
                    );
                    qrPath = "";
                    return reject(err);
                  }
                  console.log("✅ QR converted with ImageMagick:", qrPath);
                  resolve();
                });
              });
            } catch (e) {
              qrPath = "";
            }
          }

          const photoFilename =
            allFiles.find(
              (f) =>
                f.startsWith(baseName) &&
                f.includes("photo-007") &&
                f.endsWith(".jpg")
            ) ||
            allFiles.find(
              (f) =>
                f.startsWith(baseName) &&
                f.includes("photo-010") &&
                f.endsWith(".jpg")
            );

          const photoPath = photoFilename
            ? path.join(userDir, photoFilename)
            : "";
          const isChild = photoFilename && photoFilename.includes("photo-010");

          const frontTemplatePath = isChild
            ? path.join(__dirname, "..", "template", "child.png")
            : path.join(__dirname, "..", "template", "final.png");

          const backTemplatePath = isChild
            ? path.join(__dirname, "..", "template", "child_back.png")
            : path.join(__dirname, "..", "template", "back.png");

          const outputName = `generated-${Date.now()}.png`;
          const outputPath = path.join(userDir, outputName);

const base = await loadImage(frontTemplatePath);
          const canvas = createCanvas(base.width, base.height);
          const ctx = canvas.getContext("2d");
          ctx.drawImage(base, 0, 0);
          
          // ✅ IMPROVED TEXT RENDERING SETTINGS
          ctx.fillStyle = "#000";
          ctx.textAlign = "left";
          ctx.textBaseline = "alphabetic"; // Better baseline for Hindi
          ctx.direction = "ltr"; // Force left-to-right
          ctx.imageSmoothingEnabled = true; // Smooth text edges
          ctx.imageSmoothingQuality = "high"; // Best quality

          // Final positions (from Photoshop)
         ctx.font = 'bold 66pt "NotoSansHindi"';
          wrapTextForCanvas(ctx, hindiName || "नाम नहीं मिला", 982, 553, 1400, 86);

          ctx.font = "bold 69pt Arial";
          ctx.fillText(englishName || "Name Not Found", 982, 677);
          ctx.fillText(dob || "—", 1559, 805);

          ctx.font = '60pt "NotoSansHindi"';
          ctx.fillText(gender || "—", 982, 917);

          ctx.font = "70pt Arial";
          ctx.fillText(mobile || "—", 1245, 1061);
          ctx.font = "bold 130pt Arial";
          ctx.fillText(aadhaar || "—", 947, 1609);
          ctx.font = "60pt Arial";
          ctx.fillText(vid || "—", 1255, 1703);

          // vertical issued date
          ctx.save();
          ctx.translate(140, 820);
          ctx.rotate(-Math.PI / 2);
          ctx.font = "bold 40pt sans-serif";
          ctx.fillStyle = "#000";
          ctx.fillText(issueDate, 0, 0);
          ctx.restore();

          // profile photo: preprocess to increase brightness & contrast, then draw
if (photoPath && fs.existsSync(photoPath)) {
  const adjPhoto = path.join(userDir, `${baseName}_photo_adj.jpg`);
  try {
    // gm.modulate(brightness,saturation,hue).contrast(level)
    // Use modulate to raise brightness a bit (e.g. 110%), and contrast via -contrast multiple times
    // Here we increase brightness 12% and apply a mild contrast increase
    await new Promise((resolve, reject) => {
      gm(photoPath)
        .modulate(112, 100, 100) // brightness 112%, saturation 100%, hue 100%
        .contrast(1) // apply small contrast boost (call multiple times if needed)
        .write(adjPhoto, (err) => (err ? reject(err) : resolve()));
    });
    const userPhoto = await loadImage(adjPhoto);
    ctx.drawImage(userPhoto, 220, 510, 687, 862);
    // optional: unlink adjPhoto later if you want cleanup
  } catch (err) {
    console.warn("Brightness/contrast adjust failed, drawing original:", err);
    const userPhoto = await loadImage(photoPath);
    ctx.drawImage(userPhoto, 220, 510, 687, 862);
  }
}


      
        const backBase = await loadImage(backTemplatePath);
          const backCanvas = createCanvas(backBase.width, backBase.height);
          const backCtx = backCanvas.getContext("2d");
          backCtx.drawImage(backBase, 0, 0);

          // ✅ IMPROVED TEXT RENDERING SETTINGS FOR BACK
          backCtx.fillStyle = "#000";
          backCtx.textAlign = "left";
          backCtx.textBaseline = "alphabetic";
          backCtx.direction = "ltr";
          backCtx.imageSmoothingEnabled = true;
          backCtx.imageSmoothingQuality = "high";


          const hindiX = 200;
          const hindiY = 705;
          const englishX = 200;
          const englishY = 1170;




         // Calculate QR left X and dynamic max widths so address never crosses QR
// Values must match where QR is drawn: backCtx.drawImage(qrImg, qrX, qrY, qrW, qrH)
const qrX = 2103;
const qrW = 1000;
const qrLeft = qrX; // left edge of QR in canvas coordinates
const paddingRight = 20; // keep small gap between address and QR

// Hindi address max width: stop before QR
const hindiMaxWidth = Math.max(300, qrLeft - paddingRight - hindiX); // fallback minimum width
backCtx.font = '75pt "NotoSansHindi"';
wrapTextForCanvas(backCtx, addressHindi || "—", hindiX, hindiY, hindiMaxWidth, 120, {
  maxLines: 6,
  ellipses: true,
  autoShrink: true,
  minFontSize: 30,
});

// English address max width: stop before QR
const englishMaxWidth = Math.max(300, qrLeft - paddingRight - englishX);
backCtx.font = "62pt Arial";
wrapTextForCanvas(backCtx, addressEnglish || "—", englishX, englishY, englishMaxWidth, 120, {
  maxLines: 6,
  ellipses: true,
  autoShrink: true,
  minFontSize: 26,
});



          backCtx.save();
          backCtx.translate(145, 870);
          backCtx.rotate(-Math.PI / 2);
          backCtx.font = "bold 40pt sans-serif";
          backCtx.fillStyle = "#000";
          backCtx.fillText(detailsDate, 0, 0);
          backCtx.restore();

          backCtx.font = "bold 130pt Arial";
          backCtx.fillText(aadhaar || "—", 947, 1600);

          backCtx.font = "60pt Arial";
          backCtx.fillText(vid || "—", 1245, 1688);

          if (qrPath && fs.existsSync(qrPath)) {
            const qrImg = await loadImage(qrPath);
            backCtx.drawImage(qrImg, 2103, 463, 1000, 1000);
          }

          // save images
          const backOutputName = `back-${Date.now()}.png`;
          const backOutputPath = path.join(userDir, backOutputName);

          // ---------- REPLACE WITH THIS ----------
          try {
            const frontStream = fs.createWriteStream(outputPath);
            const backStream = fs.createWriteStream(backOutputPath);

            // Wait for the entire pipeline to finish and the file descriptors to close.
            await Promise.all([
              pipelineAsync(canvas.createPNGStream(), frontStream),
              pipelineAsync(backCanvas.createPNGStream(), backStream),
            ]);

            // Sanity check: ensure files are present and non-empty
            const fStat = fs.statSync(outputPath);
            const bStat = fs.statSync(backOutputPath);
            if (!fStat.size || !bStat.size) {
              console.error(
                "❌ Generated image file empty",
                outputPath,
                backOutputPath
              );
              return res
                .status(500)
                .json({ error: "Generated image was empty" });
            }

            console.log(
              `✅ Generated images written: ${outputPath} (${fStat.size} bytes), ${backOutputPath} (${bStat.size} bytes)`
            );

            // respond
            res.json({
              hindiName,
              englishName,
              dob,
              gender,
              mobile,
              aadhaar,
              vid,
              issueDate,
              detailsDate,
              photoUrl: photoFilename
                ? `/images/${baseName}/${photoFilename}`
                : "",
              downloadUrlFront: `/images/${baseName}/${outputName}`,
              downloadUrlBack: `/images/${baseName}/${backOutputName}`,
            });

            // cleanup others (same as before)...
          } catch (err) {
            console.error("❌ Error writing generated PNGs:", err);
            return res
              .status(500)
              .json({ error: "Failed to write generated images" });
          }
        });
      });
    }
  );
});

// ---------- NEW ROUTE: Generate A4 PDF with 85mm x 55mm front/back ----------
app.post("/generate-pdf", async (req, res) => {
  try {
    const { frontPath, backPath, baseName } = req.body;

    if (!frontPath || !backPath || !baseName) {
      return res
        .status(400)
        .json({ error: "Missing front/back paths or baseName" });
    }

    // Convert URL path -> absolute filesystem path (restrict to /images/*)
    function toAbs(p) {
      // strip origin if sent accidentally
      const onlyPath = p.replace(/^https?:\/\/[^/]+/i, "");
      if (!onlyPath.startsWith("/images/")) {
        throw new Error("Invalid path");
      }
      const rel = onlyPath.replace(/^\/images\//, "");
      const abs = path.join(uploadDir, rel);
      return abs;
    }

    const frontAbs = toAbs(frontPath);
    const backAbs = toAbs(backPath);

    if (!fs.existsSync(frontAbs) || !fs.existsSync(backAbs)) {
      return res.status(404).json({ error: "Images not found" });
    }

    // A4 portrait: 210mm x 297mm
    const mm = (v) => (v * 72) / 25.4; // mm -> pt
    const a4 = { width: mm(210), height: mm(297) };

    // Card size: 85mm x 55mm
    const cardW = mm(85);
    const cardH = mm(55);

    // Place side-by-side, centered horizontally, centered vertically
    // Left margin = (210 - 170)/2 = 20mm => xLeft = 20mm, xRight = 20 + 85 = 105mm
    const xLeft = mm(20);
    const xRight = mm(105);
    const yCenter = (a4.height - cardH) / 2;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${baseName}-pdf.pdf"`
    );

    const doc = new PDFDocument({ size: [a4.width, a4.height], margin: 0 });
    doc.pipe(res);

    // front on left, back on right (with black border)
    doc.image(frontAbs, xLeft, yCenter, { width: cardW, height: cardH });
    doc
      .rect(xLeft, yCenter, cardW, cardH)
      .lineWidth(1)
      .strokeColor("black")
      .stroke();

    doc.image(backAbs, xRight, yCenter, { width: cardW, height: cardH });
    doc
      .rect(xRight, yCenter, cardW, cardH)
      .lineWidth(1)
      .strokeColor("black")
      .stroke();

    doc.end();
  } catch (e) {
    console.error("PDF generation error:", e);
    res.status(500).json({ error: "Failed to generate PDF" });
  }
});
// ---------------------------------------------------------------------------

// ---------- NEW ROUTE: finalize when user provides full DOB ----------
app.post("/finalize-dob", async (req, res) => {
  try {
    const { baseName, dobFull } = req.body;
    if (!baseName || !dobFull) {
      return res.status(400).json({ error: "Missing baseName or dobFull" });
    }
    if (!isValidDDMMYYYY(dobFull)) {
      return res.status(400).json({ error: "DOB must be dd/mm/yyyy" });
    }

    const userDir = path.join(uploadDir, baseName);
    const pendingPath = path.join(userDir, "pending-yob.json");
    if (!fs.existsSync(pendingPath)) {
      return res
        .status(404)
        .json({ error: "No pending YOB job found for this baseName" });
    }

    const pending = JSON.parse(fs.readFileSync(pendingPath, "utf8"));
    const expectedYear = pending.yob;
    const enteredYear = yearOf(dobFull);
    if (!expectedYear || !enteredYear || expectedYear !== enteredYear) {
      return res.status(400).json({
        error: `Year mismatch. Aadhaar shows year ${expectedYear}, but you entered ${enteredYear}.`,
      });
    }

    // --- detect photo & decide child/adult template (same logic as /upload) ---
    const allFiles = fs.readdirSync(userDir);

    // prefer adult photo-007, fallback to child photo-010
    const photoFilename =
      allFiles.find(
        (f) =>
          f.startsWith(baseName) &&
          f.includes("photo-007") &&
          f.endsWith(".jpg")
      ) ||
      allFiles.find(
        (f) =>
          f.startsWith(baseName) &&
          f.includes("photo-010") &&
          f.endsWith(".jpg")
      );

    const photoPath = photoFilename ? path.join(userDir, photoFilename) : "";
    const isChild = !!(photoFilename && photoFilename.includes("photo-010"));

    // set template paths based on detected photo type
    const frontTemplatePath = isChild
      ? path.join(__dirname, "..", "template", "child.png")
      : path.join(__dirname, "..", "template", "final.png");

    const backTemplatePath = isChild
      ? path.join(__dirname, "..", "template", "child_back.png")
      : path.join(__dirname, "..", "template", "back.png");

    const {
      hindiName,
      englishName,
      gender,
      aadhaar,
      mobile,
      vid,
      issueDate,
      detailsDate,
      addressHindi,
      addressEnglish,
    } = pending.extracted;

    // Render (same as /upload, but with dobFull)
   const base = await loadImage(frontTemplatePath);
    const canvas = createCanvas(base.width, base.height);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(base, 0, 0);
    
    // ✅ IMPROVED TEXT RENDERING SETTINGS
    ctx.fillStyle = "#000";
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.direction = "ltr";
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";



    ctx.font = 'bold 60pt "NotoSansHindi"';
    wrapTextForCanvas(ctx, hindiName || "नाम नहीं मिला", 982, 553, 1400, 80);

    ctx.font = "bold 69pt Arial";
    ctx.fillText(englishName || "Name Not Found", 982, 677);
    ctx.fillText(dobFull || "—", 1559, 805);

    ctx.font = '60pt "NotoSansHindi"';
    ctx.fillText(gender || "—", 982, 917);

    ctx.font = "70pt Arial";
    ctx.fillText(mobile || "—", 1245, 1061);
    ctx.font = "bold 130pt Arial";
    ctx.fillText(aadhaar || "—", 947, 1609);
    ctx.font = "60pt Arial";
    ctx.fillText(vid || "—", 1255, 1703);

    ctx.save();
    ctx.translate(140, 820);
    ctx.rotate(-Math.PI / 2);
    ctx.font = "bold 40pt sans-serif";
    ctx.fillStyle = "#000";
    ctx.fillText(issueDate || "", 0, 0);
    ctx.restore();

   // profile photo: preprocess to increase brightness & contrast, then draw
if (photoPath && fs.existsSync(photoPath)) {
  const adjPhoto = path.join(userDir, `${baseName}_photo_adj.jpg`);
  try {
    // gm.modulate(brightness,saturation,hue).contrast(level)
    // Use modulate to raise brightness a bit (e.g. 110%), and contrast via -contrast multiple times
    // Here we increase brightness 12% and apply a mild contrast increase
    await new Promise((resolve, reject) => {
      gm(photoPath)
        .modulate(112, 100, 100) // brightness 112%, saturation 100%, hue 100%
        .contrast(1) // apply small contrast boost (call multiple times if needed)
        .write(adjPhoto, (err) => (err ? reject(err) : resolve()));
    });
    const userPhoto = await loadImage(adjPhoto);
    ctx.drawImage(userPhoto, 220, 510, 687, 862);
    // optional: unlink adjPhoto later if you want cleanup
  } catch (err) {
    console.warn("Brightness/contrast adjust failed, drawing original:", err);
    const userPhoto = await loadImage(photoPath);
    ctx.drawImage(userPhoto, 220, 510, 687, 862);
  }
}


   const backBase = await loadImage(backTemplatePath);
    const backCanvas = createCanvas(backBase.width, backBase.height);
    const backCtx = backCanvas.getContext("2d");
    backCtx.drawImage(backBase, 0, 0);
    
    // ✅ IMPROVED TEXT RENDERING SETTINGS FOR BACK
    backCtx.fillStyle = "#000";
    backCtx.textAlign = "left";
    backCtx.textBaseline = "alphabetic";
    backCtx.direction = "ltr";
    backCtx.imageSmoothingEnabled = true;
    backCtx.imageSmoothingQuality = "high";


    const hindiX = 200,
      hindiY = 705;
    const englishX = 200,
      englishY = 1170;

    backCtx.font = '70pt "NotoSansHindi"';
  wrapTextForCanvas(
  backCtx,
  addressHindi || "—",
  hindiX,
  hindiY,
  1900,
  120,
  { maxLines: 6, ellipses: true, autoShrink: true, minFontSize: 30 }
);


 wrapTextForCanvas(
  backCtx,
  addressEnglish || "—",
  englishX,
  englishY,
  1950,
  120,
  { maxLines: 6, ellipses: true, autoShrink: true, minFontSize: 26 }
);

    backCtx.save();
    backCtx.translate(145, 870);
    backCtx.rotate(-Math.PI / 2);
    backCtx.font = "bold 40pt sans-serif";
    backCtx.fillStyle = "#000";
    backCtx.fillText(detailsDate || "", 0, 0);
    backCtx.restore();

    backCtx.font = "bold 130pt Arial";
    backCtx.fillText(aadhaar || "—", 947, 1600);

    backCtx.font = "60pt Arial";
    backCtx.fillText(vid || "—", 1245, 1688);

    const qrPng = path.join(userDir, `${baseName}_qr.png`);
    if (fs.existsSync(qrPng)) {
      const qrImg = await loadImage(qrPng);
      backCtx.drawImage(qrImg, 2103, 463, 1000, 1000);
    }
    // ---------- REPLACE WITH THIS ----------
    const frontOutName = `generated-${Date.now()}.png`;
    const backOutName = `back-${Date.now()}.png`;
    const frontPathAbs = path.join(userDir, frontOutName);
    const backPathAbs = path.join(userDir, backOutName);

    try {
      const frontStream = fs.createWriteStream(frontPathAbs);
      const backStream = fs.createWriteStream(backPathAbs);

      await Promise.all([
        pipelineAsync(canvas.createPNGStream(), frontStream),
        pipelineAsync(backCanvas.createPNGStream(), backStream),
      ]);

      // Sanity check
      const fStat = fs.statSync(frontPathAbs);
      const bStat = fs.statSync(backPathAbs);
      if (!fStat.size || !bStat.size) {
        console.error(
          "❌ Generated image file empty (finalize-dob)",
          frontPathAbs,
          backPathAbs
        );
        return res.status(500).json({ error: "Generated image was empty" });
      }

      console.log(
        `✅ finalize-dob wrote images: ${frontPathAbs} (${fStat.size}), ${backPathAbs} (${bStat.size})`
      );
    } catch (err) {
      console.error("❌ Error generating images in finalize-dob:", err);
      return res.status(500).json({ error: "Failed to generate final images" });
    }

    try {
      fs.unlinkSync(pendingPath);
    } catch {}

    // determine isChild again (this uses the same logic as earlier)
    const finalAllFiles = fs.readdirSync(userDir || ".");
    const finalPhotoFilename =
      finalAllFiles.find(
        (f) =>
          f.startsWith(baseName) &&
          f.includes("photo-007") &&
          f.endsWith(".jpg")
      ) ||
      finalAllFiles.find(
        (f) =>
          f.startsWith(baseName) &&
          f.includes("photo-010") &&
          f.endsWith(".jpg")
      ) ||
      "";

    const finalIsChild = !!(
      finalPhotoFilename && finalPhotoFilename.includes("photo-010")
    );

    return res.json({
      ok: true,
      dob: dobFull,
      isChild: finalIsChild, // <-- NEW FLAG
      photoFilename: finalPhotoFilename, // <-- helpful for debugging
      downloadUrlFront: `/images/${baseName}/${frontOutName}`,
      downloadUrlBack: `/images/${baseName}/${backOutName}`,
    });
  } catch (e) {
    console.error("Finalize DOB error:", e);
    res.status(500).json({ error: "Failed to finalize with DOB" });
  }
});

const frontendPath = path.join(__dirname, "..", "frontend");
app.use(express.static(frontendPath));

app.get("/", (req, res) => {
  res.sendFile(path.join(frontendPath, "index.html"));
});

app.listen(5000, () =>
  console.log("✅ Server running at http://localhost:5000")
);
