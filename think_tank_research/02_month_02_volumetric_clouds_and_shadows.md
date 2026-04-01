# Think Tank Session 02: Volumetric Clouds & Shadows
**Date:** Month 2, Week 1-4
**Attendees:** 
- **Marcus** (Senior Developer / Architect)
- **Elena** (Optimizer / Performance Engineer)
- **Julian** (Non-Optimizer / Max Quality Specialist)
- **Chloe** (Designer / Technical Artist)
- **David** (Deep-Researcher / Verification)

---

## Week 1: The Volumetric Cloud Dream

**Marcus:** Month 2. We have the sky model mapped out with the Hillaire 2020 LUT architecture. Now we tackle the most requested feature for AlienSky v2: Volumetric Clouds.

**Julian:** Finally. I want raymarched volumetric clouds. 3D Worley-Perlin noise. Horizon-to-horizon coverage. Multiple scattering *inside* the clouds. I want to fly a spaceship through them and see the light scatter around the cockpit.

**Elena:** Do you want the GPU to melt? You are talking about a 3D texture sampling operation inside a `for` loop (raymarching) inside a fragment shader. In an open-world game, we have 50,000 other meshes to render. If we do a 128-step raymarch for every pixel on a 4K screen, we are dead in the water.

**David:** Let's look at the industry standard. The gold standard for real-time volumetric clouds was established by Guerrilla Games in *Horizon Zero Dawn* (Schneider, 2015). They use a 3D texture for the base shape (Perlin-Worley noise) and another 3D texture for edge detail (Worley noise). They raymarch up to 128 steps, but with heavy optimizations.

**Julian:** See? 128 steps! It's possible!

**Elena:** Guerrilla Games also used temporal reprojection (TAA) and rendered the clouds at quarter resolution (half-width, half-height). They didn't render 128 steps per pixel at 4K. They rendered a fraction of the pixels and blended them over time. We are in Babylon.js. We can do quarter-res, but we need a robust temporal upscaler.

**Chloe:** Before we talk about upscalers, I need to know how I control these clouds. I don't want a random noise field. I want to paint cloud coverage. I want a weather map where Red = coverage, Green = type (cumulus vs. stratus), and Blue = wetness/rain. If the player is in a desert biome, the clouds should be wispy cirrus. If they are in a swamp, thick cumulonimbus.

**David:** That's exactly the Guerrilla approach. A 2D "Weather Map" texture is sampled *before* the 3D raymarch. If the coverage channel is 0, the shader early-outs and skips the expensive 3D raymarch entirely.

**Elena:** Early-out is fantastic. We can skip the raymarch entirely for clear skies or empty patches. But WebGL2 doesn't support 3D textures as easily or efficiently as WebGPU.

**David:** Actually, WebGL2 *does* support `WebGLTexture` with `TEXTURE_3D`. Babylon.js exposes this via `RawTexture3D`. We can generate the 3D noise on the CPU once during loading, or use a WebGL2 fragment shader to render slices into a 2D array, then bind it as a 3D texture.

**Marcus:** We are targeting WebGPU first, with a WebGL2 fallback. We will use a 3D texture. But Elena's point about quarter-resolution is critical. We cannot render this at full resolution.

---

## Week 2: The Quarter-Resolution Rendering Pipeline

**Elena:** If we render the clouds to a separate `RenderTargetTexture` at 0.5x scale (quarter the total pixels), we save 75% of the fragment shader cost. But when we composite that low-res cloud texture back over the high-res scene, the edges of the clouds will look blocky and pixelated, especially against high-contrast objects like mountains.

**Julian:** We can use Bilateral Upsampling! It's a technique that uses the high-resolution depth buffer to guide the upscaling of the low-resolution color buffer. It prevents the clouds from bleeding over the edges of foreground objects.

**David:** (Researching) Bilateral upsampling is standard practice for low-res volumetrics. You take a 4x4 block of high-res depth pixels, compare them to the low-res depth, and weight the interpolation so you don't blur across depth discontinuities.

**Elena:** That works for compositing. But what about the internal noise of the clouds? If they are rendered at quarter-res, they will look blurry and lack detail, even with bilateral upsampling.

**Julian:** That's where Temporal Anti-Aliasing (TAA) or Temporal Reprojection comes in. We render a different sub-pixel jitter every frame. Over 4 frames, we accumulate a full-resolution image.

**Marcus:** Babylon.js has a built-in `TAAPostProcess`. Can we leverage that?

**Elena:** The built-in TAA is for the whole scene. We need a specialized temporal accumulation buffer *just* for the clouds, before compositing them. Otherwise, the TAA will ghost the clouds over moving characters. We need to write a custom temporal reprojection shader that takes the camera's previous view-projection matrix, reprojects the previous frame's cloud buffer to the current frame, and blends them based on a confidence metric.

**David:** This is getting complex. A custom temporal reprojection pass in WebGL/WebGPU requires managing history buffers (ping-ponging two textures) and passing previous frame matrices.

**Chloe:** Is it worth it? Can we just use a high-quality noise function and accept a little softness? Clouds are fluffy anyway.

**Julian:** No! I want crisp, boiling cauliflower edges on my cumulonimbus clouds!

**Marcus:** We will implement the quarter-res render target with bilateral upsampling first. It's robust and cross-API. If the performance budget allows, we will add the custom temporal accumulation pass as an optional "Ultra Quality" toggle.

---

## Week 3: Cloud Shadows and the Ground

**Julian:** What about cloud shadows? The clouds need to cast shadows on the ground, and they need to self-shadow so they look volumetric and thick.

**Elena:** Self-shadowing requires a secondary raymarch towards the sun for *every* step of the primary raymarch. If the primary raymarch is 64 steps, and the secondary is 6 steps, that's 384 3D texture samples per pixel. Even at quarter resolution, that's heavy.

**David:** (Researching) Frostbite and Guerrilla use a "Shadow Map" for clouds. It's a 2D texture rendered from the sun's perspective, storing optical depth (thickness).

**Elena:** Yes! A 2D cloud shadow map. We render it once per frame, or even amortize it over several frames since clouds move slowly. The ground shader just samples this 2D texture.

**Chloe:** Can the shadow map be soft? Cloud shadows aren't hard edges like a building shadow. They are diffuse.

**Elena:** We can apply a Gaussian blur post-process to the 2D shadow map, or use PCF (Percentage-Closer Filtering) when sampling it.

**Julian:** But wait, if the ground shader needs to sample this shadow map, we are back to the same problem we had with Aerial Perspective! We have to inject code into every `PBRMaterial` in the user's game!

**Marcus:** Not necessarily. We can use a Decal or a Light Cookie. Babylon.js supports `DirectionalLight` with a projection texture (a cookie). We can assign our 2D Cloud Shadow Map as the projection texture of the main sun light!

**David:** That is brilliant. A `DirectionalLight` in Babylon.js can project a texture over the entire scene. It automatically handles the projection math, and it integrates perfectly with the standard PBR pipeline without any custom shader injection.

**Elena:** We just need to ensure the projection matrix of the light covers the visible frustum of the camera, so the shadows follow the player. We update the light's position and projection bounds dynamically.

**Chloe:** And the shadows will naturally soften if we blur the cookie texture?

**Elena:** Exactly. We render the 2D optical depth map (a top-down orthographic view of the clouds), blur it, and feed it to the `DirectionalLight.projectionTexture`. It's zero-cost on the fragment shader side because Babylon's standard materials already calculate light cookies.

---

## Week 4: The Multiple Scattering Approximation

**Julian:** Okay, shadows are solved. But what about the light *inside* the cloud? When you look at a cloud near the sun, it has a silver lining. When you look at the dark belly of a storm cloud, it's not pitch black, it's a deep, bruised purple or gray because light bounces around inside the water droplets.

**David:** True multiple scattering inside a participating medium is impossible in real-time. But there are approximations. The "Powder Effect" (Beer-Lambert law modified) is commonly used.

**Julian:** The Powder Effect is just an analytical hack. It adds a fake brightness term based on depth. I want something better.

**David:** (Researching) Sebastien Hillaire (again, the legend) proposed a multi-scattering approximation for volumetrics in 2016. Instead of a secondary raymarch, you sample the density at the current point, and use an analytical function that assumes the light scatters isotropically in a sphere around that point. It's a cheap mathematical trick that looks incredibly volumetric.

**Elena:** An analytical function? No extra texture samples? No secondary `for` loops?

**David:** Correct. It's just a few extra math operations (exp, pow, mult) per primary raymarch step. It uses an "octave" approach to Beer's Law, simulating multiple bounces by summing attenuated light with increasing blur and decreasing intensity.

**Elena:** I can live with a few extra math operations. ALUs (Arithmetic Logic Units) are cheap on modern GPUs. Texture bandwidth is the real bottleneck. If we can fake multiple scattering with math instead of memory lookups, I'm sold.

**Chloe:** How does this affect my artistic control? If I want the clouds to be lit by a green sun, will this math respect that?

**Julian:** Yes, the analytical function just acts as a multiplier on the incoming light energy. If the incoming light (from the Transmittance LUT we built in Month 1) is green, the multiple scattering will be a softer, diffused green.

**Marcus:** Perfect. We have a solid plan for Volumetric Clouds.
1. **Shape:** 3D Worley-Perlin noise (generated once).
2. **Control:** 2D Weather Map (artist authored).
3. **Performance:** Quarter-resolution render target with Bilateral Upsampling.
4. **Shadows:** 2D Orthographic Depth Map projected via `DirectionalLight` cookie.
5. **Lighting:** Analytical multi-scattering approximation (Hillaire 2016).

**Marcus:** This is a massive undertaking, but it fits perfectly into our WebGPU/WebGL2 dual-architecture. Next month, we will finalize the WGSL specific optimizations and Chloe's artistic toolset.

*(End of Month 2 Transcript)*
