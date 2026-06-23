const PI = Math.PI;
const EARTH_RADIUS = 6378245;
const ECCENTRICITY = 0.006693421622965943;

export type Coordinate = { lng: number; lat: number };

function outsideChina({ lng, lat }: Coordinate) {
  return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271;
}

function transformLatitude(lng: number, lat: number) {
  let result =
    -100 +
    2 * lng +
    3 * lat +
    0.2 * lat * lat +
    0.1 * lng * lat +
    0.2 * Math.sqrt(Math.abs(lng));
  result +=
    ((20 * Math.sin(6 * lng * PI) + 20 * Math.sin(2 * lng * PI)) * 2) / 3;
  result += ((20 * Math.sin(lat * PI) + 40 * Math.sin((lat / 3) * PI)) * 2) / 3;
  result +=
    ((160 * Math.sin((lat / 12) * PI) + 320 * Math.sin((lat * PI) / 30)) * 2) /
    3;
  return result;
}

function transformLongitude(lng: number, lat: number) {
  let result =
    300 +
    lng +
    2 * lat +
    0.1 * lng * lng +
    0.1 * lng * lat +
    0.1 * Math.sqrt(Math.abs(lng));
  result +=
    ((20 * Math.sin(6 * lng * PI) + 20 * Math.sin(2 * lng * PI)) * 2) / 3;
  result += ((20 * Math.sin(lng * PI) + 40 * Math.sin((lng / 3) * PI)) * 2) / 3;
  result +=
    ((150 * Math.sin((lng / 12) * PI) + 300 * Math.sin((lng / 30) * PI)) * 2) /
    3;
  return result;
}

export function wgs84ToGcj02(coordinate: Coordinate): Coordinate {
  if (outsideChina(coordinate)) return { ...coordinate };

  const deltaLat = transformLatitude(coordinate.lng - 105, coordinate.lat - 35);
  const deltaLng = transformLongitude(
    coordinate.lng - 105,
    coordinate.lat - 35,
  );
  const latitudeRadians = (coordinate.lat / 180) * PI;
  const magic = 1 - ECCENTRICITY * Math.sin(latitudeRadians) ** 2;
  const sqrtMagic = Math.sqrt(magic);
  const latitudeOffset =
    (deltaLat * 180) /
    (((EARTH_RADIUS * (1 - ECCENTRICITY)) / (magic * sqrtMagic)) * PI);
  const longitudeOffset =
    (deltaLng * 180) /
    ((EARTH_RADIUS / sqrtMagic) * Math.cos(latitudeRadians) * PI);

  return {
    lng: coordinate.lng + longitudeOffset,
    lat: coordinate.lat + latitudeOffset,
  };
}

export function formatDistance(distanceMeters: number | null | undefined) {
  if (distanceMeters === null || distanceMeters === undefined) return null;
  if (!Number.isFinite(distanceMeters) || distanceMeters < 0) return null;
  if (distanceMeters < 1000) return `${Math.round(distanceMeters)} m`;
  return `${(distanceMeters / 1000).toFixed(distanceMeters < 10000 ? 1 : 0)} km`;
}
