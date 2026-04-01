# AlienSky - High-Performance Atmospheric Scattering for Babylon.js

## About
`AlienSky` is a physically-based sky rendering module for Babylon.js, designed for heavy open-world games. It uses a single-scattering atmospheric model (Nishita) with Rayleigh and Mie scattering to create realistic skies, sunsets, and planetary shadows.

To maximize performance and ensure cross-API compatibility (WebGL & WebGPU), this module features a highly optimized dual-rendering architecture:

1. **Real-time Vertex Scattering:** Calculates heavy raymarching math per-vertex instead of per-pixel, offering a massive ~120x performance boost over traditional fragment shader approaches while maintaining pixel-perfect sun halos.
2. **Dynamic Cubemap Caching:** Allows the game engine to completely disable real-time math by baking the sky into a 360-degree cubemap. This drops the GPU load of the sky to near-zero, perfect for static or slow-moving time-of-day cycles.
3. **WebGPU-Safe Dual-Sphere Sync:** To prevent WebGPU synchronization errors (reading and writing to a texture in the same pass), the library uses two separate sky spheres (`skySphereRealtime` and `skySphereCache`). It automatically manages their visibility and uses `onAfterRenderObservable` to ensure the cubemap is fully written before it is displayed.

## Methods & Properties

### Initialization
```typescript
import { AlienSky } from './lib/AlienSky';

// Instantiate the sky. Pass your BabylonJS scene and whether you are using WebGPU.
const sky = new AlienSky(scene, isWebGPU);
```

### Properties
- `sky.timeOfDay` (number): A normalized value (0.0 to 1.0) representing the time of day. Automatically calculates azimuth and elevation. (0 = midnight, 0.25 = sunrise, 0.5 = noon, 0.75 = sunset).
- `sky.azimuth` (number): Sun's horizontal angle in radians.
- `sky.elevation` (number): Sun's vertical angle in radians.
- `sky.sunPosition` (Vector3): Directly set the sun's directional vector (normalized).
- `sky.haziness` (number): Controls Mie scattering (fog/haze). Range `0.0` to `1.0`.
- `sky.rayleighColorControl` (Vector2): Shifts the base color of the sky (X: Hue shift, Y: Intensity).
- `sky.mieColorControl` (Vector2): Shifts the color of the sun halo/haze (X: Hue shift, Y: Intensity).
- `sky.sunIntensity` (number): Brightness of the sun.
- `sky.cameraExposure` (number): Tone mapping exposure.

### Caching System (Performance)
- `sky.useCache` (boolean): Set to `true` to enable the cubemap cache. Set to `false` to use real-time vertex math.
- `sky.updateCache()`: Forces the `ReflectionProbe` to take a new 360-degree snapshot of the sky. The library safely hides the cache sphere, renders the real-time sky to the probe, and swaps them back exactly when the render is complete.

### Debugging & Verification
- `sky.cubemapVerification` (boolean): Injects a solid magenta artifact into the real-time shader. This is used to visually prove that the cubemap cache is working. If you turn this ON, update the cache, and turn it OFF, the sky will remain magenta, proving the texture was successfully cached and is persisting.

## How to Hook Up & Use in a Game Loop

For a heavy open-world game with a slow day/night cycle (e.g., 3 in-game hours), you should use the caching system to save GPU resources. You only need to update the cache when the sun has moved enough to be noticeable.

```typescript
// 1. Initialize
const sky = new AlienSky(scene, isWebGPU);

// 2. Enable the cache immediately
sky.useCache = true;

// 3. Game Loop Example
let timeSinceLastSkyUpdate = 0;

scene.onBeforeRenderObservable.add(() => {
    const deltaTime = engine.getDeltaTime();
    timeSinceLastSkyUpdate += deltaTime;

    // Only update the sky math every 5 seconds (5000ms)
    // This saves massive amounts of GPU overhead.
    if (timeSinceLastSkyUpdate > 5000) {
        // Update your sun position based on game time
        // E.g., progress timeOfDay by a small fraction
        sky.timeOfDay = (Date.now() % 86400000) / 86400000; 
        
        // Tell the sky to take a new panoramic photo
        sky.updateCache();
        
        timeSinceLastSkyUpdate = 0;
    }
});
```

### Memory Management
When changing scenes or destroying the sky, always call `dispose()` to free up the WebGL/WebGPU shader materials, meshes, and the cubemap VRAM.
```typescript
sky.dispose();
```
