export type BrowserLocation = {
  lng: number;
  lat: number;
  accuracy: number;
  coordType: "wgs84";
};

const LOCATION_CACHE_KEY = "gowith.browserLocation.v1";
const DEFAULT_LOCATION_TTL_MS = 30 * 60 * 1000;

type CachedBrowserLocation = BrowserLocation & {
  capturedAt: number;
};

let cachedLocation: CachedBrowserLocation | null = null;
let cachedLocationPromise: Promise<BrowserLocation> | null = null;

function isFresh(
  location: CachedBrowserLocation | null,
  maxAgeMs = DEFAULT_LOCATION_TTL_MS,
) {
  if (!location) return false;
  const ageMs = Date.now() - location.capturedAt;
  return Boolean(
    ageMs >= 0 && ageMs <= maxAgeMs,
  );
}

function readStoredLocation() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LOCATION_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachedBrowserLocation>;
    if (
      typeof parsed.lng !== "number" ||
      typeof parsed.lat !== "number" ||
      typeof parsed.accuracy !== "number" ||
      parsed.coordType !== "wgs84" ||
      typeof parsed.capturedAt !== "number"
    ) {
      return null;
    }
    return parsed as CachedBrowserLocation;
  } catch {
    return null;
  }
}

function writeStoredLocation(location: CachedBrowserLocation) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LOCATION_CACHE_KEY, JSON.stringify(location));
  } catch {
    // Storage may be disabled. In-memory cache still keeps this app session fast.
  }
}

export function getCachedBrowserLocation(
  maxAgeMs = DEFAULT_LOCATION_TTL_MS,
): BrowserLocation | null {
  if (isFresh(cachedLocation, maxAgeMs)) return cachedLocation;
  const storedLocation = readStoredLocation();
  if (isFresh(storedLocation, maxAgeMs)) {
    cachedLocation = storedLocation;
    return storedLocation;
  }
  return null;
}

export function getBrowserLocation(force = false): Promise<BrowserLocation> {
  if (force) {
    cachedLocation = null;
    cachedLocationPromise = null;
  } else {
    const cached = getCachedBrowserLocation();
    if (cached) return Promise.resolve(cached);
  }
  if (cachedLocationPromise) return cachedLocationPromise;

  const promise = new Promise<BrowserLocation>((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("当前浏览器不支持定位"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          lng: position.coords.longitude,
          lat: position.coords.latitude,
          accuracy: position.coords.accuracy,
          coordType: "wgs84",
        }),
      (error) => reject(new Error(error.message || "定位失败")),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 300000 },
    );
  })
    .then((location) => {
      const nextLocation = { ...location, capturedAt: Date.now() };
      cachedLocation = nextLocation;
      cachedLocationPromise = null;
      writeStoredLocation(nextLocation);
      return location;
    })
    .catch((error: unknown): never => {
      cachedLocationPromise = null;
      throw error;
    });
  cachedLocationPromise = promise;
  return promise;
}
