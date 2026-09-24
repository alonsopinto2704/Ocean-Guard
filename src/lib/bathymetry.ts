/**
 * OceanGuard Bathymetric Terrain & Elevation System
 *
 * Provides a high-fidelity geomorphological ocean floor model featuring:
 * 1. Coastal Continental Shelf (-7.5m to -14m)
 * 2. Continental Slope & Escarpment Margin (-15m to -28m)
 * 3. Deep Submarine Canyon & Fault Trench (-32m to -46.5m)
 * 4. Undersea Guyot / Seamount Ridge (-10.5m to -16m)
 * 5. Benthic Dunes, Rolling Sand Waves & Rocky Knolls
 */

export interface BathymetryColorRGB {
  r: number;
  g: number;
  b: number;
  hex: string;
}

/**
 * Returns the true vertical elevation in meters (negative value below sea level).
 * Y = 0 is sea surface.
 * Range: approximately -7.0m (shallow shoal) to -46.5m (deep trench).
 */
export function getBathymetricDepth(x: number, z: number): number {
  // 1. Continental Shelf Slope: tilting from shallow NW toward deep SE
  const baseSlope = -22.5 - (x * 0.052) + (z * 0.058);

  // 2. Submarine Canyon (fault trench slicing diagonally across the sector)
  const canyonAxis = x * 0.72 - z * 0.69 + 14.0;
  const canyonDist = Math.abs(canyonAxis);
  // Drops sharply by up to 16.5 meters at the canyon center
  const canyonDepth = -16.5 / (1.0 + Math.pow(canyonDist / 13.5, 2.4));

  // 3. Undersea Ridge / Seamount Crest (rises up toward -10m in the western quadrant)
  const seamountDist = Math.hypot(x + 36.0, z - 28.0);
  const seamountRise = 12.8 / (1.0 + Math.pow(seamountDist / 20.0, 2.0));

  // 4. Secondary Benthic Knoll (eastern shelf edge)
  const knollDist = Math.hypot(x - 42.0, z + 32.0);
  const knollRise = 7.5 / (1.0 + Math.pow(knollDist / 16.0, 2.0));

  // 5. Rolling Benthic Dunes & Sand Waves (multi-frequency procedural harmonics)
  const dunes =
    Math.sin(x * 0.055 + z * 0.038) * 3.2 +
    Math.sin(x * 0.125 - z * 0.082) * 1.6 +
    Math.sin(x * 0.28 + z * 0.24) * 0.65;

  const rawElevation = baseSlope + canyonDepth + seamountRise + knollRise + dunes;

  // Clamp within authentic bathymetric boundary [-48.0m, -6.8m]
  return Math.min(-6.8, Math.max(-48.0, rawElevation));
}

/**
 * Returns positive depth in meters below surface (e.g., 25.4 m).
 */
export function getPositiveDepth(x: number, z: number): number {
  return -getBathymetricDepth(x, z);
}

/**
 * Maps a depth in meters to high-contrast bathymetric elevation colors.
 * Shallow: bright bioluminescent turquoise/mint (#00f5d4)
 * Mid-shelf: azure marine cyan (#0284c7)
 * Deep canyon: abyssal indigo / midnight violet (#1e1b4b to #0b0f19)
 */
export function getBathymetryColor(depthM: number): BathymetryColorRGB {
  // Clamped normalized depth [0 = 6m, 1 = 46m]
  const t = Math.min(1, Math.max(0, (depthM - 6.0) / 40.0));

  let r = 0, g = 0, b = 0;

  if (t < 0.25) {
    // 6m to 16m: Turquoise (#00f5d4 -> #06b6d4)
    const k = t / 0.25;
    r = 0 * (1 - k) + 6 * k;
    g = 245 * (1 - k) + 182 * k;
    b = 212 * (1 - k) + 212 * k;
  } else if (t < 0.55) {
    // 16m to 28m: Ocean Cyan to Marine Cobalt (#06b6d4 -> #0284c7)
    const k = (t - 0.25) / 0.30;
    r = 6 * (1 - k) + 2 * k;
    g = 182 * (1 - k) + 132 * k;
    b = 212 * (1 - k) + 199 * k;
  } else if (t < 0.82) {
    // 28m to 39m: Marine Cobalt to Deep Abyssal Blue (#0284c7 -> #1e3a8a)
    const k = (t - 0.55) / 0.27;
    r = 2 * (1 - k) + 30 * k;
    g = 132 * (1 - k) + 58 * k;
    b = 199 * (1 - k) + 138 * k;
  } else {
    // 39m to 48m: Abyssal Trench Midnight Indigo (#1e3a8a -> #0a0e1a)
    const k = (t - 0.82) / 0.18;
    r = 30 * (1 - k) + 10 * k;
    g = 58 * (1 - k) + 14 * k;
    b = 138 * (1 - k) + 26 * k;
  }

  // Check if close to a 5-meter contour isobar line (e.g. 10m, 15m, 20m, 25m, 30m, 35m, 40m, 45m)
  const remainder = Math.abs(depthM % 5.0);
  const isContour = remainder < 0.22 || remainder > 4.78;

  if (isContour) {
    // Highlight with glowing cyan isobar contour line
    r = Math.min(255, r * 0.4 + 0 * 0.6);
    g = Math.min(255, g * 0.4 + 245 * 0.6);
    b = Math.min(255, b * 0.4 + 212 * 0.6);
  }

  const hex = '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
  return { r: r / 255, g: g / 255, b: b / 255, hex };
}
