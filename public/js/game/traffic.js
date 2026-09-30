// Commute routing. Every group of drivers takes the cheapest road path to jobs
// (a gravity model favours nearby jobs), and flows are accumulated on each road
// tile. A second pass re-routes part of the traffic around congested tiles, so
// building a parallel street really does relieve a jammed one.

export const ROAD_COST = { road: 1, avenue: 0.62, highway: 0.5 };
const DISTANCE_DECAY = 18;
const PASSES = [0.6, 0.4];

class MinHeap {
  constructor(capacity = 256) {
    this.keys = new Float64Array(capacity);
    this.vals = new Int32Array(capacity);
    this.size = 0;
  }

  clear() {
    this.size = 0;
  }

  push(key, val) {
    if (this.size === this.keys.length) {
      const keys = new Float64Array(this.size * 2);
      const vals = new Int32Array(this.size * 2);
      keys.set(this.keys);
      vals.set(this.vals);
      this.keys = keys;
      this.vals = vals;
    }
    let i = this.size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p] <= key) break;
      this.keys[i] = this.keys[p];
      this.vals[i] = this.vals[p];
      i = p;
    }
    this.keys[i] = key;
    this.vals[i] = val;
  }

  /** Removes the smallest entry; its key is left in `lastKey`. */
  pop() {
    const topVal = this.vals[0];
    this.lastKey = this.keys[0];
    const key = this.keys[--this.size];
    const val = this.vals[this.size];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= this.size) break;
      if (c + 1 < this.size && this.keys[c + 1] < this.keys[c]) c += 1;
      if (this.keys[c] >= key) break;
      this.keys[i] = this.keys[c];
      this.vals[i] = this.vals[c];
      i = c;
    }
    this.keys[i] = key;
    this.vals[i] = val;
    return topVal;
  }
}

/**
 * @param {object} p
 * @param {number} p.size map width/height
 * @param {Float32Array} p.roadCost per-tile base cost (0 = not a road)
 * @param {Float32Array} p.capacity per-tile capacity
 * @param {Map<number, number>} p.origins road tile -> car trips starting there
 * @param {Map<number, number>} p.destinations road tile -> attraction weight (jobs)
 * @returns {{load: Float32Array, routed: number, unrouted: number}}
 */
export function assignTraffic({ size, roadCost, capacity, origins, destinations }) {
  const n = size * size;
  const load = new Float32Array(n);
  const dist = new Float64Array(n);
  const parent = new Int32Array(n);
  const order = new Int32Array(n);
  const seen = new Int32Array(n);
  const done = new Int32Array(n);
  const flow = new Float64Array(n);
  const cost = new Float32Array(n);
  const heap = new MinHeap(512);
  const destNodes = [...destinations.keys()];
  const destWeights = destNodes.map((k) => destinations.get(k));
  const share = new Float64Array(destNodes.length);
  let run = 0;
  let routed = 0;
  let unrouted = 0;

  // Tiny deterministic jitter breaks ties so equal-length grid routes spread out.
  const jitter = (v) => 1 + (((v * 2654435761) >>> 0) % 1000) / 20000;
  const relax = (w, v, dv) => {
    if (cost[w] <= 0 || done[w] === run) return;
    const nd = dv + cost[w];
    if (seen[w] !== run || nd < dist[w]) {
      seen[w] = run;
      dist[w] = nd;
      parent[w] = v;
      heap.push(nd, w);
    }
  };

  for (let pass = 0; pass < PASSES.length; pass++) {
    const fraction = PASSES[pass];
    for (let v = 0; v < n; v++) {
      if (roadCost[v] <= 0) {
        cost[v] = 0;
        continue;
      }
      const u = load[v] / capacity[v];
      cost[v] = roadCost[v] * jitter(v) * (pass === 0 ? 1 : 1 + 2 * u * u);
    }

    for (const [src, trips] of origins) {
      if (trips <= 0 || roadCost[src] <= 0) continue;
      run += 1;
      heap.clear();
      dist[src] = 0;
      parent[src] = -1;
      seen[src] = run;
      heap.push(0, src);
      let count = 0;
      while (heap.size) {
        const v = heap.pop();
        const dv = heap.lastKey;
        if (done[v] === run) continue;
        done[v] = run;
        order[count++] = v;
        const x = v % size;
        if (x > 0) relax(v - 1, v, dv);
        if (x < size - 1) relax(v + 1, v, dv);
        if (v >= size) relax(v - size, v, dv);
        if (v + size < n) relax(v + size, v, dv);
      }

      let total = 0;
      for (let k = 0; k < destNodes.length; k++) {
        const node = destNodes[k];
        share[k] = done[node] === run ? destWeights[k] * Math.exp(-dist[node] / DISTANCE_DECAY) : 0;
        total += share[k];
      }
      const amount = trips * fraction;
      if (total <= 0) {
        unrouted += amount;
        continue;
      }
      for (let k = 0; k < destNodes.length; k++) {
        if (share[k] > 0) flow[destNodes[k]] += (amount * share[k]) / total;
      }
      // Push flows from destinations back towards the origin along the shortest-path tree.
      for (let k = count - 1; k >= 0; k--) {
        const v = order[k];
        const f = flow[v];
        if (f <= 0) continue;
        load[v] += f;
        flow[v] = 0;
        if (parent[v] >= 0) flow[parent[v]] += f;
      }
      routed += amount;
    }
  }
  return { load, routed, unrouted };
}
