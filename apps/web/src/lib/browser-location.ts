export type BrowserLocation = {
  lng: number;
  lat: number;
  accuracy: number;
  coordType: "wgs84";
};

let cachedLocationPromise: Promise<BrowserLocation> | null = null;

export function getBrowserLocation(force = false): Promise<BrowserLocation> {
  if (force) cachedLocationPromise = null;
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
  }).catch((error: unknown): never => {
    cachedLocationPromise = null;
    throw error;
  });
  cachedLocationPromise = promise;
  return promise;
}
