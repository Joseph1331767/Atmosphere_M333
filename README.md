# Atmosphere Lib (AlienSky)

A high-performance, physically-based atmospheric scattering library for Babylon.js, designed specifically for heavy open-world games and WebGPU compatibility.

## Features

- **Physically-Based Scattering:** Implements Nishita's single-scattering atmospheric model (Rayleigh and Mie scattering) for realistic skies, sunsets, and planetary shadows.
- **Dual-Rendering Architecture:**
  - **Real-time Vertex Scattering:** Calculates heavy raymarching math per-vertex instead of per-pixel, offering a massive ~120x performance boost over traditional fragment shader approaches while maintaining pixel-perfect sun halos.
  - **Dynamic Cubemap Caching:** Allows the game engine to completely disable real-time math by baking the sky into a 360-degree cubemap. This drops the GPU load of the sky to near-zero, perfect for static or slow-moving time-of-day cycles.
- **WebGPU-Safe Synchronization:** Uses a robust dual-sphere architecture (`skySphereRealtime` and `skySphereCache`) to prevent WebGPU read/write synchronization errors during cubemap generation.
- **Cross-API Support:** Fully supports both WebGL (via GLSL) and WebGPU (via WGSL) with custom shader materials.

## Documentation

For full documentation on how to hook this library into your Babylon.js game, including API reference, caching strategies, and game loop examples, please see the detailed guide in:

👉 **[lib/hookup_readme.md](./lib/hookup_readme.md)**

## Quick Start

```typescript
import { AlienSky } from './lib/AlienSky';

// 1. Initialize the sky
const sky = new AlienSky(scene, isWebGPU);

// 2. Configure parameters
sky.timeOfDay = 0.5; // Noon
sky.haziness = 0.6;

// 3. Enable caching for maximum performance
sky.useCache = true;

// 4. Update the cache periodically in your game loop
// sky.updateCache();
```
