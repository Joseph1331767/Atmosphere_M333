# Think Tank Research: Senior Developer Final Report
**Author:** Marcus (Senior Developer / Architect)
**Project:** AlienSky v2 - Advanced Atmospheric & Volumetric Rendering
**Date:** Conclusion of Month 4 Think Tank

## Executive Summary

Over the past four months, our specialized think tank—comprising experts in optimization, high-fidelity rendering, technical art, and deep research—has rigorously evaluated the state-of-the-art in real-time atmospheric scattering and volumetric cloud rendering. Our objective was to design the 
architecture for AlienSky v2, targeting Babylon.js with primary support for WebGPU and a robust fallback for WebGL2.

This report synthesizes our findings, debates, and final architectural decisions. We have moved away from the limitations of single-scattering analytical models (like the original Preetham or early Bruneton implementations) and embraced a highly optimized, LUT-based multiple-scattering approximation, coupled with a raymarched volumetric cloud system.

The resulting architecture is designed to be physically plausible, highly performant in open-world scenarios, and deeply customizable for technical artists.

---

## 1. Atmospheric Scattering Architecture

### 1.1 The Multiple Scattering Paradigm
Single-scattering models fail to accurately represent the sky, particularly opposite the sun (which appears too dark) and during twilight (lacking the characteristic Earth shadow and ambient glow). True multiple scattering via real-time raymarching is computationally prohibitive.

**Decision:** We are adopting the LUT-based architecture proposed by Sébastien Hillaire (2020). This approach pre-calculates scattering integrals into a series of Look-Up Tables (LUTs).

### 1.2 The LUT Pipeline
The sky rendering relies on three primary textures, generated sequentially:
1.  **Transmittance LUT (2D):** Stores the light attenuation from any altitude to the top of the atmosphere.
2.  **Multi-Scattering LUT (2D):** Approximates the energy of light bouncing multiple times within the atmosphere, assuming isotropic scattering. This is the key to realistic twilight and bright horizons.
3.  **Sky-View LUT (2D):** The final visible sky color, parameterized by view zenith and sun zenith angles. This is the only LUT sampled by the final sky shader, ensuring the fragment cost remains extremely low (a single 2D texture lookup per pixel).

### 1.3 WebGPU vs. WebGL2 Implementation
While WebGPU Compute Shaders offer the fastest path for generating these LUTs, we must maintain WebGL2 compatibility.

**Decision:** The LUT generation pipeline will utilize standard Fragment Shaders rendering to `RenderTargetTexture` instances. This ensures identical behavior across both APIs. To mitigate WebGPU synchronization issues (where a texture might be sampled before its generation pass completes), 
we will utilize a dual-sphere architecture (`skySphereRealtime` and `skySphereCache`), ensuring the cache is only swapped after the `onAfterRenderObservable` confirms completion.

---

## 2. Volumetric Clouds

### 2.1 Raymarching and Performance
Volumetric clouds require raymarching through a 3D density field. Performing this at full screen resolution (e.g., 4K) with a sufficient step count (64-128 steps) is impossible for a real-time game with a full scene to render.

**Decision:** The volumetric clouds will be rendered to a separate, lower-resolution `RenderTargetTexture` (quarter-resolution: half-width, half-height). 

To composite this low-resolution buffer back over the high-resolution scene without severe artifacting, we will implement **Bilateral Upsampling**. This technique uses the high-resolution depth buffer to prevent the clouds from bleeding over the edges of foreground geometry (mountains, buildings).

### 2.2 Noise Generation and Storage
The base shape of the clouds relies on 3D Worley-Perlin fractal noise, with higher-frequency Worley noise for edge detail.

**Decision:** Generating a 128x128x128 3D texture at runtime via WebGL2 fragment slices is too slow and causes unacceptable loading stutters. 
- For **production**, we will rely on offline-baked `.ktx2` (Basis Universal) compressed 3D textures. This provides near-instant loading and minimal VRAM footprint.
- For **development/iteration**, we will provide a WebGPU Compute Shader generator, allowing artists to tweak noise frequencies in real-time before baking the final asset.

To minimize texture bindings, the Base Noise (Perlin-Worley) and Detail Noise (Worley octaves) will be packed into the RGBA channels of a single 3D texture.

### 2.3 Artistic Control (The Weather Map)
Artists require explicit control over cloud placement and type.

**Decision:** We will implement a 2D "Weather Map" texture, projected top-down over the world. 
- **R Channel:** Coverage (0.0 = clear, 1.0 = overcast). Acts as a threshold for the 3D noise.
- **G Channel:** Precipitation/Wetness.
- **B Channel:** Cloud Type (0.0 = cumulus, 1.0 = cumulonimbus).

This map can be hand-painted or procedurally generated. Wind will be simulated by scrolling the UV coordinates of both the 2D Weather Map (macro weather movement) and the 3D Noise (micro turbulence).

---

## 3. Lighting and Shadows

### 3.1 Cloud Self-Shadowing and Ground Shadows
Raymarching towards the sun for every step of the primary cloud raymarch (to calculate self-shadowing) is too expensive.

**Decision:** We will generate a 2D Cloud Shadow Map (Optical Depth Map) from an orthographic top-down perspective. 
- **Self-Shadowing:** The cloud shader samples this 2D map to determine how much sunlight reaches a specific voxel.
- **Ground Shadows:** This same 2D map will be assigned as the `projectionTexture` (cookie) of the main Babylon.js `DirectionalLight`. This integrates cloud shadows seamlessly into all standard PBR materials without requiring custom shader injection.

### 3.2 Ambient Cloud Lighting (Spherical Harmonics)
Clouds must be lit by the ambient blue light of the sky, not just the direct sunlight. Sampling the Sky-View LUT inside the cloud raymarch is too expensive.

**Decision:** We will evaluate the Sky-View LUT into 3rd-order Spherical Harmonics (9 `vec3` coefficients) on the CPU once per frame. These coefficients will be passed to the cloud shader as uniforms. Inside the raymarch loop, the ambient light is calculated via simple dot products against the density gradient (pseudo-normal) of the cloud voxel.

### 3.3 Multiple Scattering Approximation
True multiple scattering inside the cloud volume is impossible.

**Decision:** We will implement the analytical multi-scattering approximation (Hillaire 2016). This uses an octave-based approach to Beer's Law, simulating multiple bounces through mathematical attenuation rather than secondary raymarching.

---

## 4. Edge Cases and Stability

### 4.1 Space Transitions (Low Earth Orbit)
The standard atmospheric scattering math fails if the camera altitude exceeds the atmosphere radius ($R_{atm}$).

**Decision:** We will implement a geometric intersection check. If `cameraHeight > R_atm`, we solve the quadratic equation for ray-sphere intersection. If the view ray hits the atmosphere, we move the raymarch starting point to the entry intersection point. This allows seamless transitions from the ground to space without abandoning the optimized LUT architecture.

### 4.2 Pipeline State Objects (PSO)
WebGPU requires pre-compiled Pipeline State Objects. Using `#define` macros for runtime toggles (e.g., changing cloud quality) causes severe compilation stutter.

**Decision:** We will strictly enforce an "Ubershader" philosophy. Runtime quality settings (step counts, enabling shadows) will use uniform branching. `#define` macros will be restricted to initialization-time settings only.

### 4.3 Aerial Perspective (Fog)
To ground the scene, distant objects must fade into the color of the sky.

**Decision:** We will implement a post-process effect that reconstructs world position from the depth buffer and evaluates the scattering equations (or samples a low-res 3D scattering volume) to apply physically accurate aerial perspective, replacing standard Babylon.js exponential fog.

---

## Conclusion

The architecture defined in this report represents a massive leap forward for AlienSky. By carefully balancing physical accuracy (Hillaire LUTs, Spherical Harmonics) with aggressive optimization (Quarter-resolution rendering, Bilateral Upsampling, 2D Shadow Maps), we can deliver AAA-quality skies and volumetric clouds in a web environment. 

The dual-support for WebGPU and WebGL2 ensures maximum reach, while the extensive artistic controls (Weather Maps, KTX2 noise baking) empower technical artists to craft unique, dynamic atmospheres. Development of v2 will commence immediately based on these blueprints.

**Signed,**
*Marcus*
*Senior Developer / Architect*
