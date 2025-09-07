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


function openDobModal(subtext) {
  if (dobSub) dobSub.textContent = subtext || "";
  if (dobError) {
    dobError.style.display = "none";
    dobError.textContent = "";
  }
  if (dobInput) dobInput.value = "";
  if (dobModal) dobModal.style.display = "flex";
}
function closeDobModal() {
  if (dobModal) dobModal.style.display = "none";
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
  img.onload = null;
  img.onerror = () => {
    console.error("Failed to load image:", img.src);
  };
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
        // Quick client-side year check for smooth UX
        if (String(data.yob) !== yyyy) {
          dobError.textContent = `Year must match ${data.yob}. You picked ${yyyy}.`;
          dobError.style.display = "block";
          return;
        }

        // Submit full DOB to finalize
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
          if (!finalizeRes.ok) {
            dobError.textContent = finalizeData.error || "Failed to finalize.";
            dobError.style.display = "block";
            return;
          }

          closeDobModal();

          // ---- Continue like normal success path using finalize output ----
          const base = window.location.origin;
          const templateFront = document.getElementById("templateFront");
          const templateBack = document.getElementById("templateBack");
          const downloadFront = document.getElementById("downloadFront");
          const downloadBack = document.getElementById("downloadBack");

          templateFront.src = base + finalizeData.downloadUrlFront;
          templateBack.src = base + finalizeData.downloadUrlBack;

          generatedFrontPath = finalizeData.downloadUrlFront;
          generatedBackPath = finalizeData.downloadUrlBack;

          setImageLoadState(templateFront);
          setImageLoadState(templateBack);

          downloadFront.href = templateFront.src;
          downloadBack.href = templateBack.src;

          document.getElementById("templatePreview").style.display = "block";

          await Promise.all([
            new Promise((r) => (templateFront.onload = r)),
            new Promise((r) => (templateBack.onload = r)),
          ]);

          hideInstructionsSmoothly();
          showToast("Aadhaar card generated successfully!");
        } catch (e) {
          console.error(e);
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

      // Assign src first
      templateFront.src = base + data.downloadUrlFront;
      templateBack.src = base + data.downloadUrlBack;

      // Remember server paths for PDF endpoint
      generatedFrontPath = data.downloadUrlFront;
      generatedBackPath = data.downloadUrlBack;

      // Then set image state
      setImageLoadState(templateFront);
      setImageLoadState(templateBack);

      downloadFront.href = templateFront.src;
      downloadBack.href = templateBack.src;

      document.getElementById("templatePreview").style.display = "block";

      await Promise.all([
        new Promise((res) => (templateFront.onload = res)),
        new Promise((res) => (templateBack.onload = res)),
      ]);

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
