// Precompute the globe's land dots: evenly spaced points on a sphere (a
// Fibonacci lattice), kept only where they fall on land. Run once:
//   npm run land
import { geoContains } from "d3-geo";
import { writeFileSync, readFileSync } from "node:fs";
import { feature } from "topojson-client";

const world = JSON.parse(readFileSync(new URL("../node_modules/world-atlas/land-110m.json", import.meta.url)));
const land = feature(world, world.objects.land);
const N = 16000, golden = Math.PI * (3 - Math.sqrt(5)), out = [];
for (let i = 0; i < N; i++) {
  const y = 1 - (2 * (i + 0.5)) / N;              // -1..1
  const lat = (Math.asin(y) * 180) / Math.PI;
  const lon = ((((i * golden * 180) / Math.PI) % 360) + 540) % 360 - 180;
  if (geoContains(land, [lon, lat])) out.push(Math.round(lat * 10) / 10, Math.round(lon * 10) / 10);
}
writeFileSync(new URL("../src/land.json", import.meta.url), JSON.stringify(out));
console.log(`${out.length / 2} land points`);
