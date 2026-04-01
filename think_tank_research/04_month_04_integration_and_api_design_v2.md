# Think Tank Session 04 (v2): Integration & API Design for Future Scopes
**Date:** Month 4, Week 1-4
**Attendees:** 
- **Marcus** (Senior Developer / Architect)
- **Julian** (Non-Optimizer / Max Quality Specialist)
- **Chloe** (Designer / Technical Artist)
- **David** (Deep-Researcher / Verification)

---

## Week 1: The Atomic Philosophy

**Marcus:** We are in the final month. We have a pure, highly optimized Atmospheric Scattering library (`AlienSky`). The user's directive was to ensure this library is "atomic"—meaning it functions perfectly on its own, but can be seamlessly integrated with a future, separate volumetric cloud library (`AlienClouds`).

**Julian:** If the cloud library is completely separate, how does it know what color the sky is? Clouds need to be lit by the ambient light of the atmosphere, otherwise they look like unlit gray blobs.

**David:** The atmosphere library holds the ground truth for lighting. Specifically, the `SkyViewLUT` contains the exact radiance of the sky in every direction, and the `TransmittanceLUT` contains the exact attenuation of the sun at any altitude. We must expose these textures through our public API.

---

## Week 2: Defining the Public API

**Chloe:** Let's draft the TypeScript interface that the future cloud library will consume.

**Marcus:** 
```typescript
interface IAlienSkyAPI {
    // Textures for shaders
    getTransmittanceLUT(): BaseTexture;
    getSkyViewLUT(): BaseTexture;
    
    // For Aerial Perspective (Fogging the clouds)
    getCameraVolumeLUT(): BaseTexture; // 3D texture (WebGPU) or 2D Atlas (WebGL)
    
    // Core parameters
    getSunDirection(): Vector3;
    getSunIntensity(): number;
    getPlanetRadius(): number;
    getAtmosphereRadius(): number;
}
```

**David:** This is good, but sampling the `SkyViewLUT` inside a cloud raymarching loop is too expensive. As we discussed in previous iterations, we need Spherical Harmonics (SH) for ambient cloud lighting.

**Marcus:** Does the Atmosphere library calculate the SH, or does the Cloud library?

**David:** The Atmosphere library should do it. It owns the `SkyViewLUT`. It can run a small compute shader (or CPU readback, though slow) to project the `SkyViewLUT` into 9 Spherical Harmonic coefficients. 

**Marcus:** Let's add that to the API:
```typescript
    // Ambient Lighting
    getSkySphericalHarmonics(): Float32Array; // 27 floats (9 vec3s)
```
Now, the future `AlienClouds` library just calls `sky.getSkySphericalHarmonics()` and passes that array to its cloud shader as a uniform. The clouds will perfectly match the ambient color of the sky, whether it's high noon or a red sunset.

---

## Week 3: The Shadow Mask Hook (God Rays)

**Julian:** What about the reverse interaction? What if the clouds cast shadows on the atmosphere? If the libraries are atomic, the atmosphere doesn't know the clouds exist.

**Marcus:** We use a dependency injection pattern. The Atmosphere library will expose a hook for a shadow map.

```typescript
    // Optional integration
    setCloudShadowMap(texture: BaseTexture | null): void;
```

**David:** If `setCloudShadowMap` is called, the Atmosphere's `SkyView` and `AerialPerspective` shaders will sample this texture when raymarching towards the sun. If the shadow map indicates a cloud is blocking the sun, the scattering contribution is reduced. This creates physically accurate volumetric god rays in the sky, driven by an external library.

**Chloe:** This is brilliant. The libraries remain completely decoupled. `AlienSky` doesn't know *how* the shadow map is generated—it could be from `AlienClouds`, or it could just be a static 2D texture I painted. It just uses the data if it's provided.

---

## Week 4: Finalizing the Architecture

**Marcus:** Let's review the final architecture of AlienSky v2 based on the user's feedback.

1. **Scope:** Strictly Atmospheric Scattering. Volumetric clouds are out of scope, reserved for a future atomic library.
2. **Dual Backend:** We maintain two distinct rendering paths.
   - **WebGPU:** Utilizes WGSL Compute Shaders and 3D Storage Textures for maximum performance and zero-overhead LUT generation.
   - **WebGL2:** Utilizes GLSL Fragment Shaders, RenderTargetTextures, and 2D Atlases as a robust, highly compatible fallback.
3. **Facade API:** A single `AlienSky` class abstracts the backend complexity from the user.
4. **Extensibility:** The API exposes LUTs, Spherical Harmonics, and accepts external shadow maps, ensuring future plugins (like clouds or weather systems) can integrate seamlessly without modifying the core atmosphere code.

**David:** The math is sound. The separation of concerns is perfect.

**Elena:** The performance profile is optimal. We aren't dragging WebGPU down to WebGL's level.

**Marcus:** I will compile this into the Senior Developer Final Report (v2). The Think Tank is concluded. We are ready for production.
