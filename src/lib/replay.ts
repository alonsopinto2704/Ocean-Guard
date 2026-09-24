export type ReplayRow = Record<string, string>;

export const field = (row: ReplayRow | undefined, ...names: string[]) =>
  names.map(name => row?.[name]).find(Boolean) ?? '';

export const numberField = (row: ReplayRow | undefined, ...names: string[]) => Number(field(row, ...names)) || 0;

export const timeField = (row: ReplayRow) => field(row, 'event_time_utc', 'window_start_utc', 'timestamp_utc', 'observed_at_utc', 'detected_at_utc', 'timestamp', 'time');

export const ingestionField = (row: ReplayRow) => field(row, 'ingestion_time_utc', 'ingested_at_utc') || timeField(row);

export const toMs = (value: string) => Date.parse(value) || 0;

export const visibleByIngestion = (rows: ReplayRow[], cursor: number) =>
  rows.filter(row => toMs(ingestionField(row)) <= cursor);

export const sortByIngestion = (rows: ReplayRow[]) =>
  [...rows].sort((a, b) => toMs(ingestionField(a)) - toMs(ingestionField(b)));

export function getReplayBounds(tables?: Record<string, ReplayRow[]> | null) {
  if (!tables) return { start: 0, end: 0 };
  const rows = Object.values(tables).flat();
  const missionStart = toMs(field(tables.missions?.[0], 'start_time_utc'));
  const firstIngestion = Math.min(...rows.map(row => toMs(ingestionField(row))).filter(Boolean));
  const lastIngestion = Math.max(...rows.map(row => toMs(ingestionField(row))).filter(Boolean));
  const missionEnd = toMs(field(tables.missions?.[0], 'end_time_utc'));
  return {
    start: missionStart || (Number.isFinite(firstIngestion) ? firstIngestion : 0),
    end: Math.max(missionEnd, Number.isFinite(lastIngestion) ? lastIngestion : 0),
  };
}

export function getVisibleTracks(tracks: ReplayRow[], detections: ReplayRow[], cursor: number) {
  const received = new Map<string, number>();
  visibleByIngestion(detections, cursor).forEach(detection => {
    if (detection.object_id) received.set(detection.object_id, (received.get(detection.object_id) ?? 0) + 1);
  });
  return tracks
    .filter(track => received.has(track.ground_truth_object_id))
    .map(track => ({ track, receivedCount: received.get(track.ground_truth_object_id) ?? 0 }));
}

type Point = { lat: number; lng: number };

export function createProjector(scaleRows: ReplayRow[]) {
  if (!scaleRows.length) return (_point: Point) => ({ x: 0, y: 0 });
  const scale = scaleRows.map(row => ({ lat: numberField(row, 'latitude', 'lat'), lng: numberField(row, 'longitude', 'lng', 'lon') }));
  const minLat = Math.min(...scale.map(point => point.lat));
  const maxLat = Math.max(...scale.map(point => point.lat));
  const minLng = Math.min(...scale.map(point => point.lng));
  const maxLng = Math.max(...scale.map(point => point.lng));
  return (point: Point) => ({
    x: 24 + ((point.lng - minLng) / (maxLng - minLng || 1)) * 752,
    y: 276 - ((point.lat - minLat) / (maxLat - minLat || 1)) * 252,
  });
}

export function pathGeometry(visibleRows: ReplayRow[], scaleRows: ReplayRow[], gapMs = 60_000) {
  if (!scaleRows.length) return { segments: [], current: undefined };
  const project = createProjector(scaleRows);
  const segments: string[] = [];
  let currentSegment: string[] = [];
  visibleRows.forEach((row, index) => {
    const point = project({ lat: numberField(row, 'latitude', 'lat'), lng: numberField(row, 'longitude', 'lng', 'lon') });
    const previous = visibleRows[index - 1];
    if (previous && toMs(timeField(row)) - toMs(timeField(previous)) > gapMs) {
      if (currentSegment.length) segments.push(currentSegment.join(' '));
      currentSegment = [];
    }
    currentSegment.push(`${currentSegment.length ? 'L' : 'M'} ${point.x} ${point.y}`);
  });
  if (currentSegment.length) segments.push(currentSegment.join(' '));
  const latest = visibleRows.at(-1);
  const current = latest ? project({ lat: numberField(latest, 'latitude', 'lat'), lng: numberField(latest, 'longitude', 'lng', 'lon') }) : undefined;
  return { segments, current };
}

export type DebrisObjectMeta = {
  name: string;
  category: string;
  threatLevel: 'CRITICAL' | 'HIGH' | 'MODERATE';
  icon: string;
  description: string;
  material: string;
  actionRequired: string;
  estimatedWeightKg: number;
};

export const DEBRIS_CATALOG: Record<string, DebrisObjectMeta> = {
  'OBJ-0001-normal': {
    name: 'Mixed Marine Plastic Cluster',
    category: 'Surface Macroplastics',
    threatLevel: 'HIGH',
    icon: '🧴',
    description: 'Concentration of single-use PET drink bottles, poly bags & food packaging drifting on water surface.',
    material: 'PET, LDPE, HDPE Polymers',
    actionRequired: 'Surface collection skimmer',
    estimatedWeightKg: 14.5,
  },
  'OBJ-0002-repeated': {
    name: 'Dense Macroplastic Accumulation',
    category: 'High-Density Cluster',
    threatLevel: 'CRITICAL',
    icon: '📦',
    description: 'Compacted debris mass: rigid plastic containers, expanded foam fragments & synthetic rope strands.',
    material: 'Rigid HDPE, Expanded Polystyrene (EPS)',
    actionRequired: 'Heavy retrieval boom & crane',
    estimatedWeightKg: 38.2,
  },
  'OBJ-0003-occluded': {
    name: 'Submerged Debris Mass (Occluded)',
    category: 'Subsurface Debris',
    threatLevel: 'MODERATE',
    icon: '🌊',
    description: 'Waterlogged plastic clump washed by swells; optical line-of-sight intermittent due to foam wash.',
    material: 'Submerged Polymers & Marine Growth',
    actionRequired: 'Sonar verification & diver grapple',
    estimatedWeightKg: 22.0,
  },
  'OBJ-0004-appears': {
    name: 'Inflowing Plastic Mass',
    category: 'Tidal Drift Inflow',
    threatLevel: 'HIGH',
    icon: '🛟',
    description: 'Fresh debris slick transported into survey sector by coastal Bay of Bengal tidal current at t=600s.',
    material: 'LDPE packaging & beverage containers',
    actionRequired: 'Containment boom deployment',
    estimatedWeightKg: 19.8,
  },
  'OBJ-0005-drifter': {
    name: 'Derelict Fishing Net ("Ghost Net")',
    category: 'Abandoned Fishing Gear',
    threatLevel: 'CRITICAL',
    icon: '🕸️',
    description: 'Active drifting monofilament gillnet with foam floats. Severe wildlife and propeller entanglement hazard.',
    material: 'Polyamide (Nylon) Mesh & Buoys',
    actionRequired: 'Urgent salvage team interception',
    estimatedWeightKg: 52.0,
  },
};

export function getHeadingCardinal(deg: number): string {
  const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const index = Math.round(((deg % 360) / 22.5)) % 16;
  return directions[index] || 'N';
}
