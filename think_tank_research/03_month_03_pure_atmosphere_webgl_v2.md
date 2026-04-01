# Think Tank Session 03 (v2): WebGL2 Fallback Architecture (GLSL)
**Date:** Month 3, Week 1-4
**Attendees:** 
- **Marcus** (Senior Developer / Architect)
- **Elena** (Optimizer / Performance Engineer)
- **Chloe** (Designer / Technical Artist)

---

## Week 1: The Rasterization Workaround

**Marcus:** We have a blazing fast WebGPU compute pipeline. Now, we must build the fallback. If `engine.isWebGPU` is false, we must generate the exact same LUTs using WebGL2. We don't have compute shaders. We don't have `texture_storage_3d`. 

**Elena:** We fall back to the classic technique: rendering full-screen quads to `RenderTargetTexture` (RTT) instances. 
For the Transmittance LUT (256x64), we create an RTT of that size. We use a custom `ShaderMaterial` where the vertex shader just outputs a full-screen triangle. The fragment shader calculates the transmittance for the given UV coordinate and outputs it as `gl_FragColor`.

**Chloe:** That sounds simple enough. Is it slow?

**Elena:** It's slower than compute, but for 2D LUTs, it's perfectly fine. Modern mobile GPUs can render a 256x64 quad in a fraction of a millisecond. 

---

## Week 2: The 3D LUT Problem (Aerial Perspective)

**Marcus:** The 2D LUTs are easy. But what about the Aerial Perspective volume? In WebGPU, we used a 32x32x32 `texture_storage_3d`. WebGL2 supports `WebGLTexture` with `TEXTURE_3D`, but rendering *into* it is tricky.

**Elena:** In WebGL2, you cannot render to a 3D texture directly in a single pass without using geometry shaders (which WebGL2 lacks) or multiview extensions. 
The standard workaround is to render to a 2D texture atlas. A 32x32x32 volume can be unrolled into a 2D texture of 1024x32 (32 slices of 32x32 laid out horizontally).

**Marcus:** So the fragment shader calculates which "slice" of the 3D volume the current 2D pixel belongs to, converts that to a 3D coordinate, does the raymarching, and writes the color?

**Elena:** Exactly. Then, when the opaque materials need to sample the Aerial Perspective, we have to do manual trilinear interpolation in the shader. We sample the 2D atlas twice (once for the slice below the target depth, once for the slice above) and `mix()` them.

**Chloe:** That sounds like a lot of extra shader math for the materials.

**Elena:** It is. It's the price we pay for WebGL2 compatibility. Alternatively, after rendering the 2D atlas, we could use the CPU to read the pixels and upload them to a true `RawTexture3D`, but that CPU-GPU sync would cause a massive frame drop. We must stick to the 2D atlas approach for the WebGL2 fallback.

---

## Week 3: Preventing Pipeline Stalls

**Marcus:** In WebGPU, the driver handles the memory barriers between the compute pass and the render pass. In WebGL, if we render to an RTT and then immediately try to sample that RTT in the same frame, we can cause pipeline stalls, especially on older OpenGL ES drivers.

**Elena:** To be safe, we should use a double-buffering approach for the dynamic LUTs (Sky-View and Aerial Perspective). 
We have `skyViewRTT_A` and `skyViewRTT_B`. 
In Frame 1, we render the sky using `A`, while the RTT system updates `B` in the background.
In Frame 2, we swap them. 

**Marcus:** This introduces a 1-frame latency to the sky lighting. If the camera whips around quickly, the sky might lag slightly behind the camera movement.

**Elena:** At 60fps, a 16ms delay on the sky gradient is imperceptible to 99% of users. It is a necessary tradeoff to ensure smooth framerates on lower-end WebGL devices. The WebGPU version will not have this latency.

---

## Week 4: The Facade Integration

**Chloe:** So, as a user, how do I interact with this? 

**Marcus:** You instantiate the class.
```typescript
const atmosphere = new AlienSky(scene);
atmosphere.sunPosition = new Vector3(100, 50, 100);
atmosphere.rayleighScattering = 0.0025;
```

Internally, `AlienSky` detects the engine.
If WebGL2:
1. It creates the `RenderTargetTextures`.
2. It compiles the GLSL `ShaderMaterials`.
3. It sets up the 2D Atlas for Aerial Perspective.
4. It manages the double-buffering swap in `onBeforeRenderObservable`.

**Chloe:** And if I change `rayleighScattering`?

**Marcus:** The Facade marks the static LUTs (Transmittance, Multi-Scattering) as "dirty". On the next frame, the WebGL backend will re-render those specific RTTs, while the WebGPU backend would re-dispatch those specific Compute Shaders.

**Marcus:** We have successfully designed two completely distinct, highly optimized rendering backends hidden behind a single, unified API. We have respected the user's directive to maximize WebGPU while maintaining a robust WebGL fallback. Next month, we design the API for the future Cloud library.
