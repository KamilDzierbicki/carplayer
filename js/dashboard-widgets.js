import VideoTileRenderer from "./video-tile-renderer.js";

/**
 * Dashboard widget definitions.
 * Each widget: { id, title, group, sizes, defaultSize, defaultEnabled, mount(body, ctx, size) -> cleanup() }
 *   multiple: true lets the dashboard hold several copies, each with its own settings (newSettings(), label(settings)).
 * ctx: { storage, jellyfin (JellyfinService), playJellyfin(itemId, title, serverBaseUrl),
 *        playIptvFavorite(key), playRadioFavorite(stationId), playVideoFavorite(id), settings (this copy's settings), saveSettings(settings) }
 */

// MET Norway (open data, NLOD / CC BY 4.0, commercial use allowed, credit "Data from MET Norway").
// Low-volume sites may call it straight from the browser; responses must be reused until their Expires time.
const WEATHER_API = "https://api.met.no/weatherapi/locationforecast/2.0/compact";
// Photon by komoot (OpenStreetMap data): fair use, one request per city search.
const GEOCODING_API = "https://photon.komoot.io/api/";
const WEATHER_REFRESH_MS = 30 * 60 * 1000;
const JELLYFIN_CACHE_MS = 5 * 60 * 1000;

// MET Norway symbol codes ("partlycloudy_day", "lightrainshowers_night", ...), matched by keyword in this order.
const WEATHER_SYMBOLS = [
  ["thunder", "⛈️", "Thunderstorm"],
  ["sleet", "🌨️", "Sleet"],
  ["snow", "🌨️", "Snow"],
  ["lightrain", "🌦️", "Light rain"],
  ["rain", "🌧️", "Rain"],
  ["fog", "🌫️", "Fog"],
  ["partlycloudy", "🌤️", "Partly cloudy"],
  ["fair", "🌤️", "Fair"],
  ["cloudy", "☁️", "Cloudy"],
  ["clearsky", "☀️", "Clear"],
];

function describeWeather(symbol) {
  const match = WEATHER_SYMBOLS.find(([key]) => String(symbol || "").includes(key));
  return match ? { icon: match[1], label: match[2] } : { icon: "🌡️", label: "" };
}

const forecastCache = new Map();

/** Current conditions and daily min/max from MET Norway, cached until the response's Expires time. */
async function fetchForecast(latitude, longitude) {
  // 2 decimals (about 1 km) are enough for a forecast and share less of the user's exact position;
  // MET allows at most 4, and rounding also keeps the cache key stable.
  const lat = Number(latitude).toFixed(2);
  const lon = Number(longitude).toFixed(2);
  const key = `${lat},${lon}`;
  const cached = forecastCache.get(key);
  if (cached && Date.now() < cached.expiresAt) return cached.forecast;

  // A plain GET without custom headers: MET does not support CORS preflight requests.
  const response = await fetch(`${WEATHER_API}?lat=${lat}&lon=${lon}`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const timeseries = (await response.json())?.properties?.timeseries || [];
  if (!timeseries.length) throw new Error("no forecast data");

  const first = timeseries[0].data;
  const forecast = {
    temperature: first.instant.details.air_temperature,
    windKmh: (first.instant.details.wind_speed || 0) * 3.6,
    symbol: first.next_1_hours?.summary?.symbol_code || first.next_6_hours?.summary?.symbol_code || "",
    days: [],
  };

  const byDay = new Map();
  timeseries.forEach((entry) => {
    const time = new Date(entry.time);
    const day = time.toLocaleDateString("en-CA");
    const bucket = byDay.get(day) || { date: time, min: Infinity, max: -Infinity, symbol: "", symbolHourDistance: 24 };
    const temperature = entry.data.instant.details.air_temperature;
    bucket.min = Math.min(bucket.min, temperature);
    bucket.max = Math.max(bucket.max, temperature);
    // The day's symbol: the 6-hour forecast closest to noon.
    const symbol = entry.data.next_6_hours?.summary?.symbol_code;
    const distance = Math.abs(time.getHours() - 12);
    if (symbol && distance < bucket.symbolHourDistance) {
      bucket.symbol = symbol;
      bucket.symbolHourDistance = distance;
    }
    byDay.set(day, bucket);
  });
  forecast.days = [...byDay.values()].filter((day) => day.symbol).slice(0, 7);

  const expiresAt = Date.parse(response.headers.get("Expires") || "") || Date.now() + WEATHER_REFRESH_MS;
  forecastCache.set(key, { forecast, expiresAt });
  return forecast;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const clockWidget = {
  id: "clock",
  title: "Clock",
  group: "interactive",
  sizes: ["l", "m", "s"],
  defaultSize: "m",
  defaultEnabled: true,
  mount(body, _ctx, size) {
    const time = el("div", "widget-clock__time");
    const date = el("div", "widget-clock__date");
    body.append(time, date);
    const tick = () => {
      const now = new Date();
      time.textContent = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", ...(size === "l" ? { second: "2-digit" } : {}) });
      date.textContent = now.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  },
};

async function findCity(city) {
  const response = await fetch(`${GEOCODING_API}?q=${encodeURIComponent(city)}&limit=5`);
  if (!response.ok) throw new Error(`City search failed (HTTP ${response.status})`);
  const features = (await response.json())?.features || [];
  // Photon ranks by importance; prefer real settlements over districts or boundaries with the same name.
  const place = features.find((feature) => ["city", "town", "village"].includes(feature.properties?.osm_value))
    || features.find((feature) => feature.properties?.osm_key === "place")
    || features[0];
  if (!place) throw new Error("City not found");
  const [longitude, latitude] = place.geometry.coordinates;
  return { mode: "city", name: place.properties.name, latitude, longitude };
}

function locateByGps() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ name: "Current location", latitude: position.coords.latitude, longitude: position.coords.longitude }),
      () => resolve(null),
      { timeout: 8000, maximumAge: 15 * 60 * 1000 },
    );
  });
}

/**
 * Weather for one place. Several weather widgets can be added, one per city.
 * settings.location: undefined or { mode: "gps" } -> current location; { mode: "city", name, latitude, longitude };
 * { mode: "ask" } -> a newly added widget that still needs a city.
 */
const weatherWidget = {
  id: "weather",
  title: "Weather",
  group: "interactive",
  multiple: true,
  sizes: ["l", "m", "s"],
  defaultSize: "m",
  defaultEnabled: true,
  newSettings: () => ({ location: { mode: "ask" } }),
  label: (settings) => {
    const location = settings?.location;
    if (location?.mode === "city") return location.name;
    if (location?.mode === "ask") return "new city";
    return "Current location";
  },
  mount(body, ctx, size) {
    let timer = null;
    let cancelled = false;
    const location = ctx.settings?.location || { mode: "gps" };

    // userOpened: the user tapped "Change". Only then the input takes focus (no surprise keyboard on the car screen)
    // and Cancel is offered, since there is a working view to go back to.
    const showLocationForm = (message, { userOpened = false } = {}) => {
      body.replaceChildren();
      const note = el("p", "widget-note", message);
      const form = el("form", "widget-inline-form");
      const input = el("input", "widget-input");
      input.placeholder = "City, e.g. Kraków";
      input.name = "city";
      const button = el("button", "btn btn--primary btn--compact", "Set");
      button.type = "submit";
      form.append(input, button);
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const city = input.value.trim();
        if (!city) return;
        try {
          ctx.saveSettings({ location: await findCity(city) });
        } catch (error) {
          // fetch() rejects with a TypeError when there is no connection; that is not a problem with the name.
          note.textContent = error instanceof TypeError
            ? "No internet connection. Try again when you are online."
            : `${error.message}. Try another name.`;
        }
      });

      const actions = el("div", "button-row");
      if (navigator.geolocation) {
        const gps = el("button", "btn btn--dark btn--compact", "Use current location");
        gps.type = "button";
        gps.addEventListener("click", () => ctx.saveSettings({ location: { mode: "gps" } }));
        actions.appendChild(gps);
      }
      if (userOpened) {
        const cancel = el("button", "btn btn--ghost btn--compact", "Cancel");
        cancel.type = "button";
        cancel.addEventListener("click", () => void load());
        actions.appendChild(cancel);
      }
      body.append(note, form, actions);
      if (userOpened) input.focus();
    };

    const render = (place, forecast) => {
      const now = describeWeather(forecast.symbol);
      body.replaceChildren();

      const head = el("div", "widget-weather__head");
      head.append(
        el("span", "widget-weather__temp", `${Math.round(forecast.temperature)}°C`),
        el("span", "widget-weather__icon", now.icon),
      );
      const placeName = el("div", "widget-weather__place", place.name);
      const meta = el("div", "widget-note", [now.label, `wind ${Math.round(forecast.windKmh)} km/h`].filter(Boolean).join(" • "));
      body.append(placeName, head, meta);

      if (size !== "s") {
        const days = el("div", "widget-weather__days");
        forecast.days.slice(0, size === "l" ? 7 : 4).forEach((day) => {
          const cell = el("div", "widget-weather__day");
          cell.append(
            el("span", "", day.date.toLocaleDateString([], { weekday: "short" })),
            el("span", "widget-weather__day-icon", describeWeather(day.symbol).icon),
            el("span", "", `${Math.round(day.max)}° / ${Math.round(day.min)}°`),
          );
          days.appendChild(cell);
        });
        body.appendChild(days);
      }

      const footer = el("div", "widget-weather__footer");
      const change = el("button", "link-accent widget-link", "Change location");
      change.type = "button";
      change.addEventListener("click", () => showLocationForm("Show weather for a city, or for your current location.", { userOpened: true }));
      // Credit required by the data licences (MET Norway: CC BY 4.0; places: OpenStreetMap via Photon).
      const credit = el("a", "widget-credit", "Data from MET Norway");
      credit.href = "https://api.met.no/";
      credit.target = "_blank";
      credit.rel = "noopener noreferrer";
      footer.append(change, credit);
      body.appendChild(footer);
    };

    const load = async () => {
      if (location.mode === "ask") {
        showLocationForm("Which city should this widget show?");
        return;
      }
      body.replaceChildren(el("p", "widget-note", "Loading weather..."));
      const place = location.mode === "city" ? location : await locateByGps();
      if (cancelled) return;
      if (!place) {
        showLocationForm("Current location is not available. Enter a city instead.");
        return;
      }

      try {
        const forecast = await fetchForecast(place.latitude, place.longitude);
        if (!cancelled) render(place, forecast);
      } catch (error) {
        if (!cancelled) body.replaceChildren(el("p", "text-error-state", `Weather unavailable (${error.message}).`));
      }
    };

    void load();
    timer = setInterval(() => void load(), WEATHER_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  },
};

const speedWidget = {
  id: "speed",
  title: "GPS Speed",
  group: "interactive",
  sizes: ["m", "s"],
  defaultSize: "s",
  defaultEnabled: true,
  mount(body) {
    const value = el("div", "widget-speed__value", "--");
    const unit = el("div", "widget-speed__unit", "km/h");
    const note = el("div", "widget-note", "Waiting for GPS...");
    body.append(value, unit, note);

    if (!navigator.geolocation) {
      note.textContent = "Location is not available in this browser.";
      return () => {};
    }

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        const speed = position.coords.speed;
        // speed is null when the device cannot measure it (for example standing still on a desktop).
        value.textContent = Number.isFinite(speed) ? String(Math.round(speed * 3.6)) : "0";
        note.textContent = `Accuracy ±${Math.round(position.coords.accuracy)} m`;
      },
      (error) => {
        note.textContent = error.code === error.PERMISSION_DENIED ? "Location permission denied." : "GPS signal unavailable.";
      },
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 },
    );
    return () => navigator.geolocation.clearWatch(watchId);
  },
};

const GRAVITY = 9.80665;
const G_RANGE = 1.2; // outer edge of the meter in g
const TRAIL_MS = 1500;

/**
 * Sports-car style G-meter from the browser's motion sensors (phone in the car; the car screen itself
 * usually has none). The dot shows the force felt in the seat: braking pushes it up, accelerating down,
 * a left turn pushes it right. Calibrate once the phone sits still in its mount: that sample defines
 * "down" and the phone's x axis defines "right", so any mounting angle works.
 */
const gForceWidget = {
  id: "gforce",
  title: "G-Force",
  group: "interactive",
  sizes: ["m", "s"],
  defaultSize: "s",
  defaultEnabled: true,
  mount(body) {
    const canvas = el("canvas", "widget-gforce__canvas");
    const readout = el("div", "widget-gforce__readout");
    const now = el("span", "widget-gforce__now", "0.00 g");
    const tilt = el("span", "widget-note", "");
    readout.append(now, tilt);
    const peaks = el("div", "widget-gforce__peaks");
    const note = el("p", "widget-note", "Waiting for motion sensors...");
    const actions = el("div", "button-row");
    const calibrate = el("button", "btn btn--dark btn--compact", "Calibrate");
    calibrate.type = "button";
    const reset = el("button", "btn btn--ghost btn--compact", "Reset peaks");
    reset.type = "button";
    actions.append(calibrate, reset);
    body.append(canvas, readout, peaks, note, actions);

    let gravity = null; // calibrated gravity vector (device frame)
    let calibrationSamples = [];
    let smoothed = { lat: 0, lon: 0 };
    let trail = [];
    let peak = { accel: 0, brake: 0, left: 0, right: 0 };
    let orientation = null;
    let baseOrientation = null;
    let gotMotion = false;
    let frame = 0;

    const renderPeaks = () => {
      peaks.replaceChildren(
        ...[["Brake", peak.brake], ["Accel", peak.accel], ["Left", peak.left], ["Right", peak.right]].map(([label, value]) => {
          const cell = el("span", "widget-gforce__peak");
          cell.append(el("span", "widget-note", label), el("span", "", `${value.toFixed(2)} g`));
          return cell;
        }),
      );
    };
    renderPeaks();

    const startCalibration = () => {
      gravity = null;
      calibrationSamples = [];
      baseOrientation = orientation ? { ...orientation } : null;
      note.textContent = "Calibrating: keep the car still for a moment...";
    };

    const onMotion = (event) => {
      const a = event.accelerationIncludingGravity;
      if (!a || a.x === null) return;
      gotMotion = true;
      const v = [a.x, a.y, a.z];

      if (!gravity) {
        calibrationSamples.push(v);
        if (calibrationSamples.length >= 30) {
          gravity = [0, 1, 2].map((i) => calibrationSamples.reduce((sum, s) => sum + s[i], 0) / calibrationSamples.length);
          note.textContent = "Calibrated. Mount the phone with its right edge to the car's right.";
        }
        return;
      }

      // Horizontal axes from gravity: right = phone x projected flat, forward = down x right.
      const gLen = Math.hypot(...gravity) || GRAVITY;
      const down = gravity.map((c) => c / gLen);
      const xDotDown = down[0];
      let right = [1 - xDotDown * down[0], -xDotDown * down[1], -xDotDown * down[2]];
      const rLen = Math.hypot(...right) || 1;
      right = right.map((c) => c / rLen);
      const forward = [
        down[1] * right[2] - down[2] * right[1],
        down[2] * right[0] - down[0] * right[2],
        down[0] * right[1] - down[1] * right[0],
      ];
      const linear = v.map((c, i) => c - gravity[i]);
      const lat = (linear[0] * right[0] + linear[1] * right[1] + linear[2] * right[2]) / GRAVITY;
      const lon = (linear[0] * forward[0] + linear[1] * forward[1] + linear[2] * forward[2]) / GRAVITY;

      smoothed = { lat: smoothed.lat * 0.8 + lat * 0.2, lon: smoothed.lon * 0.8 + lon * 0.2 };
      peak = {
        accel: Math.max(peak.accel, smoothed.lon),
        brake: Math.max(peak.brake, -smoothed.lon),
        left: Math.max(peak.left, -smoothed.lat),
        right: Math.max(peak.right, smoothed.lat),
      };
    };

    const onOrientation = (event) => {
      if (event.beta === null) return;
      orientation = { pitch: event.beta, roll: event.gamma };
      if (!baseOrientation) baseOrientation = { ...orientation };
    };

    const draw = () => {
      frame = requestAnimationFrame(draw);
      const styles = getComputedStyle(body);
      const ink = styles.getPropertyValue("--color-ink").trim() || "#fff";
      const muted = styles.getPropertyValue("--color-muted").trim() || "#999";
      const track = styles.getPropertyValue("--color-track").trim() || "rgba(255,255,255,0.15)";
      const accent = styles.getPropertyValue("--color-accent").trim() || "#3e6ae1";

      const size = Math.min(body.clientWidth, 260);
      // Not laid out (hidden behind the player or a closed tab): a negative radius would throw every frame.
      if (size < 40) return;
      const ratio = window.devicePixelRatio || 1;
      if (canvas.width !== size * ratio) {
        canvas.width = size * ratio;
        canvas.height = size * ratio;
        canvas.style.width = `${size}px`;
        canvas.style.height = `${size}px`;
      }
      const ctx = canvas.getContext("2d");
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, size, size);
      const c = size / 2;
      const radius = c - 14;
      const toPx = (g) => (g / G_RANGE) * radius;

      // Rings at 0.5 g and 1 g, crosshair, axis labels.
      ctx.lineWidth = 1;
      [0.5, 1].forEach((g) => {
        ctx.strokeStyle = g === 1 ? muted : track;
        ctx.beginPath();
        ctx.arc(c, c, toPx(g), 0, Math.PI * 2);
        ctx.stroke();
      });
      ctx.strokeStyle = track;
      ctx.beginPath();
      ctx.moveTo(c - radius, c);
      ctx.lineTo(c + radius, c);
      ctx.moveTo(c, c - radius);
      ctx.lineTo(c, c + radius);
      ctx.stroke();
      ctx.fillStyle = muted;
      ctx.font = "11px -apple-system, Arial, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Brake", c, 11);
      ctx.fillText("Accel", c, size - 3);
      ctx.fillText("1 g", c + toPx(1) - 10, c - 4);

      // Felt force: opposite to the car's acceleration.
      const x = c + toPx(Math.max(-G_RANGE, Math.min(G_RANGE, -smoothed.lat)));
      const y = c + toPx(Math.max(-G_RANGE, Math.min(G_RANGE, smoothed.lon)));
      const time = performance.now();
      trail.push({ x, y, time });
      trail = trail.filter((point) => time - point.time < TRAIL_MS);

      trail.forEach((point, index) => {
        const age = (time - point.time) / TRAIL_MS;
        ctx.globalAlpha = Math.max(0, 0.5 * (1 - age));
        ctx.fillStyle = accent;
        ctx.beginPath();
        ctx.arc(point.x, point.y, 3 + 2 * (index / trail.length), 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.globalAlpha = 1;
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.arc(x, y, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = ink;
      ctx.lineWidth = 2;
      ctx.stroke();

      now.textContent = `${Math.hypot(smoothed.lat, smoothed.lon).toFixed(2)} g`;
      if (orientation && baseOrientation) {
        const pitch = orientation.pitch - baseOrientation.pitch;
        const roll = orientation.roll - baseOrientation.roll;
        tilt.textContent = `Pitch ${pitch.toFixed(0)}° · Roll ${roll.toFixed(0)}°`;
      }
      if (frame % 15 === 0) renderPeaks();
    };

    const start = () => {
      window.addEventListener("devicemotion", onMotion);
      window.addEventListener("deviceorientation", onOrientation);
      startCalibration();
      setTimeout(() => {
        if (!gotMotion) note.textContent = "No motion sensor in this browser. Open CarPlayer on a phone mounted in the car.";
      }, 2500);
    };

    // iOS asks for permission, and only after a tap.
    if (typeof DeviceMotionEvent !== "undefined" && typeof DeviceMotionEvent.requestPermission === "function") {
      note.textContent = "Tap Enable sensors to use the phone's accelerometer.";
      const enable = el("button", "btn btn--primary btn--compact", "Enable sensors");
      enable.type = "button";
      enable.addEventListener("click", async () => {
        try {
          const motion = await DeviceMotionEvent.requestPermission();
          if (typeof DeviceOrientationEvent?.requestPermission === "function") await DeviceOrientationEvent.requestPermission();
          if (motion === "granted") {
            enable.remove();
            start();
          } else {
            note.textContent = "Motion sensor access was denied.";
          }
        } catch (error) {
          note.textContent = `Motion sensors unavailable (${error.message}).`;
        }
      });
      actions.prepend(enable);
    } else if (typeof DeviceMotionEvent === "undefined") {
      note.textContent = "No motion sensor in this browser. Open CarPlayer on a phone mounted in the car.";
    } else {
      start();
    }

    calibrate.addEventListener("click", startCalibration);
    reset.addEventListener("click", () => {
      peak = { accel: 0, brake: 0, left: 0, right: 0 };
      renderPeaks();
    });

    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("devicemotion", onMotion);
      window.removeEventListener("deviceorientation", onOrientation);
    };
  },
};

const calculatorWidget = {
  id: "calculator",
  title: "Calculator",
  group: "interactive",
  sizes: ["m"],
  defaultSize: "m",
  defaultEnabled: false,
  mount(body) {
    let expression = "";
    const display = el("output", "widget-calc__display", "0");
    const keys = el("div", "widget-calc__keys");
    ["C", "⌫", "%", "÷", "7", "8", "9", "×", "4", "5", "6", "-", "1", "2", "3", "+", "0", ".", "="].forEach((key) => {
      const button = el("button", `widget-calc__key${/[÷×\-+=]/.test(key) ? " is-operator" : ""}${key === "0" ? " is-wide" : ""}`, key);
      button.type = "button";
      button.dataset.key = key;
      keys.appendChild(button);
    });
    body.append(display, keys);

    keys.addEventListener("click", (event) => {
      const key = event.target.closest("[data-key]")?.dataset.key;
      if (!key) return;
      if (key === "C") expression = "";
      else if (key === "⌫") expression = expression.slice(0, -1);
      else if (key === "=") {
        const result = evaluateExpression(expression);
        expression = Number.isFinite(result) ? String(Number(result.toPrecision(12))) : "";
        display.textContent = Number.isFinite(result) ? expression : "Error";
        return;
      } else expression += key;
      display.textContent = expression || "0";
    });
    return () => {};
  },
};

/** Evaluates "+ - × ÷ %" expressions with operator precedence, without eval(). */
export function evaluateExpression(expression) {
  const tokens = String(expression).match(/\d*\.?\d+%?|[+\-×÷]/g);
  if (!tokens) return NaN;

  const values = [];
  const operators = [];
  const precedence = { "+": 1, "-": 1, "×": 2, "÷": 2 };
  const apply = () => {
    const b = values.pop();
    const a = values.pop();
    const op = operators.pop();
    if (a === undefined || b === undefined) {
      values.push(NaN);
      return;
    }
    values.push(op === "+" ? a + b : op === "-" ? a - b : op === "×" ? a * b : a / b);
  };

  let expectNumber = true;
  let negateNext = false;
  for (const token of tokens) {
    if (precedence[token] && !expectNumber) {
      while (operators.length && precedence[operators[operators.length - 1]] >= precedence[token]) apply();
      operators.push(token);
      expectNumber = true;
    } else if (token === "-" && expectNumber) {
      negateNext = !negateNext;
    } else if (!precedence[token]) {
      const value = token.endsWith("%") ? parseFloat(token) / 100 : parseFloat(token);
      values.push(negateNext ? -value : value);
      negateNext = false;
      expectNumber = false;
    } else {
      return NaN;
    }
  }
  while (operators.length) apply();
  return values.length === 1 ? values[0] : NaN;
}

const todoWidget = {
  id: "todo",
  title: "Todo list",
  group: "interactive",
  sizes: ["l", "m"],
  defaultSize: "m",
  defaultEnabled: false,
  mount(body, ctx) {
    const form = el("form", "widget-inline-form");
    const input = el("input", "widget-input");
    input.placeholder = "Add a task";
    const add = el("button", "btn btn--primary btn--compact", "Add");
    add.type = "submit";
    form.append(input, add);
    const list = el("ul", "widget-todo__list");
    body.append(form, list);

    const render = () => {
      const todos = ctx.storage.getTodos();
      list.replaceChildren(...todos.map((todo, index) => {
        const row = el("li", `widget-todo__item${todo.done ? " is-done" : ""}`);
        const label = el("label", "widget-todo__label");
        const checkbox = el("input");
        checkbox.type = "checkbox";
        checkbox.checked = Boolean(todo.done);
        checkbox.dataset.index = String(index);
        label.append(checkbox, el("span", "", todo.text));
        const remove = el("button", "icon-btn icon-btn--compact");
        remove.type = "button";
        remove.dataset.remove = String(index);
        remove.setAttribute("aria-label", "Delete task");
        remove.appendChild(el("span", "icon icon--sm icon-mask icon-mask--trash"));
        row.append(label, remove);
        return row;
      }));
      if (!todos.length) list.appendChild(el("li", "widget-note", "Nothing to do."));
    };

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      ctx.storage.saveTodos([...ctx.storage.getTodos(), { text, done: false }]);
      input.value = "";
      render();
    });
    list.addEventListener("change", (event) => {
      const index = Number(event.target.dataset.index);
      const todos = ctx.storage.getTodos();
      if (!todos[index]) return;
      todos[index].done = event.target.checked;
      ctx.storage.saveTodos(todos);
      render();
    });
    list.addEventListener("click", (event) => {
      const index = event.target.closest("[data-remove]")?.dataset.remove;
      if (index === undefined) return;
      ctx.storage.saveTodos(ctx.storage.getTodos().filter((_, i) => i !== Number(index)));
      render();
    });

    render();
    return () => {};
  },
};

const jellyfinCache = new Map();

function jellyfinRowWidget({ id, title, load }) {
  return {
    id,
    title,
    group: "jellyfin",
    sizes: ["l", "m"],
    defaultSize: "l",
    defaultEnabled: id === "jf-continue" || id === "jf-movies",
    mount(body, ctx) {
      let cancelled = false;
      const row = el("div", "widget-row");
      body.appendChild(el("p", "widget-note", "Loading..."));

      row.addEventListener("click", (event) => {
        const tile = event.target.closest('[data-play-type="jellyfin"]');
        if (!tile) return;
        ctx.playJellyfin(tile.dataset.itemId, decodeURIComponent(tile.dataset.videoTitle || ""), tile.dataset.serverBaseUrl);
      });

      (async () => {
        const library = await ctx.jellyfin.getLibraryClient();
        if (!library) {
          body.replaceChildren(el("p", "widget-note", "Add your Jellyfin server in the Jellyfin tab to see this."));
          return;
        }
        const cached = jellyfinCache.get(id);
        const items = cached && Date.now() - cached.at < JELLYFIN_CACHE_MS
          ? cached.items
          : await load(library.jf, library.userId);
        jellyfinCache.set(id, { at: cached?.items === items ? cached.at : Date.now(), items });
        if (cancelled) return;

        if (!items.length) {
          body.replaceChildren(el("p", "widget-note", "Nothing here yet."));
          return;
        }
        row.replaceChildren(...items.map((item) => VideoTileRenderer.createJellyfinSearchTile({
          id: item.id,
          title: item.name,
          thumbnailUrl: item.thumb,
          typeText: item.type,
          year: item.year,
          serverBaseUrl: library.jf.baseUrl,
        })));
        body.replaceChildren(row);
      })().catch((error) => {
        if (!cancelled) body.replaceChildren(el("p", "text-error-state", `Jellyfin unavailable (${error.message}).`));
      });

      return () => {
        cancelled = true;
      };
    },
  };
}

const VIDEO_SOURCE_LABELS = { tube: "Tube", youtube: "Tube", iptv: "TV channel", jellyfin: "Jellyfin" };

/**
 * Favorites from every source in one row: videos saved with the heart in the player, IPTV channels and radio
 * stations first (saved on this device, shown at once), then Jellyfin server favorites when a server is set up. Keeps the old "jf-favorites" id so saved layouts carry over.
 */
const favoritesWidget = {
  id: "jf-favorites",
  title: "Favorites",
  group: "interactive",
  sizes: ["l", "m"],
  defaultSize: "l",
  defaultEnabled: true,
  mount(body, ctx) {
    let cancelled = false;
    const row = el("div", "widget-row");
    const videos = ctx.storage.getVideoFavorites();
    // Direct links have no thumbnail link; the frame captured in history stands in while the entry is there.
    const history = ctx.storage.getHistory();
    const frameFor = (id) => history.find((entry) => entry.id === id)?.thumbnailDataUrl || "";
    const localTiles = [
      ...videos.map((video) => VideoTileRenderer.createFavoriteTile({
        playType: "video", key: video.id, title: video.title, logoUrl: video.thumbnailUrl || frameFor(video.id), cover: true,
        metaText: VIDEO_SOURCE_LABELS[video.sourceType] || "Video",
      })),
      ...ctx.storage.getIptvFavorites().map((channel) => VideoTileRenderer.createFavoriteTile({
        playType: "iptv", key: channel.key, title: channel.name, logoUrl: channel.logo, metaText: "TV channel",
      })),
      ...ctx.storage.getRadioFavorites().map((station) => VideoTileRenderer.createFavoriteTile({
        playType: "radio", key: station.id, title: station.name, logoUrl: station.favicon, metaText: "Radio",
      })),
    ];
    const show = (jellyfinTiles, note) => {
      const tiles = [...localTiles, ...jellyfinTiles];
      if (tiles.length) row.replaceChildren(...tiles);
      body.replaceChildren(...(tiles.length ? [row] : []), ...(note ? [note] : []));
    };

    row.addEventListener("click", (event) => {
      const tile = event.target.closest("[data-play-type]");
      if (!tile) return;
      if (tile.dataset.playType === "iptv") ctx.playIptvFavorite(tile.dataset.favoriteKey);
      else if (tile.dataset.playType === "radio") ctx.playRadioFavorite(tile.dataset.favoriteKey);
      else if (tile.dataset.playType === "video") ctx.playVideoFavorite(tile.dataset.favoriteKey);
      else ctx.playJellyfin(tile.dataset.itemId, decodeURIComponent(tile.dataset.videoTitle || ""), tile.dataset.serverBaseUrl);
    });

    show([], localTiles.length ? null : el("p", "widget-note", "Loading..."));
    (async () => {
      const library = await ctx.jellyfin.getLibraryClient();
      if (cancelled) return;
      if (!library) {
        show([], localTiles.length ? null : el("p", "widget-note", "Tap the heart in the player, on an IPTV channel or on a radio station to see it here."));
        return;
      }
      const cached = jellyfinCache.get("jf-favorites");
      const items = cached && Date.now() - cached.at < JELLYFIN_CACHE_MS
        ? cached.items
        : await library.jf.getFavoriteItems(library.userId);
      jellyfinCache.set("jf-favorites", { at: cached?.items === items ? cached.at : Date.now(), items });
      if (cancelled) return;
      // A title saved with the player heart is already in the row; its id is jellyfin-item://<item id>?server=...
      const savedIds = videos.map((video) => video.id);
      const jellyfinTiles = items.filter((item) => !savedIds.some((id) => id.startsWith(`jellyfin-item://${item.id}`))).map((item) => VideoTileRenderer.createJellyfinSearchTile({
        id: item.id,
        title: item.name,
        thumbnailUrl: item.thumb,
        typeText: item.type,
        year: item.year,
        serverBaseUrl: library.jf.baseUrl,
      }));
      show(jellyfinTiles, localTiles.length || jellyfinTiles.length ? null : el("p", "widget-note", "Nothing here yet."));
    })().catch((error) => {
      if (!cancelled) show([], el("p", "text-error-state", `Jellyfin favorites unavailable (${error.message}).`));
    });

    return () => {
      cancelled = true;
    };
  },
};

export const WIDGETS = Object.freeze([
  clockWidget,
  weatherWidget,
  speedWidget,
  gForceWidget,
  calculatorWidget,
  todoWidget,
  jellyfinRowWidget({ id: "jf-continue", title: "Continue watching", load: (jf, userId) => jf.getResumeItems(userId) }),
  jellyfinRowWidget({ id: "jf-movies", title: "Last added movies", load: (jf, userId) => jf.getLatestItems(userId, "Movie") }),
  jellyfinRowWidget({ id: "jf-shows", title: "Last added TV episodes", load: (jf, userId) => jf.getLatestItems(userId, "Episode") }),
  favoritesWidget,
]);
