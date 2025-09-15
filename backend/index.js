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

        // ✅ Name extraction
        let hindiName = "";
        let englishName = "";
        const toIndex = lines.findIndex((line) => /^To$/i.test(line));

        if (toIndex !== -1 && toIndex + 2 < lines.length) {
          function cleanHindiText(raw) {
            const isHindiChar = (c) => /[\u0900-\u097F]/.test(c);
            const words = raw.trim().split(/\s+/);
            if (words.length <= 1) return raw.normalize("NFC");

            const firstWord = words[0];
            const rest = words.slice(1).join(" ");

            let cleaned = "";
            let prevChar = "";
            for (let i = 0; i < rest.length; i++) {
              const char = rest[i];
              if (char === " ") {
                const next = rest[i + 1] || "";
                const next2 = rest[i + 2] || "";
                if (
                  isHindiChar(prevChar) &&
                  isHindiChar(next) &&
                  next !== " " &&
                  (next2 !== " " || !isHindiChar(next2))
                ) {
                  continue; // skip bad space
                } else {
                  cleaned += " ";
                }
              } else {
                cleaned += char;
                prevChar = char;
              }
            }
            return `${firstWord} ${cleaned}`
              .replace(/\s+/g, " ")
              .trim()
              .normalize("NFC");
          }

          function fixThirdHindiSpace(line) {
            const isHindiChar = (c) => /[\u0900-\u097F]/.test(c);
            let spaceCount = 0;
            let result = "";
            let i = 0;
            while (i < line.length) {
              const char = line[i];
              if (char === " ") {
                spaceCount++;
                if (spaceCount === 3) {
                  const prevChar = line[i - 1];
                  const nextChar = line[i + 1] || "";
                  if (isHindiChar(prevChar) && isHindiChar(nextChar)) {
                    i++; // skip this space
                    continue;
                  }
                }
              }
              result += char;
              i++;
            }
            return result.replace(/\s+/g, " ").trim();
          }

          const rawHindi = lines[toIndex + 1].trim();
          hindiName = cleanHindiText(rawHindi);
          englishName = lines[toIndex + 2].replace(/\s+/g, " ").trim();
        }

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

        let addressHindi = "",
          addressEnglish = "";
        const pinRegex = /[-–]\s*\d{6}$/;
        const hindiStartIndex = lines.findIndex((line) =>
          /पता[:]?/i.test(line)
        );
        const englishStartIndex = lines.findIndex((line) =>
          /Address[:]?/i.test(line)
        );

        // Joins any SINGLE Devanagari letter that got split out between words
        // Only joins when the previous chunk ends with a vowel matra (े, ो, ा, etc.)
        // Example: "ठे र कादरी" -> "ठेर कादरी", but "घर राम" stays "घर राम"
        function fixIsolatedHindiLetterAfterMatra(line) {
          const devanagari = /[\u0900-\u097F]/;
          const matraOrSign = /[ािीुूृेैोौँंॅ]/; // common vowel signs + nasalizations
          let prev;
          do {
            prev = line;
            line = line.replace(
              new RegExp(
                // group1 ends with a matra/sign, then spaces, then a single Devanagari letter,
                // then a space and next token also starts with Devanagari
                "([\\u0900-\\u097F]*" +
                  matraOrSign.source +
                  ")\\s+([\\u0900-\\u097F])\\s+(?=[\\u0900-\\u097F])",
                "g"
              ),
              "$1$2 " // join the single letter to the left word, keep the space before next word
            );
          } while (line !== prev);
          return line;
        }
        if (hindiStartIndex !== -1) {
          const hindiLines = [];
          for (let i = hindiStartIndex + 1; i < lines.length; i++) {
            let cleaned = lines[i]
              .replace(/\s+/g, " ") // safe: collapse multiple spaces
              .replace(/,+$/, "") // safe: drop trailing commas only
              .trim();

            if (cleaned) {
              // ✅ critical fix: remove artifacts like "ठे र" universally
              cleaned = fixIsolatedHindiLetterAfterMatra(cleaned);
              hindiLines.push(cleaned);
            }

            if (pinRegex.test(lines[i])) break;
          }

          // Keep exactly what PDF had (no other “smart” fixes)
          addressHindi = hindiLines.join(", ");
        }

        if (englishStartIndex !== -1) {
          const englishLines = [];
          for (let i = englishStartIndex + 1; i < lines.length; i++) {
            const cleaned = lines[i]
              .replace(/\s+/g, " ")
              .replace(/,+$/, "")
              .trim();
            if (cleaned) englishLines.push(cleaned);
            if (pinRegex.test(lines[i])) break;
          }
          addressEnglish = englishLines.join(", ");
        }

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
          ctx.fillStyle = "#000";
          ctx.textAlign = "left";

          // Final positions (from Photoshop)
          ctx.font = 'bold 60pt "NotoSansHindi"';
          ctx.fillText(hindiName || "नाम नहीं मिला", 982, 553);

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

          // profile photo
          if (photoPath && fs.existsSync(photoPath)) {
            const userPhoto = await loadImage(photoPath);
            ctx.drawImage(userPhoto, 220, 510, 687, 862);
          }

          function drawWrappedText(ctx, text, x, y, maxWidth, lineHeight) {
            const words = text.split(" ");
            let line = "";
            for (let n = 0; n < words.length; n++) {
              const testLine = line + words[n] + " ";
              const metrics = ctx.measureText(testLine);
              const testWidth = metrics.width;
              if (testWidth > maxWidth && n > 0) {
                ctx.fillText(line, x, y);
                line = words[n] + " ";
                y += lineHeight;
              } else {
                line = testLine;
              }
            }
            ctx.fillText(line, x, y);
          }

          // back
          const backBase = await loadImage(backTemplatePath);
          const backCanvas = createCanvas(backBase.width, backBase.height);
          const backCtx = backCanvas.getContext("2d");
          backCtx.drawImage(backBase, 0, 0);

          backCtx.fillStyle = "#000";
          backCtx.textAlign = "left";

          function drawWrappedTextBack(ctx, text, x, y, maxWidth, lineHeight) {
            const words = text.split(" ");
            let line = "";
            for (let n = 0; n < words.length; n++) {
              const testLine = line + words[n] + " ";
              const metrics = ctx.measureText(testLine);
              const testWidth = metrics.width;
              if (testWidth > maxWidth && n > 0) {
                ctx.fillText(line, x, y);
                line = words[n] + " ";
                y += lineHeight;
              } else {
                line = testLine;
              }
            }
            ctx.fillText(line, x, y);
          }

          const hindiX = 200;
          const hindiY = 705;
          const englishX = 200;
          const englishY = 1170;

          backCtx.font = '70pt "NotoSansHindi"';
          drawWrappedTextBack(
            backCtx,
            addressHindi || "—",
            hindiX,
            hindiY,
            1900,
            120
          );

          backCtx.font = "62pt Arial";
          drawWrappedTextBack(
            backCtx,
            addressEnglish || "—",
            englishX,
            englishY,
            1950,
            120
          );

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
    ctx.fillStyle = "#000";
    ctx.textAlign = "left";

    ctx.font = 'bold 60pt "NotoSansHindi"';
    ctx.fillText(hindiName || "नाम नहीं मिला", 982, 553);

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

    if (photoPath && fs.existsSync(photoPath)) {
      const userPhoto = await loadImage(photoPath);
      ctx.drawImage(userPhoto, 220, 510, 687, 862);
    }

    const backBase = await loadImage(backTemplatePath);
    const backCanvas = createCanvas(backBase.width, backBase.height);
    const backCtx = backCanvas.getContext("2d");
    backCtx.drawImage(backBase, 0, 0);
    backCtx.fillStyle = "#000";
    backCtx.textAlign = "left";

    function drawWrappedTextBack(ctx, text, x, y, maxWidth, lineHeight) {
      const words = text.split(" ");
      let line = "";
      for (let n = 0; n < words.length; n++) {
        const testLine = line + words[n] + " ";
        const metrics = ctx.measureText(testLine);
        if (metrics.width > maxWidth && n > 0) {
          ctx.fillText(line, x, y);
          line = words[n] + " ";
          y += lineHeight;
        } else {
          line = testLine;
        }
      }
      ctx.fillText(line, x, y);
    }

    const hindiX = 200,
      hindiY = 705;
    const englishX = 200,
      englishY = 1170;

    backCtx.font = '70pt "NotoSansHindi"';
    drawWrappedTextBack(
      backCtx,
      addressHindi || "—",
      hindiX,
      hindiY,
      1900,
      120
    );

    backCtx.font = "62pt Arial";
    drawWrappedTextBack(
      backCtx,
      addressEnglish || "—",
      englishX,
      englishY,
      1950,
      120
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
