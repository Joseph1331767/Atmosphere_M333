# Think Tank Session 02 (v2): WebGPU Compute Architecture (WGSL)
**Date:** Month 2, Week 1-4
**Attendees:** 
- **Marcus** (Senior Developer / Architect)
- **Elena** (Optimizer / Performance Engineer)
- **David** (Deep-Researcher / Verification)

---

## Week 1: Embracing Compute Shaders

**Marcus:** This month is dedicated entirely to the WebGPU backend. We are writing pure WGSL. Elena, you've been waiting for this. How does our LUT generation pipeline change when we move from Fragment Shaders to Compute Shaders?

**Elena:** It changes everything. With WebGL, to generate a 256x256 Transmittance LUT, we had to draw a full-screen quad, run the vertex shader, rasterize 65,536 pixels, and output to a framebuffer. With WebGPU, we just define a compute shader with a workgroup size of, say, 8x8. We dispatch 32x32 workgroups. The GPU executes the threads directly, writing the results to a `texture_storage_2d<rgba16float, write>`. No rasterization overhead.

**David:** Mathematically, the Hillaire (2020) model requires three passes:
1. `TransmittanceLUT` (256x64)
2. `MultiScatteringLUT` (32x32)
3. `SkyViewLUT` (192x108)

**Elena:** Because these are sequential (Multi-Scattering depends on Transmittance; Sky-View depends on both), we will use three separate `ComputeShader` instances in Babylon.js. We dispatch them in order during the scene's `onBeforeRenderObservable`.

---

## Week 2: The Multi-Scattering Integration

**David:** The Multi-Scattering LUT is the most computationally heavy part of the setup. It requires integrating the scattered light over a sphere (all directions) for various altitudes and sun angles. In a fragment shader, this meant a massive `for` loop sampling the Transmittance LUT hundreds of times per pixel.

**Elena:** With WGSL compute shaders, we can optimize this heavily. We can use shared memory (`var<workgroup>`) if we need to share integration results across threads, though for this specific integral, independent thread execution might still be optimal due to the lack of spatial dependency between different altitudes. 

**Marcus:** Let's keep the WGSL implementation clean first. We map the `global_invocation_id.xy` to the UV coordinates of the LUT. We read the `sunAngle` and `altitude` from those UVs, perform the spherical integration loop, and write to the storage texture. 

**David:** One crucial detail: WebGPU uses a different coordinate system than WebGL (Y-axis is flipped in textures, NDC depth is 0 to 1 instead of -1 to 1). We must ensure our ray-sphere intersection math and UV mapping in the WGSL code account for this, otherwise the sky will render upside down or the horizon math will fail.

---

## Week 3: Aerial Perspective (3D LUTs)

**Julian:** (Joining briefly) Since we dropped clouds, we have performance budget left. I want Aerial Perspective. If I place a mountain 10 kilometers away, it shouldn't just be tinted by a flat fog color. It should be tinted by the actual atmospheric scattering between the camera and the mountain.

**David:** To do that properly, we need a 3D LUT (Camera Volume). We parameterize it by screen space (X, Y) and depth (Z). For each voxel in this 3D texture, we raymarch from the camera to that depth, accumulating scattering and transmittance.

**Elena:** A 3D LUT in a WebGL fragment shader is a nightmare (rendering to slices). In a WebGPU compute shader, it's trivial. We use a `texture_storage_3d`. We dispatch a 3D workgroup, e.g., `dispatchWorkgroups(width / 8, height / 8, depth / 8)`. 

**Marcus:** We can generate a 32x32x32 Aerial Perspective volume every frame. When rendering the opaque geometry (the mountain), the standard PBR material samples this 3D LUT based on the fragment's screen position and depth. 

**Elena:** Babylon.js allows custom shader injection via `MaterialPluginBase`. We can inject a snippet into the standard PBR shader that reads our `aerialPerspectiveLUT` and applies it just before the final color output:
`finalColor = finalColor * transmittance + scattering;`

---

## Week 4: Synchronization and Barriers

**Marcus:** In WebGL, we had to use a dual-sphere cache to prevent the camera from sampling a LUT while it was still being drawn, which caused pipeline stalls. Does WebGPU solve this?

**Elena:** Yes and no. WebGPU handles implicit barriers between render passes and compute passes. If we dispatch our Compute Shaders in `onBeforeRenderObservable`, and then the main render pass uses those textures as `texture_2d<f32>` bindings, the WebGPU driver will automatically insert the necessary memory barriers. The render pass will wait for the compute pass to finish writing.

**Marcus:** Will that stall the GPU?

**Elena:** It's a dependency chain, so yes, the fragment shader waits for the compute shader. However, because compute shaders are so fast, and we only update the Sky-View LUT (192x108) per frame, the compute time is less than 0.1ms. It's negligible. 

**David:** Furthermore, the Transmittance and Multi-Scattering LUTs only depend on the planet radius and atmosphere density (which rarely change). We only need to compute them *once* at startup, or when the user changes the atmosphere parameters. Only the Sky-View LUT and Aerial Perspective 3D LUT need to be recomputed every frame because they depend on the camera and sun position.

**Marcus:** Excellent. The WebGPU architecture is solid. 
1. **Static Compute:** Transmittance & Multi-Scattering (run on parameter change).
2. **Dynamic Compute:** Sky-View & Aerial Perspective (run every frame).
3. **Render:** A simple full-screen quad (or skybox sphere) that samples the Sky-View LUT.

Next month, we figure out how to replicate this in WebGL2 without compute shaders.
