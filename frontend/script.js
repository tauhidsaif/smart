console.log("Script loaded");

const form = document.getElementById("uploadForm");
const spinner = document.getElementById("spinner");
const btnText = document.getElementById("btnText");
const submitBtn = document.getElementById("submitBtn");
const cardFlipper = document.getElementById("cardFlipper");
const toast = document.getElementById("toast");
const darkToggle = document.getElementById("darkToggle");

// --- DOB modal elements ---
const dobModal = document.getElementById("dobModal");
const dobSub = document.getElementById("dobSub");
const dobInput = document.getElementById("dobInput");
const dobError = document.getElementById("dobError");
const dobCancel = document.getElementById("dobCancel");
const dobConfirm = document.getElementById("dobConfirm");

// --- KEYBOARD: allow Enter to submit in main form and in DOB modal ---

// If file input focused + user presses Enter -> submit the form (start generation)
const aadhaarFile = document.getElementById("aadhaarFile");
if (aadhaarFile) {
  aadhaarFile.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      // trigger the same action as clicking submit
      submitBtn.click();
    }
  });
}

// If DOB input focused + user presses Enter -> act like clicking Confirm
if (dobInput) {
  dobInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      // click the confirm button (handler is wired when modal opens)
      if (typeof dobConfirm.click === "function") dobConfirm.click();
    }
  });
}


// ---------- ADD THIS NEAR THE TOP OF script.js ----------
async function ensureUrlAvailable(url, attempts = 6, delayMs = 250) {
  for (let i = 0; i < attempts; i++) {
    try {
      // HEAD is lightweight and should work for same-origin static files
      const r = await fetch(url, { method: "HEAD", cache: "no-store" });
      if (r.ok) return true;
    } catch (err) {
      // swallow and retry
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return false;
}
// ---------------------------------------

// Smooth modal open/close using classes and animations (replacement)
function openDobModal(subtext) {
  if (dobSub) dobSub.textContent = subtext || "";
  if (dobError) {
    dobError.style.display = "none";
    dobError.textContent = "";
  }
  if (dobInput) dobInput.value = "";

  // Ensure overlay uses class names expected by CSS
  if (dobModal) {
    dobModal.classList.remove("hide");
    dobModal.classList.add("modal-overlay"); // ensure CSS selector matches
    // add modal-card to the inner card (if HTML doesn't have it, JS will wrap)
    const card = dobModal.querySelector(".modal-card");
    if (!card) {
      // find the immediate child that is the card and tag it for animation
      const inner = dobModal.firstElementChild;
      if (inner) inner.classList.add("modal-card");
    }
    // show overlay (CSS transition)
    requestAnimationFrame(() => dobModal.classList.add("show"));
    // make sure aria visible
    dobModal.setAttribute("aria-hidden", "false");
    dobModal.style.display = "flex";
  }
}

function closeDobModal() {
  if (!dobModal) return;
  // play exit animation: add hide to modal-card
  const card = dobModal.querySelector(".modal-card");
  if (card) card.classList.add("hide");

  // remove overlay show to trigger fade-out
  dobModal.classList.remove("show");

  // after animation finishes, hide completely
  const cleanup = () => {
    dobModal.style.display = "none";
    if (card) card.classList.remove("hide");
    dobModal.removeEventListener("transitionend", cleanup);
    dobModal.setAttribute("aria-hidden", "true");
  };

  // listen for overlay opacity transition end; fallback timeout
  dobModal.addEventListener("transitionend", cleanup);
  setTimeout(cleanup, 360); // safe fallback in case transitionend didn't fire
}

function showDobSpinner() {
  const s = document.getElementById("dobSpinner");
  const t = document.getElementById("dobBtnText");
  const cancel = document.getElementById("dobCancel");
  if (s) s.classList.remove("hidden");
  if (t) t.textContent = "Generating...";
  if (cancel) cancel.disabled = true;
  const confirm = document.getElementById("dobConfirm");
  if (confirm) confirm.disabled = true;
}

function hideDobSpinner() {
  const s = document.getElementById("dobSpinner");
  const t = document.getElementById("dobBtnText");
  const cancel = document.getElementById("dobCancel");
  if (s) s.classList.add("hidden");
  if (t) t.textContent = "Confirm";
  if (cancel) cancel.disabled = false;
  const confirm = document.getElementById("dobConfirm");
  if (confirm) confirm.disabled = false;
}

// keep track of uploaded base name for naming the PDF
let uploadedBaseName = "";

// to remember generated image paths for PDF endpoint
let generatedFrontPath = "";
let generatedBackPath = "";

// DARK MODE
if (localStorage.getItem("theme") === "dark") {
  darkToggle.checked = true;
  document.body.classList.add("dark");
}

darkToggle.addEventListener("change", () => {
  document.body.classList.toggle("dark", darkToggle.checked);
  localStorage.setItem("theme", darkToggle.checked ? "dark" : "light");
});

// FLIP CARD
cardFlipper.addEventListener("click", () => {
  cardFlipper.classList.toggle("flipped");
});

// TOAST
function showToast(message = "Success!") {
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 4000);
}

// SET IMAGE STATE
function setImageLoadState(img) {
  img.addEventListener(
    "error",
    () => {
      console.error("Failed to load image:", img.src);
      showToast("Failed to load generated image.");
    },
    { once: true } // listener removed after first trigger
  );
}

// --- Wait for an image to load, reject on error or timeout ---
function waitForImageLoad(img, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    // if already loaded successfully
    if (img.complete && img.naturalWidth && img.naturalWidth > 0) {
      return resolve();
    }

    let timer = setTimeout(() => {
      cleanup();
      reject(new Error("Image load timeout"));
    }, timeoutMs);

    function onLoad() {
      cleanup();
      resolve();
    }
    function onError(e) {
      cleanup();
      reject(new Error("Image failed to load"));
    }
    function cleanup() {
      clearTimeout(timer);
      img.removeEventListener("load", onLoad);
      img.removeEventListener("error", onError);
    }

    img.addEventListener("load", onLoad, { once: true });
    img.addEventListener("error", onError, { once: true });
  });
}

// Hide instructions smoothly (visible again on refresh)
function hideInstructionsSmoothly() {
  const box = document.getElementById("instructions");
  if (!box) return;
  box.style.opacity = "0";
  box.style.transform = "translateY(-8px)";
  box.addEventListener(
    "transitionend",
    () => {
      box.style.display = "none";
    },
    { once: true }
  );
}

// FORM SUBMISSION
form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const file = document.getElementById("aadhaarFile").files[0];
  let passwordInput = document.getElementById("password");
  let passwordError = document.getElementById("passwordError");

  if (!file) return;

  // filename (without extension)
  uploadedBaseName = file.name.split(".")[0];

  // Take filename (without extension) as default password
  let autoPassword = uploadedBaseName;
  let password = passwordInput.value.trim() || autoPassword;

  const formData = new FormData();
  formData.append("aadhaar", file);
  formData.append("password", password);

  submitBtn.disabled = true;
  spinner.classList.remove("hidden");
  btnText.textContent = "Generating...";

  try {
    const res = await fetch("/upload", {
      method: "POST",
      body: formData,
    });

    const data = await res.json();

    // --- YOB-only flow: backend is asking for a full DOB ---
    if (data.requiresDob) {
      // IMPORTANT FIX: use server's canonical baseName for finalize-dob
      uploadedBaseName = data.baseName; // <-- add this line
      // Show the DOB modal with the server-provided YOB
      openDobModal(
        `Aadhaar contains only Year of Birth (${data.yob}). Please enter full date of birth.`
      );

      // Wire buttons (overwrite old handlers to avoid stacking)
      dobCancel.onclick = () => {
        closeDobModal();
        // Nothing else to do; the submit's finally{} will restore the button state
      };

      dobConfirm.onclick = async () => {
        const iso = dobInput.value; // yyyy-mm-dd from <input type="date">
        if (!iso) {
          dobError.textContent = "Please pick a date.";
          dobError.style.display = "block";
          return;
        }
        const [yyyy, mm, dd] = iso.split("-");
        if (String(data.yob) !== yyyy) {
          dobError.textContent = `Year must match ${data.yob}. You picked ${yyyy}.`;
          dobError.style.display = "block";
          return;
        }

        // show spinner inside modal and disable controls
        showDobSpinner();

        try {
          const finalizeRes = await fetch("/finalize-dob", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              baseName: uploadedBaseName, // same as server folder name
              dobFull: `${dd}/${mm}/${yyyy}`, // dd/mm/yyyy
            }),
          });

          const finalizeData = await finalizeRes.json();

          // --- child/adult flag from server (inserted server-side) ---
          const isChild = !!finalizeData.isChild;
          const photoFilenameFromServer = finalizeData.photoFilename || "";
          console.log(
            "finalize-dob: isChild =",
            isChild,
            "photo:",
            photoFilenameFromServer
          );

          // optionally store or mark the preview container with the detected type
          const previewContainer = document.getElementById("templatePreview");
          if (previewContainer) {
            previewContainer.dataset.type = isChild ? "child" : "adult";
          }

          if (!finalizeRes.ok) {
            hideDobSpinner();
            dobError.textContent = finalizeData.error || "Failed to finalize.";
            dobError.style.display = "block";
            return;
          }

          // --- Robust flow to avoid lazy-loading / hidden-element issues ---
          const base = window.location.origin;
          const templateFront = document.getElementById("templateFront");
          const templateBack = document.getElementById("templateBack");
          const downloadFront = document.getElementById("downloadFront");
          const downloadBack = document.getElementById("downloadBack");

          // Build and encode URLs (protect against spaces/special chars)
          const frontUrlRaw = base + finalizeData.downloadUrlFront;
          const backUrlRaw = base + finalizeData.downloadUrlBack;
          const frontUrl = encodeURI(frontUrlRaw);
          const backUrl = encodeURI(backUrlRaw);

          // Quick server-availability check
          const okFront = await ensureUrlAvailable(frontUrl, 8, 300);
          const okBack = await ensureUrlAvailable(backUrl, 8, 300);

          if (!okFront || !okBack) {
            hideDobSpinner();
            dobError.textContent =
              "Generated images not yet available; please try again in a moment.";
            dobError.style.display = "block";
            return;
          }

          // Ensure browser will fetch images immediately even if hidden
          try {
            templateFront.loading = "eager";
          } catch (e) {}
          try {
            templateBack.loading = "eager";
          } catch (e) {}

          // Attach error handlers BEFORE assigning src
          setImageLoadState(templateFront);
          setImageLoadState(templateBack);

          // Set download links (cache-busted)
          downloadFront.href = frontUrl + "?_=" + Date.now();
          downloadBack.href = backUrl + "?_=" + Date.now();

          // Make preview visible BEFORE assigning src to avoid lazy-defer
          document.getElementById("templatePreview").style.display = "block";

          // Assign src last (cache-busted)
          templateFront.src = frontUrl + "?_=" + Date.now();
          templateBack.src = backUrl + "?_=" + Date.now();

          // store paths for PDF generation
          generatedFrontPath = finalizeData.downloadUrlFront;
          generatedBackPath = finalizeData.downloadUrlBack;

          // Wait for images to load (spinner still shown)
          try {
            await Promise.all([
              waitForImageLoad(templateFront, 20000),
              waitForImageLoad(templateBack, 20000),
            ]);
          } catch (err) {
            console.error("Image load error (finalize-dob):", err);
            hideDobSpinner();
            dobError.textContent =
              "Failed to load generated images. Please try again or check the server.";
            dobError.style.display = "block";
            return;
          }

          // Images loaded successfully — hide spinner and close modal
          hideDobSpinner();
          closeDobModal();

          // then show preview and toast (same as main success flow)
          document.getElementById("templatePreview").style.display = "block";
          hideInstructionsSmoothly();
          showToast("Aadhaar card generated successfully!");
        } catch (e) {
          console.error(e);
          hideDobSpinner();
          dobError.textContent = "Something went wrong while finalizing.";
          dobError.style.display = "block";
        }
      };

      // IMPORTANT: Stop the normal success flow now; the submit's finally{} will run.
      return;
    }

    if (data.error) {
      passwordError.textContent =
        "❌ Wrong password detected. Please enter it manually.";
      passwordError.style.display = "block";
      passwordInput.style.display = "block"; // show password box
      passwordInput.focus();
      return;
    } else {
      passwordError.style.display = "none"; // clear error if success
      const base = window.location.origin;
      const templateFront = document.getElementById("templateFront");
      const templateBack = document.getElementById("templateBack");
      const downloadFront = document.getElementById("downloadFront");
      const downloadBack = document.getElementById("downloadBack");

      const frontUrl = base + data.downloadUrlFront;
      const backUrl = base + data.downloadUrlBack;

      const okFront = await ensureUrlAvailable(frontUrl, 6, 300);
      const okBack = await ensureUrlAvailable(backUrl, 6, 300);

      if (!okFront || !okBack) {
        // server didn't respond yet: inform user and stop
        showToast("Server still preparing images — try again in a moment.");
        // Optionally keep preview hidden:
        document.getElementById("templatePreview").style.display = "none";
        return;
      }

      // cache-bust and assign
      templateFront.src = frontUrl + "?_=" + Date.now();
      templateBack.src = backUrl + "?_=" + Date.now();

      generatedFrontPath = data.downloadUrlFront;
      generatedBackPath = data.downloadUrlBack;

      setImageLoadState(templateFront);
      setImageLoadState(templateBack);

      downloadFront.href = templateFront.src;
      downloadBack.href = templateBack.src;

      document.getElementById("templatePreview").style.display = "block";

      try {
        await Promise.all([
          waitForImageLoad(templateFront, 20000),
          waitForImageLoad(templateBack, 20000),
        ]);
      } catch (err) {
        console.error("Image load error (upload):", err);
        // hide preview if images failed
        document.getElementById("templatePreview").style.display = "none";
        showToast("Failed to load generated image. Try again.");
        return;
      }

      // Smoothly hide the instruction box (returns on refresh)
      hideInstructionsSmoothly();

      showToast("Aadhaar card generated successfully!");
    }
  } catch (err) {
    console.error("Upload failed", err);
    alert("Something went wrong");
  } finally {
    btnText.textContent = "Generate Aadhaar Card";
    spinner.classList.add("hidden");
    submitBtn.disabled = false;
  }
});

// PDF GENERATION
const pdfBtn = document.getElementById("pdfBtn");
const pdfSpinner = document.getElementById("pdfSpinner");
const pdfBtnText = document.getElementById("pdfBtnText");

pdfBtn.addEventListener("click", async () => {
  if (!generatedFrontPath || !generatedBackPath) return;

  pdfBtn.disabled = true;
  pdfSpinner.classList.remove("hidden");
  pdfBtnText.textContent = "Creating PDF...";

  try {
    // Send only the pathnames the server can resolve
    const payload = {
      frontPath: new URL(window.location.origin + generatedFrontPath).pathname,
      backPath: new URL(window.location.origin + generatedBackPath).pathname,
      baseName: uploadedBaseName,
    };

    const res = await fetch("/generate-pdf", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      throw new Error("PDF generation failed");
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${uploadedBaseName}-pdf.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (e) {
    console.error(e);
    alert("Failed to generate PDF");
  } finally {
    pdfBtnText.textContent = "Download Aadhaar PDF";
    pdfSpinner.classList.add("hidden");
    pdfBtn.disabled = false;
  }
});
