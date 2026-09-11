const year = document.getElementById("year");
if (year) year.textContent = new Date().getFullYear();

const form = document.getElementById("project-form");
const success = document.getElementById("form-success");
const summary = document.getElementById("enquiry-summary");
const formStatus = document.getElementById("form-status");
const servicesError = document.getElementById("services-error");
const submitButton = form?.querySelector("button[type='submit']");
const submitLabel = submitButton?.querySelector(".submit-label");

document.querySelectorAll("[data-service]").forEach((link) => {
  link.addEventListener("click", () => {
    const service = link.dataset.service;
    const checkbox = [...document.querySelectorAll("input[name='services']")].find((input) => input.value === service);
    if (checkbox) checkbox.checked = true;
  });
});

form?.querySelectorAll("input, textarea").forEach((field) => {
  field.addEventListener("input", () => field.removeAttribute("aria-invalid"));
});

function selectedServices() {
  return [...form.querySelectorAll("input[name='services']:checked")].map((input) => input.value);
}

function validateForm() {
  let firstInvalid = null;
  form.querySelectorAll("input[required], textarea[required]").forEach((field) => {
    const invalid = !field.validity.valid;
    if (invalid) field.setAttribute("aria-invalid", "true");
    else field.removeAttribute("aria-invalid");
    if (invalid && !firstInvalid) firstInvalid = field;
  });

  const hasService = selectedServices().length > 0;
  servicesError.textContent = hasService ? "" : "Choose at least one option.";
  if (!hasService && !firstInvalid) firstInvalid = form.querySelector("input[name='services']");

  if (firstInvalid) {
    firstInvalid.focus();
    formStatus.textContent = "Check the highlighted fields and try again.";
    return false;
  }

  formStatus.textContent = "";
  return true;
}

function buildSummary(data) {
  const optional = (value) => value?.trim() || "Not provided";
  return [
    "SINK SPACE — PROJECT ENQUIRY",
    "",
    `Name: ${data.get("name").trim()}`,
    `Business: ${data.get("business").trim()}`,
    `Email: ${data.get("email").trim()}`,
    `Phone: ${optional(data.get("phone"))}`,
    `Existing website: ${optional(data.get("website"))}`,
    "",
    "WHAT THE BUSINESS DOES",
    data.get("about").trim(),
    "",
    "HELP NEEDED",
    selectedServices().join(", "),
    "",
    "WHAT I WANT TO IMPROVE",
    data.get("improve").trim(),
    "",
    `Budget / project size: ${optional(data.get("budget"))}`
  ].join("\n");
}

form?.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!validateForm()) return;

  submitButton.disabled = true;
  submitLabel.textContent = "Preparing…";
  formStatus.textContent = "Creating your project brief on this device…";

  window.setTimeout(() => {
    const data = new FormData(form);
    summary.value = buildSummary(data);
    const subject = `Project enquiry — ${data.get("business").trim()}`;
    document.getElementById("email-enquiry").href = `mailto:tjsinkspace@gmail.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(summary.value)}`;
    form.hidden = true;
    success.hidden = false;
    submitButton.disabled = false;
    submitLabel.textContent = "Prepare my enquiry";
    success.focus({ preventScroll: true });
    success.scrollIntoView({ behavior: "smooth", block: "center" });
  }, 450);
});

document.getElementById("copy-enquiry")?.addEventListener("click", async () => {
  const copyStatus = document.getElementById("copy-status");
  try {
    await navigator.clipboard.writeText(summary.value);
    copyStatus.textContent = "Copied. Paste it into an email to tjsinkspace@gmail.com or an Instagram message.";
  } catch {
    summary.focus();
    summary.select();
    copyStatus.textContent = "Select the brief above and copy it, then send it to tjsinkspace@gmail.com.";
  }
});

document.getElementById("edit-enquiry")?.addEventListener("click", () => {
  success.hidden = true;
  form.hidden = false;
  form.querySelector("input")?.focus();
});
