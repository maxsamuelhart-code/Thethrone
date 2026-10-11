// Thin C layer over cubiomes, compiled to WebAssembly (wasm32-wasi, reactor).
// One Generator per WASM instance: each Web Worker / Worker isolate owns its own
// instance, so module-level state is safe and avoids re-seeding per call.
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>

#include "generator.h"
#include "finders.h"
#include "util.h"

#define EXPORT(name) __attribute__((export_name(#name)))

static Generator g;
static int g_mc = -1, g_dim, g_flags;
static uint64_t g_seed;
static unsigned char g_colors[256][3];
static int g_colors_ready;

EXPORT(ss_malloc) void *ss_malloc(size_t n) { return malloc(n); }
EXPORT(ss_free) void ss_free(void *p) { free(p); }

/** Selects version/seed/dimension. Cheap to call repeatedly: no-op when unchanged. */
EXPORT(ss_set_world)
void ss_set_world(int mc, uint64_t seed, int dim, int largeBiomes)
{
    int flags = largeBiomes ? LARGE_BIOMES : 0;
    if (mc != g_mc || flags != g_flags) {
        setupGenerator(&g, mc, flags);
        g_mc = mc;
        g_flags = flags;
        g_dim = 1 << 30; // force re-seed
    }
    if (seed != g_seed || dim != g_dim) {
        applySeed(&g, dim, seed);
        g_seed = seed;
        g_dim = dim;
    }
}

EXPORT(ss_biome_at) int ss_biome_at(int scale, int x, int y, int z)
{
    return getBiomeAt(&g, scale, x, y, z);
}

/** Writes w*h biome ids at `scale` (1,4,16,64,256) into out. Returns 0 on success. */
EXPORT(ss_gen_biomes)
int ss_gen_biomes(int scale, int x, int z, int w, int h, int y, int *out)
{
    Range r = { scale, x, z, w, h, y, 1 };
    int *cache = allocCache(&g, r);
    if (!cache) return -1;
    int err = genBiomes(&g, cache, r);
    if (!err) memcpy(out, cache, sizeof(int) * (size_t)w * (size_t)h);
    free(cache);
    return err;
}

/** Converts n biome ids to RGBA pixels (ready for ImageData). */
EXPORT(ss_biomes_to_rgba)
void ss_biomes_to_rgba(const int *ids, int n, uint8_t *rgba)
{
    if (!g_colors_ready) { initBiomeColors(g_colors); g_colors_ready = 1; }
    for (int i = 0; i < n; i++) {
        int id = ids[i] & 0xff;
        rgba[4*i+0] = g_colors[id][0];
        rgba[4*i+1] = g_colors[id][1];
        rgba[4*i+2] = g_colors[id][2];
        rgba[4*i+3] = 255;
    }
}

EXPORT(ss_biome_rgb) int ss_biome_rgb(int id)
{
    if (!g_colors_ready) { initBiomeColors(g_colors); g_colors_ready = 1; }
    id &= 0xff;
    return (g_colors[id][0] << 16) | (g_colors[id][1] << 8) | g_colors[id][2];
}

EXPORT(ss_biome_name) const char *ss_biome_name(int id) { return biome2str(g_mc, id); }

/**
 * Finds viable structures of `stype` whose block position lies in [x0,x1]x[z0,z1].
 * Writes (x,z) pairs to out; returns the count (capped at max), or -1 if the
 * structure does not exist in this version.
 */
EXPORT(ss_structures_in_box)
int ss_structures_in_box(int stype, int x0, int z0, int x1, int z1, int *out, int max)
{
    StructureConfig sc;
    if (!getStructureConfig(stype, g_mc, &sc)) return -1;
    if (sc.dim != g_dim) return 0;
    int rs = sc.regionSize * 16;
    int rx0 = (int)floor((double)x0 / rs), rx1 = (int)floor((double)x1 / rs);
    int rz0 = (int)floor((double)z0 / rs), rz1 = (int)floor((double)z1 / rs);
    int n = 0;
    for (int rz = rz0; rz <= rz1; rz++) {
        for (int rx = rx0; rx <= rx1; rx++) {
            Pos p;
            if (!getStructurePos(stype, g_mc, g_seed, rx, rz, &p)) continue;
            if (p.x < x0 || p.x > x1 || p.z < z0 || p.z > z1) continue;
            if (!isViableStructurePos(stype, &g, p.x, p.z, 0)) continue;
            if (n < max) { out[2*n] = p.x; out[2*n+1] = p.z; }
            n++;
        }
    }
    return n < max ? n : max;
}

/** Exact spawn (slow-ish, tens of ms) or fast estimate. Writes (x,z). */
EXPORT(ss_spawn) void ss_spawn(int exact, int *out)
{
    Pos p = exact ? getSpawn(&g) : estimateSpawn(&g, NULL);
    out[0] = p.x; out[1] = p.z;
}

/** Writes up to max stronghold (x,z) pairs, nearest ring first. Returns count. */
EXPORT(ss_strongholds) int ss_strongholds(int *out, int max)
{
    StrongholdIter sh;
    initFirstStronghold(&sh, g_mc, g_seed);
    int n = 0;
    while (n < max) {
        int remaining = nextStronghold(&sh, &g);
        out[2*n] = sh.pos.x; out[2*n+1] = sh.pos.z;
        n++;
        if (remaining <= 0) break;
    }
    return n;
}

/** 1 if biome `id` generates in the overworld of the current version. */
EXPORT(ss_biome_exists) int ss_biome_exists(int id) { return isOverworld(g_mc, id); }
EXPORT(ss_is_oceanic) int ss_is_oceanic(int id) { return isOceanic(id); }
