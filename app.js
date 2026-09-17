import { Client, handle_file } from "https://cdn.jsdelivr.net/npm/@gradio/client@2.6.0/dist/index.min.js";

const SPACE_ID = "k2-fsa/OmniVoice";
const SPACE_URL = "https://k2-fsa-omnivoice.hf.space";
const MAX_FILE_SIZE = 30 * 1024 * 1024;

let apiClient;
let referenceFile = null;
let referenceObjectUrl = null;
let mediaRecorder = null;
let recordingStream = null;
let recordingTimer = null;
let recordingStartedAt = 0;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(showToast.timeout);
  showToast.timeout = setTimeout(() => { toast.hidden = true; }, 4200);
}

function connectClient() {
  if (!apiClient) {
    apiClient = Client.connect(SPACE_ID, {
      status_callback: (status) => {
        const message = status?.message || status?.detail;
        if (message) $$('[data-status-message]').forEach((el) => { el.textContent = message; });
      },
    });
  }
  return apiClient;
}

async function loadLanguages() {
  try {
    const response = await fetch(`${SPACE_URL}/gradio_api/openapi.json`);
    if (!response.ok) return;
    const spec = await response.json();
    const languages = spec?.paths?.["/run/_clone_fn"]?.post?.requestBody?.content?.["application/json"]?.schema?.properties?.lang?.enum;
    if (!Array.isArray(languages)) return;
    const datalist = $("#language-options");
    datalist.replaceChildren(...languages.map((language) => {
      const option = document.createElement("option");
      option.value = language;
      return option;
    }));
  } catch {
    // The built-in common-language list remains available when the Space is asleep.
  }
}

function initTabs() {
  $$(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      $$(".tab").forEach((item) => {
        const selected = item === tab;
        item.classList.toggle("is-active", selected);
        item.setAttribute("aria-selected", String(selected));
      });
      $$(".panel").forEach((panel) => {
        const selected = panel.id === tab.dataset.panel;
        panel.classList.toggle("is-active", selected);
        panel.hidden = !selected;
      });
    });
  });
}

function initCounters() {
  [["#clone-text", "#clone-count"], ["#design-text", "#design-count"]].forEach(([inputSelector, countSelector]) => {
    const input = $(inputSelector);
    const count = $(countSelector);
    input.addEventListener("input", () => { count.textContent = `${input.value.length.toLocaleString("en-US")} / 1,000`; });
  });
}

function initRanges() {
  $$("input[type=range]").forEach((range) => {
    const output = $(`output[for="${range.id}"]`);
    const sync = () => {
      if (range.name === "speed") output.value = `${Number(range.value).toFixed(2)}×`;
      else if (range.name === "guidance") output.value = Number(range.value).toFixed(1);
      else output.value = range.value;
    };
    range.addEventListener("input", sync);
    sync();
  });
}

function setReferenceFile(file) {
  if (!file) return;
  if (!file.type.startsWith("audio/") && !/\.(wav|mp3|m4a|ogg|webm|flac)$/i.test(file.name)) {
    showToast("Please choose a valid audio file.");
    return;
  }
  if (file.size > MAX_FILE_SIZE) {
    showToast("Reference audio must be smaller than 30 MB.");
    return;
  }

  referenceFile = file;
  const zone = $("#upload-zone");
  zone.classList.add("has-file");
  $("#upload-title").textContent = file.name;
  $("#upload-help").textContent = `${(file.size / 1024 / 1024).toFixed(1)} MB · play it back to review`;

  if (referenceObjectUrl) URL.revokeObjectURL(referenceObjectUrl);
  referenceObjectUrl = URL.createObjectURL(file);
  const preview = $("#reference-preview");
  preview.src = referenceObjectUrl;
  preview.hidden = false;
  preview.onloadedmetadata = () => {
    const seconds = preview.duration;
    if (Number.isFinite(seconds)) {
      $("#upload-help").textContent = `${seconds.toFixed(1)} seconds · ${(file.size / 1024 / 1024).toFixed(1)} MB`;
      if (seconds < 3 || seconds > 15) showToast("A clean 3–10 second recording works best.");
    }
  };
}

function initUpload() {
  const input = $("#reference-audio");
  const zone = $("#upload-zone");
  const choose = () => input.click();
  zone.addEventListener("click", choose);
  zone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); choose(); }
  });
  input.addEventListener("change", () => setReferenceFile(input.files?.[0]));
  ["dragenter", "dragover"].forEach((type) => zone.addEventListener(type, (event) => {
    event.preventDefault();
    zone.classList.add("is-dragging");
  }));
  ["dragleave", "drop"].forEach((type) => zone.addEventListener(type, (event) => {
    event.preventDefault();
    zone.classList.remove("is-dragging");
  }));
  zone.addEventListener("drop", (event) => setReferenceFile(event.dataTransfer?.files?.[0]));
}

function stopRecordingTracks() {
  recordingStream?.getTracks().forEach((track) => track.stop());
  recordingStream = null;
}

async function toggleRecording() {
  const button = $("#record-button");
  const label = $("span:last-child", button);
  if (mediaRecorder?.state === "recording") {
    mediaRecorder.stop();
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    showToast("This browser does not support microphone recording. You can upload an audio file instead.");
    return;
  }
  try {
    recordingStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    const chunks = [];
    mediaRecorder = new MediaRecorder(recordingStream);
    mediaRecorder.addEventListener("dataavailable", (event) => { if (event.data.size) chunks.push(event.data); });
    mediaRecorder.addEventListener("stop", () => {
      clearInterval(recordingTimer);
      button.classList.remove("is-recording");
      label.textContent = "Record with microphone";
      $("#record-timer").textContent = "";
      const mimeType = mediaRecorder.mimeType || "audio/webm";
      const extension = mimeType.includes("ogg") ? "ogg" : "webm";
      setReferenceFile(new File(chunks, `voice-reference.${extension}`, { type: mimeType }));
      stopRecordingTracks();
    }, { once: true });
    mediaRecorder.start();
    recordingStartedAt = Date.now();
    button.classList.add("is-recording");
    label.textContent = "Stop recording";
    recordingTimer = setInterval(() => {
      const elapsed = Math.floor((Date.now() - recordingStartedAt) / 1000);
      $("#record-timer").textContent = `00:${String(elapsed).padStart(2, "0")}`;
      if (elapsed >= 30 && mediaRecorder.state === "recording") mediaRecorder.stop();
    }, 250);
  } catch {
    showToast("Microphone access failed. Check your browser permission or upload a file.");
  }
}

function settingsFrom(form) {
  const data = new FormData(form);
  const duration = data.get("duration");
  return {
    ns: Number(data.get("steps")),
    gs: Number(data.get("guidance")),
    dn: data.has("denoise"),
    sp: Number(data.get("speed")),
    du: duration ? Number(duration) : null,
    pp: data.has("preprocess"),
    po: data.has("postprocess"),
  };
}

function setResultState(form, state, message = "") {
  const card = $(".result-card", form);
  ["empty", "loading", "ready", "error"].forEach((name) => {
    const element = $(`[data-result-${name}]`, card);
    element.hidden = name !== state;
  });
  if (state === "loading" && message) $("[data-status-message]", card).textContent = message;
  if (state === "error" && message) $("[data-error-message]", card).textContent = message;
}

function setBusy(form, busy) {
  const button = $("button[type=submit]", form);
  button.disabled = busy;
  button.setAttribute("aria-busy", String(busy));
}

function resolveAudioUrl(fileData) {
  if (!fileData) return null;
  const candidate = fileData.url || fileData.path;
  if (!candidate) return null;
  if (/^https?:\/\//i.test(candidate)) return candidate;
  if (fileData.url) return new URL(candidate, SPACE_URL).href;
  return `${SPACE_URL}/gradio_api/file=${encodeURIComponent(candidate)}`;
}

function showResult(form, result) {
  const [fileData, status] = result?.data || [];
  const audioUrl = resolveAudioUrl(fileData);
  if (!audioUrl || (status && status !== "Done.")) throw new Error(status || "The audio file could not be retrieved.");
  const audio = $("[data-result-audio]", form);
  const download = $("[data-download]", form);
  audio.src = audioUrl;
  download.href = audioUrl;
  setResultState(form, "ready");
  audio.play().catch(() => {});
}

function friendlyError(error) {
  const raw = String(error?.message || error || "");
  if (/gpu|quota|queue|capacity|busy/i.test(raw)) return "The model is busy right now. Please try again in a few minutes.";
  if (/fetch|network|connection|cors/i.test(raw)) return "Could not reach the voice service. Check your internet connection and try again.";
  if (/reference audio|ref_aud/i.test(raw)) return "The reference audio could not be read. Try another audio file.";
  return raw.replace(/^Error:\s*/i, "") || "Something unexpected happened. Please try again.";
}

async function submitClone(event) {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  if (!referenceFile) { showToast("Upload or record a reference voice first."); $("#upload-zone").focus(); return; }
  const data = new FormData(form);
  setBusy(form, true);
  setResultState(form, "loading", "Connecting to the voice model…");
  try {
    const client = await connectClient();
    $("[data-status-message]", form).textContent = "Processing the reference and generating speech…";
    const result = await client.predict("/_clone_fn", {
      text: String(data.get("text")).trim(),
      lang: String(data.get("language") || "Auto").trim() || "Auto",
      ref_aud: handle_file(referenceFile),
      ref_text: String(data.get("referenceText") || "").trim(),
      instruct: String(data.get("instruct") || "").trim(),
      ...settingsFrom(form),
    });
    showResult(form, result);
  } catch (error) {
    console.error(error);
    setResultState(form, "error", friendlyError(error));
  } finally {
    setBusy(form, false);
  }
}

async function submitDesign(event) {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  const data = new FormData(form);
  setBusy(form, true);
  setResultState(form, "loading", "Connecting to the voice model…");
  try {
    const client = await connectClient();
    $("[data-status-message]", form).textContent = "Creating a new voice with your selected character…";
    const result = await client.predict("/_design_fn", {
      text: String(data.get("text")).trim(),
      lang: String(data.get("language") || "Auto").trim() || "Auto",
      ...settingsFrom(form),
      param_9: data.get("gender"),
      param_10: data.get("age"),
      param_11: data.get("pitch"),
      param_12: data.get("style"),
      param_13: data.get("accent"),
      param_14: data.get("dialect"),
    });
    showResult(form, result);
  } catch (error) {
    console.error(error);
    setResultState(form, "error", friendlyError(error));
  } finally {
    setBusy(form, false);
  }
}

function initResultResets() {
  $$('[data-reset]').forEach((button) => button.addEventListener("click", () => {
    const form = button.closest("form");
    setResultState(form, "empty");
    const audio = $("[data-result-audio]", form);
    audio.pause();
    audio.removeAttribute("src");
  }));
}

initTabs();
initCounters();
initRanges();
initUpload();
initResultResets();
$("#record-button").addEventListener("click", toggleRecording);
$("#clone-form").addEventListener("submit", submitClone);
$("#design-form").addEventListener("submit", submitDesign);
window.addEventListener("beforeunload", stopRecordingTracks);
loadLanguages();
