import VideoTileRenderer from "./video-tile-renderer.js";

/**
 * Dashboard widget definitions.
 * Each widget: { id, title, group, sizes, defaultSize, defaultEnabled, mount(body, ctx, size) -> cleanup() }
 * ctx: { storage, jellyfin (JellyfinService), playJellyfin(itemId, title, serverBaseUrl) }
 */

const WEATHER_API = "https://api.open-meteo.com/v1/forecast";
const GEOCODING_API = "https://geocoding-api.open-meteo.com/v1/search";
const WEATHER_REFRESH_MS = 30 * 60 * 1000;
const JELLYFIN_CACHE_MS = 5 * 60 * 1000;

// WMO weather interpretation codes used by Open-Meteo.
const WEATHER_CODES = [
  [[0], "☀️", "Clear"],
  [[1, 2], "🌤️", "Partly cloudy"],
  [[3], "☁️", "Overcast"],
  [[45, 48], "🌫️", "Fog"],
  [[51, 53, 55, 56, 57], "🌦️", "Drizzle"],
  [[61, 63, 65, 66, 67, 80, 81, 82], "🌧️", "Rain"],
  [[71, 73, 75, 77, 85, 86], "🌨️", "Snow"],
  [[95, 96, 99], "⛈️", "Thunderstorm"],
];

function describeWeather(code) {
  const match = WEATHER_CODES.find(([codes]) => codes.includes(Number(code)));
  return match ? { icon: match[1], label: match[2] } : { icon: "🌡️", label: "" };
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

const weatherWidget = {
  id: "weather",
  title: "Weather",
  group: "interactive",
  sizes: ["l", "m", "s"],
  defaultSize: "m",
  defaultEnabled: true,
  mount(body, ctx, size) {
    let timer = null;
    let cancelled = false;

    const showLocationForm = (message) => {
      body.replaceChildren();
      const note = el("p", "widget-note", message);
      const form = el("form", "widget-inline-form");
      const input = el("input", "widget-input");
      input.placeholder = "City, e.g. Warszawa";
      input.name = "city";
      const button = el("button", "btn btn--primary btn--compact", "Set");
      button.type = "submit";
      form.append(input, button);
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const city = input.value.trim();
        if (!city) return;
        try {
          // Native names only match in their language ("Warszawa" finds Warsaw only with language=pl),
          // and the first match can be a small namesake place, so merge languages and prefer the most populated.
          const languages = [...new Set([String(navigator.language || "en").slice(0, 2), "pl", "en"])];
          const lists = await Promise.all(languages.map(async (language) => {
            const response = await fetch(`${GEOCODING_API}?name=${encodeURIComponent(city)}&count=5&language=${language}`);
            return response.ok ? ((await response.json())?.results || []) : [];
          }));
          const place = lists.flat().sort((a, b) => (Number(b.population) || 0) - (Number(a.population) || 0))[0];
          if (!place) throw new Error("City not found");
          ctx.storage.saveWeatherLocation({ name: place.name, latitude: place.latitude, longitude: place.longitude, manual: true });
          void load();
        } catch (error) {
          note.textContent = `${error.message}. Try another name.`;
        }
      });
      body.append(note, form);
    };

    const locate = () => new Promise((resolve) => {
      if (!navigator.geolocation) {
        resolve(null);
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (position) => resolve({ name: "", latitude: position.coords.latitude, longitude: position.coords.longitude }),
        () => resolve(null),
        { timeout: 8000, maximumAge: 15 * 60 * 1000 },
      );
    });

    const render = (location, data) => {
      const current = data.current || {};
      const now = describeWeather(current.weather_code);
      body.replaceChildren();

      const head = el("div", "widget-weather__head");
      head.append(
        el("span", "widget-weather__temp", `${Math.round(current.temperature_2m)}°C`),
        el("span", "widget-weather__icon", now.icon),
      );
      const meta = el("div", "widget-note", [location.name, now.label, `wind ${Math.round(current.wind_speed_10m)} km/h`].filter(Boolean).join(" • "));
      body.append(head, meta);

      if (size !== "s") {
        const days = el("div", "widget-weather__days");
        const daily = data.daily || {};
        (daily.time || []).slice(0, size === "l" ? 7 : 4).forEach((day, index) => {
          const cell = el("div", "widget-weather__day");
          cell.append(
            el("span", "", new Date(day).toLocaleDateString([], { weekday: "short" })),
            el("span", "widget-weather__day-icon", describeWeather(daily.weather_code[index]).icon),
            el("span", "", `${Math.round(daily.temperature_2m_max[index])}° / ${Math.round(daily.temperature_2m_min[index])}°`),
          );
          days.appendChild(cell);
        });
        body.appendChild(days);
      }

      if (location.manual) {
        const change = el("button", "link-accent widget-link", "Change city");
        change.type = "button";
        change.addEventListener("click", () => showLocationForm("Weather for which city?"));
        body.appendChild(change);
      }
    };

    const load = async () => {
      body.replaceChildren(el("p", "widget-note", "Loading weather..."));
      const stored = ctx.storage.getWeatherLocation();
      const location = stored?.manual ? stored : (await locate()) || stored;
      if (cancelled) return;
      if (!location) {
        showLocationForm("Location is not available. Enter a city instead.");
        return;
      }
      if (!location.manual) ctx.storage.saveWeatherLocation(location);

      try {
        const params = new URLSearchParams({
          latitude: location.latitude,
          longitude: location.longitude,
          current: "temperature_2m,weather_code,wind_speed_10m",
          daily: "weather_code,temperature_2m_max,temperature_2m_min",
          timezone: "auto",
          forecast_days: "7",
        });
        const response = await fetch(`${WEATHER_API}?${params.toString()}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        if (!cancelled) render(location, data);
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
          body.replaceChildren(el("p", "widget-note", "Add your Jellyfin server in Settings to see this."));
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

export const WIDGETS = Object.freeze([
  clockWidget,
  weatherWidget,
  speedWidget,
  calculatorWidget,
  todoWidget,
  jellyfinRowWidget({ id: "jf-continue", title: "Continue watching", load: (jf, userId) => jf.getResumeItems(userId) }),
  jellyfinRowWidget({ id: "jf-movies", title: "Last added movies", load: (jf, userId) => jf.getLatestItems(userId, "Movie") }),
  jellyfinRowWidget({ id: "jf-shows", title: "Last added TV episodes", load: (jf, userId) => jf.getLatestItems(userId, "Episode") }),
  jellyfinRowWidget({ id: "jf-favorites", title: "Favorites", load: (jf, userId) => jf.getFavoriteItems(userId) }),
]);
