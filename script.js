/* ==========================================================
   NYC Airbnb Room Type Predictor — front-end logic
   ========================================================== */

const API_BASE = "http://127.0.0.1:8001";
const PREDICT_URL = `${API_BASE}/predict`;
const HEALTH_URL = `${API_BASE}/health`;

const form = document.getElementById("predict-form");
const submitBtn = document.getElementById("submit-btn");
const resetBtn = document.getElementById("reset-btn");
const resultCard = document.getElementById("result");
const resultType = document.getElementById("result-type");
const resultProb = document.getElementById("result-prob");
const resultBar = document.getElementById("result-bar");
const resultNote = document.getElementById("result-note");
const errorBox = document.getElementById("error-box");
const errorText = document.getElementById("error-text");
const apiStatus = document.getElementById("api-status");

/* ---------- Validation rules (mirror backend Pydantic constraints) ---------- */
const rules = {
  latitude:    { min: -90,  max: 90,  integer: false, label: "Latitude" },
  longitude:   { min: -180, max: 180, integer: false, label: "Longitude" },
  price:       { min: 0.01, max: Infinity, integer: false, label: "Price" },
  minimum_nights: { min: 1, max: 365, integer: true,  label: "Minimum nights" },
  number_of_reviews: { min: 0, max: Infinity, integer: true, label: "Number of reviews" },
  reviews_per_month: { min: 0, max: Infinity, integer: false, label: "Reviews per month" },
  calculated_host_listings_count: { min: 0, max: Infinity, integer: true, label: "Host listings count" },
  availability_365: { min: 0, max: 365, integer: true, label: "Availability" },
};

function setFieldError(name, message) {
  const field = form.elements[name].closest(".field");
  const errEl = form.querySelector(`.error[data-for="${name}"]`);
  if (message) {
    field.classList.add("invalid");
    errEl.textContent = message;
  } else {
    field.classList.remove("invalid");
    errEl.textContent = "";
  }
}

function validateField(name) {
  const el = form.elements[name];
  const raw = el.value.trim();

  if (name === "neighbourhood_group" || name === "neighbourhood") {
    if (!raw) return setFieldError(name, "This field is required") || false;
    setFieldError(name, "");
    return true;
  }

  const rule = rules[name];
  if (raw === "") return setFieldError(name, "This field is required") || false;

  const num = Number(raw);
  if (Number.isNaN(num)) return setFieldError(name, "Enter a valid number") || false;
  if (rule.integer && !Number.isInteger(num)) return setFieldError(name, "Must be a whole number") || false;
  if (num < rule.min) return setFieldError(name, `Must be at least ${rule.min}`) || false;
  if (num > rule.max) return setFieldError(name, `Must be at most ${rule.max}`) || false;

  setFieldError(name, "");
  return true;
}

function validateForm() {
  const names = [
    "neighbourhood_group", "neighbourhood", "latitude", "longitude", "price",
    "minimum_nights", "availability_365", "calculated_host_listings_count",
    "number_of_reviews", "reviews_per_month",
  ];
  let ok = true;
  names.forEach((n) => { if (!validateField(n)) ok = false; });
  return ok;
}

/* Live validation on input */
form.querySelectorAll("input, select").forEach((el) => {
  el.addEventListener("blur", () => validateField(el.name));
  el.addEventListener("input", () => {
    if (el.closest(".field").classList.contains("invalid")) validateField(el.name);
  });
});

/* ---------- Build payload exactly matching the backend schema ---------- */
function buildPayload() {
  const v = (n) => form.elements[n].value.trim();
  return {
    latitude: parseFloat(v("latitude")),
    longitude: parseFloat(v("longitude")),
    price: parseFloat(v("price")),
    minimum_nights: parseInt(v("minimum_nights"), 10),
    number_of_reviews: parseInt(v("number_of_reviews"), 10),
    reviews_per_month: parseFloat(v("reviews_per_month")),
    calculated_host_listings_count: parseInt(v("calculated_host_listings_count"), 10),
    availability_365: parseInt(v("availability_365"), 10),
    neighbourhood_group: v("neighbourhood_group"),
    neighbourhood: v("neighbourhood"),
  };
}

/* ---------- UI helpers ---------- */
function setLoading(isLoading) {
  submitBtn.classList.toggle("loading", isLoading);
  submitBtn.disabled = isLoading;
  submitBtn.querySelector(".btn-label").textContent = isLoading ? "Predicting…" : "Predict room type";
}

function hideAll() {
  resultCard.classList.add("hidden");
  errorBox.classList.add("hidden");
}

const NOTES = {
  "Entire home/apt": "The listing profile matches whole-unit rentals, typically priced higher and offering more privacy.",
  "Private room": "The listing profile matches a private room inside a shared residence.",
  "Shared room": "The listing profile matches a shared room, usually the most budget-friendly option.",
};

function showResult(data) {
  const pct = Math.round(data.Probability * 1000) / 10;
  resultType.textContent = data.Predicted_room_type;
  resultNote.textContent = NOTES[data.Predicted_room_type] || "";
  resultCard.classList.remove("hidden");
  resultProb.textContent = "0%";
  resultBar.style.width = "0%";
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      resultBar.style.width = `${pct}%`;
      animateNumber(resultProb, pct);
    });
  });
  resultCard.scrollIntoView({ behavior: "smooth", block: "center" });
  burstConfetti(resultCard);
}

function animateNumber(el, target) {
  const start = performance.now();
  const duration = 900;
  function tick(now) {
    const t = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = `${(target * eased).toFixed(1)}%`;
    if (t < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

function showError(message) {
  errorText.textContent = message;
  errorBox.classList.remove("hidden");
  errorBox.scrollIntoView({ behavior: "smooth", block: "center" });
}

/* ---------- API calls ---------- */
async function checkHealth() {
  const text = apiStatus.querySelector(".status-text");
  try {
    const res = await fetch(HEALTH_URL, { method: "GET" });
    if (!res.ok) throw new Error();
    apiStatus.classList.add("online");
    apiStatus.classList.remove("offline");
    text.textContent = "API online";
  } catch {
    apiStatus.classList.add("offline");
    apiStatus.classList.remove("online");
    text.textContent = "API offline";
  }
}

async function predict(payload) {
  const res = await fetch(PREDICT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    let detail = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (typeof body.detail === "string") detail = body.detail;
      else if (Array.isArray(body.detail)) detail = body.detail.map((d) => d.msg).join("; ");
    } catch { /* ignore parse errors */ }
    throw new Error(detail);
  }
  return res.json();
}

/* ---------- Events ---------- */
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  hideAll();

  if (!validateForm()) {
    showError("Please fix the highlighted fields and try again.");
    return;
  }

  setLoading(true);
  try {
    const data = await predict(buildPayload());
    showResult(data);
  } catch (err) {
    const isNetwork = err instanceof TypeError;
    showError(
      isNetwork
        ? "Could not reach the API. Make sure the server is running on port 8001."
        : err.message
    );
  } finally {
    setLoading(false);
  }
});

resetBtn.addEventListener("click", () => {
  form.reset();
  form.querySelectorAll(".field").forEach((f) => f.classList.remove("invalid"));
  form.querySelectorAll(".error").forEach((e) => (e.textContent = ""));
  hideAll();
});

checkHealth();
setInterval(checkHealth, 15000);

/* =========================================================
   Interactive particle system (cursor trail + click burst)
   ========================================================= */
(function particleSystem() {
  const canvas = document.getElementById("particle-canvas");
  if (!canvas || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const ctx = canvas.getContext("2d");
  const palette = ["#6366f1", "#22d3ee", "#f472b6", "#a78bfa", "#34d399"];
  const particles = [];
  const MAX_PARTICLES = 220;
  let width, height, dpr;
  const mouse = { x: -999, y: -999, active: false };

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function rand(min, max) { return Math.random() * (max - min) + min; }

  function spawn(x, y, count, opts = {}) {
    for (let i = 0; i < count; i++) {
      if (particles.length >= MAX_PARTICLES) particles.shift();
      const angle = opts.burst ? rand(0, Math.PI * 2) : rand(-Math.PI, Math.PI);
      const speed = opts.burst ? rand(2, 7) : rand(0.2, 1.2);
      particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - (opts.burst ? 0 : 0.4),
        life: 1,
        decay: opts.burst ? rand(0.012, 0.024) : rand(0.02, 0.035),
        size: opts.burst ? rand(2, 5) : rand(1.2, 3),
        color: palette[Math.floor(Math.random() * palette.length)],
        gravity: opts.burst ? 0.08 : -0.01,
      });
    }
  }

  window.addEventListener("mousemove", (e) => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
    mouse.active = true;
    spawn(mouse.x, mouse.y, 2);
  });

  window.addEventListener("mouseleave", () => { mouse.active = false; });

  window.addEventListener("click", (e) => {
    spawn(e.clientX, e.clientY, 36, { burst: true });
    const ring = { x: e.clientX, y: e.clientY, r: 0, life: 1 };
    rings.push(ring);
  });

  const rings = [];
  const confetti = [];

  function drawConfetti() {
    for (let i = confetti.length - 1; i >= 0; i--) {
      const c = confetti[i];
      c.vy += 0.35;
      c.x += c.vx;
      c.y += c.vy;
      c.life -= 0.018;
      if (c.life <= 0) { confetti.splice(i, 1); continue; }
      ctx.globalAlpha = c.life;
      ctx.fillStyle = c.color;
      ctx.fillRect(c.x, c.y, 6, 3);
    }
    ctx.globalAlpha = 1;
  }

  function drawRings() {
    for (let i = rings.length - 1; i >= 0; i--) {
      const r = rings[i];
      r.r += 4;
      r.life -= 0.03;
      if (r.life <= 0) { rings.splice(i, 1); continue; }
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(34, 211, 238, ${r.life * 0.6})`;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  function step() {
    ctx.clearRect(0, 0, width, height);

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.vx *= 0.985;
      p.vy += p.gravity;
      p.x += p.vx;
      p.y += p.vy;
      p.life -= p.decay;

      if (p.life <= 0) { particles.splice(i, 1); continue; }

      ctx.globalAlpha = p.life;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * p.life + 0.5, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.shadowBlur = 12;
      ctx.shadowColor = p.color;
      ctx.fill();
    }

    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
    drawRings();
    drawConfetti();
    requestAnimationFrame(step);
  }

  window.addEventListener("confetti", (e) => {
    e.detail.forEach((c) => {
      confetti.push(c);
    });
  });

  window.addEventListener("resize", resize);
  resize();
  step();
})();

/* Confetti burst used after a successful prediction */
function burstConfetti(anchor) {
  const canvas = document.getElementById("particle-canvas");
  if (!canvas) return;
  const rect = anchor.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + 40;
  const colors = ["#6366f1", "#22d3ee", "#f472b6", "#34d399", "#fbbf24"];
  const pieces = Array.from({ length: 50 }, () => ({
    x, y,
    vx: (Math.random() - 0.5) * 10,
    vy: Math.random() * -10 - 4,
    color: colors[Math.floor(Math.random() * colors.length)],
    life: 1,
  }));
  const dispatch = new CustomEvent("confetti", { detail: pieces });
  window.dispatchEvent(dispatch);
}

/* Lightweight 3D tilt on cards for a premium feel */
document.querySelectorAll(".card").forEach((card) => {
  card.addEventListener("mousemove", (e) => {
    const r = card.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    card.style.transform = `perspective(900px) rotateX(${(-py * 3).toFixed(2)}deg) rotateY(${(px * 3).toFixed(2)}deg)`;
  });
  card.addEventListener("mouseleave", () => {
    card.style.transform = "";
    card.style.transition = "transform 0.4s ease";
    setTimeout(() => (card.style.transition = ""), 400);
  });
});
