const express = require('express');
const multer = require('multer');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { createCanvas, loadImage, registerFont } = require('canvas');
const gm = require('gm').subClass({ imageMagick: true });


const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const uploadDir = path.join(__dirname, '..', 'uploads');
const staticDir = path.join(__dirname, '..', 'static');

if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
app.use('/images', express.static(uploadDir));
app.use('/static', express.static(staticDir));

// ✅ Register Hindi font
registerFont(path.join(staticDir, 'NotoSansDevanagari-Regular.ttf'), {
  family: 'NotoSansHindi'
});

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, uploadDir),
  filename: (_, file, cb) => {
    const base = path.basename(file.originalname, path.extname(file.originalname));
    const ext = path.extname(file.originalname) || '.pdf';
    cb(null, `${base}-${Date.now()}${ext}`);
  }
});
const upload = multer({ storage });

const qpdfPath = 'qpdf';
const pdftotextPath = 'pdftotext';
const pdfimagesPath = 'pdfimages';

app.post('/upload', upload.single('aadhaar'), async (req, res) => {
  
  console.log('UPLOAD RECEIVED');
  console.log('File:', req.file);
  console.log('Password:', req.body.password);

  const password = req.body.password;
  const originalPath = req.file.path;
  const baseName = path.basename(req.file.originalname, path.extname(req.file.originalname));

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


      exec(`${qpdfPath} --password=${password} --decrypt "${newOriginalPath}" "${decryptedPath}"`, (err, stdout, stderr) => {
      if (err) {
        console.error('❌ QPDF error:', stderr || err.message);
        return res.status(400).json({ error: 'QPDF failed: ' + (stderr || err.message) });
      }


    exec(`${pdftotextPath} "${decryptedPath}" "${txtPath}"`, (err) => {
      if (err) return res.status(500).json({ error: 'Text extraction failed.' });

      const text = fs.readFileSync(txtPath, 'utf8');
      const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

      // ✅ Name from "To" section
      // ✅ Name from "To" section
        let hindiName = '';
        let englishName = '';
        const toIndex = lines.findIndex(line => /^To$/i.test(line));

        if (toIndex !== -1 && toIndex + 2 < lines.length) {

        // ✅ New advanced Unicode-safe Hindi cleaner
       function cleanHindiText(raw) {
        const isHindiChar = c => /[\u0900-\u097F]/.test(c);
        const words = raw.trim().split(/\s+/);

        if (words.length <= 1) return raw.normalize('NFC'); // No need to process

        const firstWord = words[0];
        const rest = words.slice(1).join(' ');

        let cleaned = '';
        let prevChar = '';
        for (let i = 0; i < rest.length; i++) {
          const char = rest[i];

          if (char === ' ') {
            const next = rest[i + 1] || '';
            const next2 = rest[i + 2] || '';

            if (
              isHindiChar(prevChar) &&
              isHindiChar(next) &&
              next !== ' ' &&
              (next2 !== ' ' || !isHindiChar(next2))
            ) {
              continue; // skip bad space
            } else {
              cleaned += ' ';
            }
          } else {
            cleaned += char;
            prevChar = char;
          }
        }

        return `${firstWord} ${cleaned}`.replace(/\s+/g, ' ').trim().normalize('NFC');
      }

     // ✅ Removes 3rd space only if it splits Hindi characters (e.g. सुधीर कु मार → सुधीर कुमार)
        function fixThirdHindiSpace(line) {
          const isHindiChar = c => /[\u0900-\u097F]/.test(c);
          let spaceCount = 0;
          let result = '';
          let i = 0;

          while (i < line.length) {
            const char = line[i];

            if (char === ' ') {
              spaceCount++;
              if (spaceCount === 3) {
                const prevChar = line[i - 1];
                const nextChar = line[i + 1] || '';
                if (isHindiChar(prevChar) && isHindiChar(nextChar)) {
                  // Skip 3rd space if splitting valid Hindi
                  i++; // skip this space
                  continue;
                }
              }
            }

            result += char;
            i++;
          }

          return result.replace(/\s+/g, ' ').trim();
        }





        const rawHindi = lines[toIndex + 1].trim();
        hindiName = cleanHindiText(rawHindi);

        // ✅ Clean English name normally
        englishName = lines[toIndex + 2].replace(/\s+/g, ' ').trim();


      }




      const dob = (text.match(/DOB[:\s]*([0-9]{2}\/[0-9]{2}\/[0-9]{4})/) || [])[1] || '';
      const genderMatch = text.match(/(MALE|FEMALE|पुरुष|महिला)/i);
      let gender = genderMatch ? genderMatch[0].toUpperCase() : '';
      if (gender.includes('MALE') || gender.includes('पुरुष')) gender = 'पुरुष / MALE';
      else if (gender.includes('FEMALE') || gender.includes('महिला')) gender = 'महिला / FEMALE';

      const aadhaar = (text.match(/\d{4}\s\d{4}\s\d{4}/) || [])[0] || '';
      const mobile = (text.match(/Mobile[:\s]*(\d{10})/) || [])[1] || '';
      const vid = (text.match(/VID[:\s]*([\d\s]{16,20})/) || [])[1] || '';
      const issueDate = (text.match(/issued[:\s]*([0-9]{2}\/[0-9]{2}\/[0-9]{4})/) || [])[1] || '';
      const detailsDate = (text.match(/Details\s+as\s+on[:\s]*([0-9]{2}\/[0-9]{2}\/[0-9]{4})/) || [])[1] || '';


      let addressHindi = '', addressEnglish = '';
      const pinRegex = /[-–]\s*\d{6}$/;
      const hindiStartIndex = lines.findIndex(line => /पता[:]?/i.test(line));
      const englishStartIndex = lines.findIndex(line => /Address[:]?/i.test(line));

      if (hindiStartIndex !== -1) {
        const hindiLines = [];
        for (let i = hindiStartIndex + 1; i < lines.length; i++) {
          let cleaned = lines[i].replace(/\s+/g, ' ').replace(/,+$/, '').trim();
          if (cleaned) {
            if (hindiLines.length === 0) {
              cleaned = fixThirdHindiSpace(cleaned); // ✅ Remove 3rd space if it's breaking syllable
            }
            hindiLines.push(cleaned);
          }
          if (pinRegex.test(lines[i])) break;
        }
        addressHindi = hindiLines.join(', ');
      }



      if (englishStartIndex !== -1) {
          const englishLines = [];
          for (let i = englishStartIndex + 1; i < lines.length; i++) {
            const cleaned = lines[i].replace(/\s+/g, ' ').replace(/,+$/, '').trim();
            if (cleaned) englishLines.push(cleaned);
            if (pinRegex.test(lines[i])) break;
          }
          addressEnglish = englishLines.join(', ');
        }



      const cmdImage = `${pdfimagesPath} -j "${decryptedPath}" "${imagePrefix}"`;
      exec(cmdImage, async () => {
        const allFiles = fs.readdirSync(userDir);

               const qrFilename = allFiles.find(f =>
                  f.startsWith(baseName) && f.includes('photo-000') && f.endsWith('.ppm')
                );
                let qrPath = '';

                if (qrFilename) {
                  const ppmPath = path.join(userDir, qrFilename);
                  qrPath = path.join(userDir, `${baseName}_qr.png`);

                  // Use ImageMagick CLI to convert .ppm → .png
                  const convertCmd = `convert "${ppmPath}" "${qrPath}"`;

                  try {
                    await new Promise((resolve, reject) => {
                      exec(convertCmd, (err, stdout, stderr) => {
                        if (err) {
                          console.error('❌ QR conversion failed (magick):', stderr || err.message);
                          qrPath = '';
                          return reject(err);
                        }
                        console.log('✅ QR converted with ImageMagick:', qrPath);
                        resolve();
                      });
                    });
                  } catch (e) {
                    qrPath = '';
                  }
                }



        const photoFilename =
        allFiles.find(f => f.startsWith(baseName) && f.includes('photo-007') && f.endsWith('.jpg')) ||
        allFiles.find(f => f.startsWith(baseName) && f.includes('photo-010') && f.endsWith('.jpg'));

        const photoPath = photoFilename ? path.join(userDir, photoFilename) : '';

        // ✅ Use child template if photo-010 is used
        const isChild = photoFilename && photoFilename.includes('photo-010');

        const frontTemplatePath = isChild
          ? path.join(__dirname, '..', 'template', 'child.png')
          : path.join(__dirname, '..', 'template', 'final.png');

        const backTemplatePath = isChild
          ? path.join(__dirname, '..', 'template', 'child_back.png')
          : path.join(__dirname, '..', 'template', 'back.png');


        const outputName = `generated-${Date.now()}.png`;
        const outputPath = path.join(userDir, outputName);

        const base = await loadImage(frontTemplatePath);
        const canvas = createCanvas(base.width, base.height);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(base, 0, 0);
        ctx.fillStyle = '#000';
        ctx.textAlign = 'left';

        // Final positions (from Photoshop)
        ctx.font = 'bold 60pt "NotoSansHindi"';
        ctx.fillText(hindiName || 'नाम नहीं मिला', 982, 553);

        ctx.font = 'bold 69pt Arial';
        ctx.fillText(englishName || 'Name Not Found', 982, 677);
        ctx.fillText(dob || '—', 1559, 805);

        ctx.font = '60pt "NotoSansHindi"';
        ctx.fillText(gender || '—', 982, 917);

        ctx.font = '70pt Arial';
        ctx.fillText(mobile || '—', 1245, 1061);
        ctx.font = 'bold 130pt Arial';
        ctx.fillText(aadhaar || '—', 947, 1609);
        ctx.font = '60pt Arial';
        ctx.fillText(vid || '—', 1255, 1703);

        // Draw only the issued date (vertically) since label is already on template
        ctx.save();
        ctx.translate(140, 820); // Adjust X (left-right), Y (up-down) as needed
        ctx.rotate(-Math.PI / 2); // Rotate 90° counterclockwise
        ctx.font = 'bold 40pt sans-serif';
        ctx.fillStyle = '#000';
        ctx.fillText(issueDate, 0, 0);
        ctx.restore();



        // 🖼 Profile photo shifted slightly right
        if (photoPath && fs.existsSync(photoPath)) {
          const userPhoto = await loadImage(photoPath);
          ctx.drawImage(userPhoto, 220, 510, 687, 862);
        }
        
        function drawWrappedText(ctx, text, x, y, maxWidth, lineHeight) {
        const words = text.split(' ');
        let line = '';
        for (let n = 0; n < words.length; n++) {
          const testLine = line + words[n] + ' ';
          const metrics = ctx.measureText(testLine);
          const testWidth = metrics.width;
          if (testWidth > maxWidth && n > 0) {
            ctx.fillText(line, x, y);
            line = words[n] + ' ';
            y += lineHeight;
          } else {
            line = testLine;
          }
        }
        ctx.fillText(line, x, y);
      }


                // 📌 Load back template
        const backBase = await loadImage(backTemplatePath);
        const backCanvas = createCanvas(backBase.width, backBase.height);
        const backCtx = backCanvas.getContext('2d');
        backCtx.drawImage(backBase, 0, 0);

        backCtx.fillStyle = '#000';
        backCtx.textAlign = 'left';

        // ✍️ Wrap function (keep this somewhere above if not already defined)
        function drawWrappedText(ctx, text, x, y, maxWidth, lineHeight) {
          const words = text.split(' ');
          let line = '';
          for (let n = 0; n < words.length; n++) {
            const testLine = line + words[n] + ' ';
            const metrics = ctx.measureText(testLine);
            const testWidth = metrics.width;
            if (testWidth > maxWidth && n > 0) {
              ctx.fillText(line, x, y);
              line = words[n] + ' ';
              y += lineHeight;
            } else {
              line = testLine;
            }
          }
          ctx.fillText(line, x, y);
        }

      // 📌 You can now manually control these X/Y values 👇
      const hindiX = 288;
      const hindiY = 733; // Adjust Hindi block starting Y
      const englishX = 288;
      const englishY = 1202; // Adjust English block starting Y

      // 🧾 Hindi Address
      backCtx.font = '65pt "NotoSansHindi"';
      drawWrappedText(backCtx, addressHindi || '—', hindiX, hindiY, 1850, 120);

      // 🌐 English Address
      backCtx.font = '55pt Arial';
      drawWrappedText(backCtx, addressEnglish || '—', englishX, englishY, 1850, 120);



        // 🗓️ Download Date
        backCtx.save();
        backCtx.translate(145, 870); // Adjust X (left-right), Y (up-down) as needed
        backCtx.rotate(-Math.PI / 2); // Rotate 90° counterclockwise
        backCtx.font = 'bold 40pt sans-serif';
        backCtx.fillStyle = '#000';
        backCtx.fillText(detailsDate, 0, 0);
        backCtx.restore();
        

        // 🔢 Aadhaar Number
        backCtx.font = 'bold 130pt Arial';
        backCtx.fillText(aadhaar || '—', 947, 1559);

        // 🔑 VID (Back Side)
        backCtx.font = '60pt Arial';
        backCtx.fillText(vid || '—', 1255, 1760);

       if (qrPath && fs.existsSync(qrPath)) {
        const qrImg = await loadImage(qrPath);
        backCtx.drawImage(qrImg, 2103, 463, 1000,1000); // adjust position & size
      }


        // 💾 Save back image
        const backOutputName = `back-${Date.now()}.png`;
        const backOutputPath = path.join(userDir, backOutputName);

        const out = fs.createWriteStream(outputPath);
        const backOut = fs.createWriteStream(backOutputPath);

        const frontDone = new Promise(resolve => {
          canvas.createPNGStream().pipe(out).on('finish', resolve);
        });

        const backDone = new Promise(resolve => {
          backCanvas.createPNGStream().pipe(backOut).on('finish', resolve);
        });

        Promise.all([frontDone, backDone]).then(() => {
          // ✅ Send response first
          res.json({
            hindiName, englishName, dob, gender, mobile, aadhaar, vid, issueDate, detailsDate,
            photoUrl: photoFilename ? `/images/${baseName}/${photoFilename}` : '',
            downloadUrlFront: `/images/${baseName}/${outputName}`,
            downloadUrlBack: `/images/${baseName}/${backOutputName}`
          });

          // ✅ After sending response, clean up other files
          const keepFiles = [outputName, backOutputName];
          fs.readdir(userDir, (err, files) => {
            if (err) return console.error('❌ Cleanup error:', err);
            files.forEach(file => {
              if (!keepFiles.includes(file)) {
                const filePath = path.join(userDir, file);
                fs.unlink(filePath, err => {
                  if (err) console.warn(`⚠️ Failed to delete ${file}:`, err.message);
                });
              }
            });
          });
        });




      });
    });
  });
});


const frontendPath = path.join(__dirname, '..', 'frontend');
app.use(express.static(frontendPath));

app.get('/', (req, res) => {
  res.sendFile(path.join(frontendPath, 'index.html'));
});


app.listen(5000, () => console.log('✅ Server running at http://localhost:5000'));
