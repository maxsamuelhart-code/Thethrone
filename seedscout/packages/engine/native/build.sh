#!/usr/bin/env bash
# Builds wasm/cubiomes.wasm from cubiomes (pinned in CUBIOMES_COMMIT) + seedscout.c.
#
# Toolchain: any clang >= 16 with the wasm32 target and wasm-ld, plus the
# wasi-sysroot and wasm32 compiler-rt builtins from wasi-sdk. If WASI_SDK_PATH
# is set (a full wasi-sdk install) it is used as-is; otherwise the sysroot and
# builtins are downloaded into .cache/ and the system clang is used.
set -euo pipefail
cd "$(dirname "$0")"

WASI_VER=24
COMMIT=$(cat CUBIOMES_COMMIT)
CACHE=.cache
mkdir -p "$CACHE" ../wasm

if [ ! -d "$CACHE/cubiomes" ]; then
  git clone --quiet https://github.com/Cubitect/cubiomes "$CACHE/cubiomes"
fi
git -C "$CACHE/cubiomes" fetch --quiet origin "$COMMIT" 2>/dev/null || true
git -C "$CACHE/cubiomes" checkout --quiet "$COMMIT"

if [ -n "${WASI_SDK_PATH:-}" ]; then
  CC="$WASI_SDK_PATH/bin/clang"
  SYSROOT="$WASI_SDK_PATH/share/wasi-sysroot"
  BUILTINS=""
else
  CC=${CC:-clang}
  base="https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-$WASI_VER"
  if [ ! -d "$CACHE/wasi-sysroot-$WASI_VER.0" ]; then
    curl -sSL "$base/wasi-sysroot-$WASI_VER.0.tar.gz" | tar xz -C "$CACHE"
  fi
  if [ ! -d "$CACHE/libclang_rt.builtins-wasm32-wasi-$WASI_VER.0" ]; then
    curl -sSL "$base/libclang_rt.builtins-wasm32-wasi-$WASI_VER.0.tar.gz" | tar xz -C "$CACHE"
  fi
  SYSROOT="$CACHE/wasi-sysroot-$WASI_VER.0"
  BUILTINS="$CACHE/libclang_rt.builtins-wasm32-wasi-$WASI_VER.0/libclang_rt.builtins-wasm32.a"
fi

SRC="$CACHE/cubiomes"
"$CC" --target=wasm32-wasip1 --sysroot="$SYSROOT" \
  -O3 -flto -fno-math-errno -D_GNU_SOURCE \
  -mexec-model=reactor \
  -I "$SRC" \
  seedscout.c \
  "$SRC/noise.c" "$SRC/biomes.c" "$SRC/layers.c" "$SRC/biomenoise.c" \
  "$SRC/generator.c" "$SRC/finders.c" "$SRC/util.c" \
  ${BUILTINS:+-nodefaultlibs -lc "$BUILTINS"} \
  -Wl,--gc-sections -Wl,--strip-all -Wl,-z,stack-size=1048576 \
  -o ../wasm/cubiomes.wasm

echo "built $(wc -c < ../wasm/cubiomes.wasm) bytes -> wasm/cubiomes.wasm"
