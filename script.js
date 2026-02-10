"use strict";
const hint = document.getElementById("hint");
const card = document.getElementById("card");
const stage = document.getElementById("stage");
const selectOverlay = document.getElementById("select-overlay");

let isDragging = false;
let dragOffsetX = 0;
let dragOffsetY = 0;
let redirectTimer = null;

let cardWidth = 0;
let cardHeight = 0;
let posX = 0;
let posY = 0;
let velX = 0;
let velY = 0;
let gravityX = 0;
let gravityY = 0;
let animationId = null;
let lastFrameTime = null;
let orientationListening = false;
let hasSelectedCard = false;
let hasRevealedCard = false;
let motionListening = false;
let lastShakeTime = 0;
let lastAccel = { x: null, y: null, z: null };

const REDIRECT_URL = "https://www.thebelgiantouch.com";
const REDIRECT_KEY = "tbt_redirected";

if (sessionStorage.getItem(REDIRECT_KEY) === "1") {
  window.location.replace(REDIRECT_URL);
}
const EXIT_THRESHOLD = 48;
const GRAVITY_SCALE = 2400;
const MAX_TILT = 45;
const FRICTION = 0.98;
const MAX_DT = 0.05;
const SHAKE_THRESHOLD = 18;
const SHAKE_COOLDOWN = 350;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function applyFriction(value, dt) {
  const damping = Math.pow(FRICTION, dt * 60);
  return value * damping;
}

function updateCardMetrics() {
  const rect = card.getBoundingClientRect();
  cardWidth = rect.width;
  cardHeight = rect.height;
}

function setCardPosition(x, y) {
  posX = x;
  posY = y;
  card.style.left = `${x}px`;
  card.style.top = `${y}px`;
}

function centerCard() {
  updateCardMetrics();
  const left = (window.innerWidth - cardWidth) / 2;
  const top = (window.innerHeight - cardHeight) / 2;
  setCardPosition(left, top);
}

function revealCard() {
  hint.classList.add("is-hidden");
  card.classList.add("is-visible");
  card.setAttribute("aria-hidden", "false");
  centerCard();
  startPhysics();
}

function scheduleRedirect() {
  if (redirectTimer) return;
  redirectTimer = window.setTimeout(() => {
    sessionStorage.setItem(REDIRECT_KEY, "1");
    window.location.replace(REDIRECT_URL);
  }, 2000);
}

function hideCard(shouldRedirect = false) {
  isDragging = false;
  card.classList.remove("is-visible");
  card.style.left = "";
  card.style.top = "";
  card.setAttribute("aria-hidden", "true");
  velX = 0;
  velY = 0;

  if (shouldRedirect) {
    scheduleRedirect();
  }
}

function getScreenAngle() {
  if (
    window.screen &&
    window.screen.orientation &&
    typeof window.screen.orientation.angle === "number"
  ) {
    return window.screen.orientation.angle;
  }
  if (typeof window.orientation === "number") {
    return window.orientation;
  }
  return 0;
}

function handleOrientation(event) {
  if (event.beta === null || event.gamma === null) return;

  let x = clamp(event.gamma, -MAX_TILT, MAX_TILT);
  let y = clamp(event.beta, -MAX_TILT, MAX_TILT);

  const angle = getScreenAngle();
  let mappedX = x;
  let mappedY = y;

  switch (angle) {
    case 90:
      mappedX = y;
      mappedY = -x;
      break;
    case -90:
    case 270:
      mappedX = -y;
      mappedY = x;
      break;
    case 180:
      mappedX = -x;
      mappedY = -y;
      break;
    default:
      break;
  }

  gravityX = (mappedX / MAX_TILT) * GRAVITY_SCALE;
  gravityY = (mappedY / MAX_TILT) * GRAVITY_SCALE;
}

function initOrientation() {
  if (orientationListening || typeof DeviceOrientationEvent === "undefined") {
    return;
  }

  orientationListening = true;

  if (typeof DeviceOrientationEvent.requestPermission === "function") {
    DeviceOrientationEvent.requestPermission()
      .then((state) => {
        if (state === "granted") {
          window.addEventListener("deviceorientation", handleOrientation);
        }
      })
      .catch(() => {});
    return;
  }

  window.addEventListener("deviceorientation", handleOrientation);
}

function handleMotion(event) {
  const accel = event.accelerationIncludingGravity;
  if (!accel) return;

  const x = accel.x ?? 0;
  const y = accel.y ?? 0;
  const z = accel.z ?? 0;

  if (lastAccel.x === null) {
    lastAccel = { x, y, z };
    return;
  }

  const delta =
    Math.abs(x - lastAccel.x) +
    Math.abs(y - lastAccel.y) +
    Math.abs(z - lastAccel.z);

  lastAccel = { x, y, z };

  if (!hasSelectedCard || hasRevealedCard) return;

  const now = event.timeStamp || Date.now();
  if (delta > SHAKE_THRESHOLD && now - lastShakeTime > SHAKE_COOLDOWN) {
    lastShakeTime = now;
    triggerReveal();
  }
}

function initMotion() {
  if (motionListening || typeof DeviceMotionEvent === "undefined") {
    return;
  }

  motionListening = true;

  if (typeof DeviceMotionEvent.requestPermission === "function") {
    DeviceMotionEvent.requestPermission()
      .then((state) => {
        if (state === "granted") {
          window.addEventListener("devicemotion", handleMotion);
        }
      })
      .catch(() => {});
    return;
  }

  window.addEventListener("devicemotion", handleMotion);
}

function lockOrientation() {
  if (
    window.screen &&
    window.screen.orientation &&
    typeof window.screen.orientation.lock === "function"
  ) {
    window.screen.orientation.lock("portrait").catch(() => {});
  }
}

function updateOrientationOverlay() {
  const isLandscape =
    window.matchMedia("(orientation: landscape)").matches ||
    window.innerWidth > window.innerHeight;
  document.body.classList.toggle("is-landscape", isLandscape);
}

function startPhysics() {
  if (animationId) return;
  lastFrameTime = null;
  animationId = window.requestAnimationFrame(step);
}

function step(timestamp) {
  if (!card.classList.contains("is-visible")) {
    animationId = null;
    return;
  }

  if (!lastFrameTime) {
    lastFrameTime = timestamp;
  }

  let dt = (timestamp - lastFrameTime) / 1000;
  lastFrameTime = timestamp;
  dt = Math.min(dt, MAX_DT);

  if (!isDragging) {
    velX += gravityX * dt;
    velY += gravityY * dt;
    velX = applyFriction(velX, dt);
    velY = applyFriction(velY, dt);

    posX += velX * dt;
    posY += velY * dt;

    const maxLeft = Math.max(0, window.innerWidth - cardWidth);
    const maxTop = Math.max(0, window.innerHeight - cardHeight);

    if (posX < 0) {
      posX = 0;
      velX = 0;
    } else if (posX > maxLeft) {
      posX = maxLeft;
      velX = 0;
    }

    if (posY < 0) {
      posY = 0;
      velY = 0;
    } else if (posY > maxTop) {
      posY = maxTop;
      velY = 0;
    }

    card.style.left = `${posX}px`;
    card.style.top = `${posY}px`;
  }

  animationId = window.requestAnimationFrame(step);
}

function isForcedExit(rawLeft, rawTop, currentWidth, currentHeight) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  return (
    rawLeft < -EXIT_THRESHOLD ||
    rawTop < -EXIT_THRESHOLD ||
    rawLeft > vw - currentWidth + EXIT_THRESHOLD ||
    rawTop > vh - currentHeight + EXIT_THRESHOLD
  );
}

function onPointerDown(event) {
  if (!card.classList.contains("is-visible")) return;

  updateCardMetrics();
  isDragging = true;
  velX = 0;
  velY = 0;

  const rect = card.getBoundingClientRect();
  dragOffsetX = event.clientX - rect.left;
  dragOffsetY = event.clientY - rect.top;
  card.setPointerCapture(event.pointerId);
}

function onPointerMove(event) {
  if (!isDragging) return;

  const rawLeft = event.clientX - dragOffsetX;
  const rawTop = event.clientY - dragOffsetY;

  if (isForcedExit(rawLeft, rawTop, cardWidth, cardHeight)) {
    isDragging = false;
    card.releasePointerCapture(event.pointerId);
    hideCard(true);
    return;
  }

  const maxLeft = Math.max(0, window.innerWidth - cardWidth);
  const maxTop = Math.max(0, window.innerHeight - cardHeight);

  const nextLeft = clamp(rawLeft, 0, maxLeft);
  const nextTop = clamp(rawTop, 0, maxTop);
  setCardPosition(nextLeft, nextTop);
}

function onPointerUp(event) {
  if (!isDragging) return;
  isDragging = false;
  card.releasePointerCapture(event.pointerId);
  velX = 0;
  velY = 0;
}

function triggerReveal() {
  if (!hasSelectedCard || hasRevealedCard) return;
  hasRevealedCard = true;
  lockOrientation();
  initOrientation();
  revealCard();
}

function handleCardSelection(event) {
  const button = event.target.closest("button[data-card]");
  if (!button) return;

  event.preventDefault();
  event.stopPropagation();

  const src = button.getAttribute("data-card");
  if (src) {
    card.src = src;
  }

  const width = button.getAttribute("data-card-width");
  const height = button.getAttribute("data-card-height");
  if (width) {
    card.style.width = width;
  } else {
    card.style.removeProperty("width");
  }
  if (height) {
    card.style.height = height;
  } else {
    card.style.removeProperty("height");
  }

  selectOverlay.classList.add("is-hidden");
  hasSelectedCard = true;
  initMotion();
}

selectOverlay.addEventListener("click", handleCardSelection);

document.addEventListener("click", () => {
  triggerReveal();
});

card.addEventListener("pointerdown", onPointerDown);
window.addEventListener("pointermove", onPointerMove);
window.addEventListener("pointerup", onPointerUp);
window.addEventListener("pointercancel", onPointerUp);

window.addEventListener("resize", () => {
  if (!card.classList.contains("is-visible")) return;
  updateCardMetrics();
  const maxLeft = Math.max(0, window.innerWidth - cardWidth);
  const maxTop = Math.max(0, window.innerHeight - cardHeight);
  const nextLeft = clamp(posX, 0, maxLeft);
  const nextTop = clamp(posY, 0, maxTop);
  setCardPosition(nextLeft, nextTop);
});

window.addEventListener("orientationchange", updateOrientationOverlay);
updateOrientationOverlay();

stage.addEventListener("dragstart", (event) => {
  event.preventDefault();
});
