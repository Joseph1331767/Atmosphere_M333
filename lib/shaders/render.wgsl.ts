export const renderVertexWGSL = `
attribute position: vec3<f32>;
varying vPosition: vec3<f32>;
varying vClipPos: vec4<f32>;

uniform worldViewProjection: mat4x4<f32>;

@vertex
fn main(input: VertexInputs) -> FragmentInputs {
    vertexOutputs.position = uniforms.worldViewProjection * vec4<f32>(input.position, 1.0);
    vertexOutputs.vPosition = input.position;
    vertexOutputs.vClipPos = vertexOutputs.position;
    return vertexOutputs;
}
`;

export const renderFragmentWGSL = `
varying vPosition: vec3<f32>;
varying vClipPos: vec4<f32>;

uniform cameraPosition: vec3<f32>;
uniform cameraExposure: f32;
uniform sunDirection: vec3<f32>;
uniform time: f32;
uniform magneticInteraction: f32;
uniform effectIntensity: f32;
uniform sunEmittance: f32;
uniform sunColor: vec3<f32>;
uniform radii: vec2<f32>;

var skyViewTexture: texture_2d<f32>; 
var transmittanceTexture: texture_2d<f32>;

fn interleavedGradientNoise(n: vec2<f32>) -> f32 {
    return fract(52.9829189 * fract(dot(n, vec2<f32>(0.06711056, 0.00583715))));
}

fn animatedIGN(coord: vec2<f32>, frameTime: f32) -> f32 {
    let angle = frameTime * 2.399963229; // golden angle rotation per frame
    let c = cos(angle);
    let s = sin(angle);
    let rotated = vec2<f32>(c * coord.x - s * coord.y, s * coord.x + c * coord.y);
    return fract(52.9829189 * fract(dot(rotated, vec2<f32>(0.06711056, 0.00583715))));
}

fn hash(p: vec3<f32>) -> f32 {
    var p3 = fract(p * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

fn noise(x: vec3<f32>) -> f32 {
    let p = floor(x);
    let f = fract(x);
    let f2 = f * f * (3.0 - 2.0 * f);
    
    return mix(
        mix(
            mix(hash(p + vec3<f32>(0.0,0.0,0.0)), hash(p + vec3<f32>(1.0,0.0,0.0)), f2.x),
            mix(hash(p + vec3<f32>(0.0,1.0,0.0)), hash(p + vec3<f32>(1.0,1.0,0.0)), f2.x),
            f2.y
        ),
        mix(
            mix(hash(p + vec3<f32>(0.0,0.0,1.0)), hash(p + vec3<f32>(1.0,0.0,1.0)), f2.x),
            mix(hash(p + vec3<f32>(0.0,1.0,1.0)), hash(p + vec3<f32>(1.0,1.0,1.0)), f2.x),
            f2.y
        ),
        f2.z
    );
}

fn raySphereIntersect(r0: vec3<f32>, rd: vec3<f32>, sr: f32) -> vec2<f32> {
    let a = dot(rd, rd);
    let b = 2.0 * dot(rd, r0);
    let c = dot(r0, r0) - (sr * sr);
    let d = (b * b) - 4.0 * a * c;
    if (d < 0.0) {
        return vec2<f32>(-1.0, -1.0);
    }
    return vec2<f32>(
        (-b - sqrt(d)) / (2.0 * a),
        (-b + sqrt(d)) / (2.0 * a)
    );
}

fn sampleTransmittanceBilinear(uv: vec2<f32>) -> vec3<f32> {
    let dim = vec2<f32>(textureDimensions(transmittanceTexture));
    let pixel = uv * dim - 0.5;
    let p0 = floor(pixel);
    let f = fract(pixel);
    
    let x0 = clamp(i32(p0.x), 0, i32(dim.x) - 1);
    let x1 = clamp(i32(p0.x) + 1, 0, i32(dim.x) - 1);
    let y0 = clamp(i32(p0.y), 0, i32(dim.y) - 1);
    let y1 = clamp(i32(p0.y) + 1, 0, i32(dim.y) - 1);
    
    let c00 = textureLoad(transmittanceTexture, vec2<i32>(x0, y0), 0).rgb;
    let c10 = textureLoad(transmittanceTexture, vec2<i32>(x1, y0), 0).rgb;
    let c01 = textureLoad(transmittanceTexture, vec2<i32>(x0, y1), 0).rgb;
    let c11 = textureLoad(transmittanceTexture, vec2<i32>(x1, y1), 0).rgb;
    
    let c0 = mix(c00, c10, f.x);
    let c1 = mix(c01, c11, f.x);
    return mix(c0, c1, f.y);
}

fn getTransmittance(r: f32, mu: f32) -> vec3<f32> {
    let u = clamp(mu * 0.5 + 0.5, 0.0, 1.0);
    let v = clamp((r - uniforms.radii.x) / (uniforms.radii.y - uniforms.radii.x), 0.0, 1.0);
    return sampleTransmittanceBilinear(vec2<f32>(u, v));
}

fn evaluateAurora(pos: vec3<f32>, rayDir: vec3<f32>, jitter: f32) -> vec3<f32> {
    let planetRadius = uniforms.radii.x;
    let alt = length(pos) - planetRadius;
    
    // Stretch much higher into the sky (up to 600km)
    if (alt < 80000.0 || alt > 600000.0) { return vec3<f32>(0.0); }
    
    // Normalize altitude (80km to 600km)
    let hNorm = (alt - 80000.0) / 520000.0;
    
    let normal = normalize(pos);
    
    // Create a rotation basis aligned with the sun
    let sunDir = normalize(uniforms.sunDirection);
    var right = cross(vec3<f32>(0.0, 1.0, 0.0), sunDir);
    if (length(right) < 0.001) {
        right = normalize(cross(vec3<f32>(1.0, 0.0, 0.0), sunDir));
    } else {
        right = normalize(right);
    }
    let forward = normalize(cross(sunDir, right));
    
    // Transform normal into sun-aligned space
    let sunSpaceNormal = vec3<f32>(
        dot(normal, right),
        dot(normal, sunDir),
        dot(normal, forward)
    );
    
    // Calculate latitude and longitude relative to the sun's position
    let latitude = asin(sunSpaceNormal.y);
    let longitude = atan2(sunSpaceNormal.x, sunSpaceNormal.z);
    
    // The 3 distinct scalars
    let intensity = clamp(uniforms.effectIntensity, 0.0, 2.0); // Size, height, brightness
    let mag = clamp(uniforms.magneticInteraction, 0.0, 1.0);   // Speed, chaos, state changes
    let particle = clamp(uniforms.sunEmittance, 0.0, 2.0);     // Color variance, rainbow, penetration
    
    // 1. INTENSITY: Size in sky & Height stretch
    let baseAuroraLat = 1.18;
    let targetLat = mix(baseAuroraLat, 0.2, intensity * 0.5);
    let auroraWidth = mix(0.1, 1.5, intensity * 0.5); 
    
    let latDist = abs(abs(latitude) - targetLat);
    let latFactor = smoothstep(auroraWidth, 0.0, latDist);
    if (latFactor <= 0.0) { return vec3<f32>(0.0); }
    
    // Per-pixel grid-breaking offset - prevents noise grid from showing as horizontal bands
    let gridBreak = (jitter - 0.5) * 0.4;
    
    // 2. MAG: Speed dilation and Turbulence
    let timeScaled = uniforms.time * mix(0.02, 0.3, mag);
    
    // Domain warping (Chaos)
    let warpNoise = noise(vec3<f32>(longitude * 3.0 + gridBreak * 0.1, latitude * 3.0 + gridBreak * 0.1, timeScaled * 0.5));
    let warpedLong = longitude + warpNoise * mix(0.2, 2.0, mag);
    
    let curtainFreq = mix(6.0, 25.0, mag);
    let n1 = noise(vec3<f32>(warpedLong * curtainFreq, timeScaled, gridBreak * 0.5));
    let n2 = noise(vec3<f32>(warpedLong * curtainFreq * 2.0 - timeScaled, timeScaled * 1.5, gridBreak * 0.5));
    
    let bandNoise = noise(vec3<f32>(latitude * 20.0 + gridBreak * 0.3, warpedLong * 5.0, timeScaled + gridBreak * 0.1));
    let bandFactor = smoothstep(mix(0.4, 0.0, mag), 0.6, bandNoise);
    
    let curtainShape = smoothstep(0.3, 0.7, n1 * 0.6 + n2 * 0.4) * bandFactor;
    
    // Rays (emerge as mag increases)
    let rayIntensity = smoothstep(0.2, 0.7, mag);
    let rayFreq = mix(60.0, 250.0, mag);
    let rayNoise = noise(vec3<f32>(warpedLong * rayFreq - timeScaled * 10.0, latitude * 10.0 + gridBreak * 0.2, gridBreak * 0.3));
    let rays = mix(1.0, smoothstep(0.3, 1.0, rayNoise), rayIntensity);
    
    // Chorus Waves (fast ripples on bottom edge, high mag)
    let chorusIntensity = smoothstep(0.6, 0.9, mag);
    let chorusFreq = 200.0;
    let chorusSpeed = timeScaled * 50.0;
    let chorusNoise = sin(warpedLong * chorusFreq + chorusSpeed) * 0.5 + 0.5;
    let chorusRipple = mix(1.0, smoothstep(0.4, 1.0, chorusNoise), chorusIntensity * (1.0 - smoothstep(0.0, 0.1, hNorm)));
    
    // Substorm Pulsations (global flashing, peak mag)
    let pulsationIntensity = smoothstep(0.8, 1.0, mag);
    let pulseSlow = sin(timeScaled * 3.0 + longitude * 2.0) * 0.5 + 0.5;
    let pulseFast = noise(vec3<f32>(longitude * 10.0, latitude * 10.0 + gridBreak * 0.15, timeScaled * 20.0));
    let pulsation = mix(1.0, pulseSlow * pulseFast * 3.0, pulsationIntensity);
    
    // Day/Night (Sunward vs Anti-Sunward)
    let sunDot = dot(normal, uniforms.sunDirection);
    let isDay = smoothstep(-0.2, 0.2, sunDot);
    
    let nightStructure = curtainShape * (0.4 + 0.6 * rays) * chorusRipple * pulsation;
    
    // Day Side Coronal Airglow
    let dayHazeNoise = noise(vec3<f32>(longitude * 5.0, latitude * 5.0 + gridBreak * 0.1, timeScaled * 5.0));
    let dayStructure = smoothstep(0.2, 0.8, dayHazeNoise) * smoothstep(0.4, 1.0, hNorm);
    
    let structure = mix(nightStructure, dayStructure, isDay);
    if (structure <= 0.0) { return vec3<f32>(0.0); }
    
    // 3. PARTICLE (sunEmittance): Color Variance & Rainbow Effects
    var color = vec3<f32>(0.0);
    
    // Rainbow palette function based on altitude and longitude, scaled by particle
    let rainbowT = hNorm * 3.0 + longitude + timeScaled;
    let rainbowColor = 0.5 + 0.5 * cos(6.28318 * (vec3<f32>(1.0, 1.0, 1.0) * rainbowT + vec3<f32>(0.0, 0.33, 0.67)));
    
    // Standard colors
    let calmGreen = vec3<f32>(0.05, 1.0, 0.2);
    let violentPink = vec3<f32>(1.0, 0.2, 0.6);
    let baseColor = mix(calmGreen, violentPink, mag);
    
    // Mix standard and rainbow based on particle scalar
    let activeColor = mix(baseColor, rainbowColor, smoothstep(0.5, 2.0, particle));
    
    // Height stretching based on intensity
    // At low intensity, it fades out quickly. At high intensity, it reaches the top.
    let heightStretch = mix(4.0, 0.8, intensity * 0.5); 
    let stretchedHNorm = hNorm * heightStretch;
    
    // Lower band (Green/Pink/Rainbow)
    let lowerFactor = smoothstep(0.0, 0.1, stretchedHNorm) * (1.0 - smoothstep(0.2, 0.6, stretchedHNorm));
    color += activeColor * lowerFactor;
    
    // Upper band (Red/White/Rainbow)
    let upperColor = mix(vec3<f32>(1.0, 0.05, 0.1), vec3<f32>(1.0, 0.9, 1.0), mag);
    let activeUpper = mix(upperColor, rainbowColor, smoothstep(0.5, 2.0, particle));
    let upperFactor = smoothstep(0.3, 1.0, stretchedHNorm) * (1.0 - smoothstep(0.8, 1.0, stretchedHNorm));
    color += activeUpper * upperFactor;
    
    // Bottom penetration (Deep Purple/Blue)
    let penetration = smoothstep(0.5, 2.0, particle) + intensity * 0.5;
    let bottomColor = mix(vec3<f32>(0.8, 0.1, 1.0), vec3<f32>(0.2, 0.5, 1.0), isDay);
    let bottomFactor = (1.0 - smoothstep(0.0, 0.1, stretchedHNorm)) * penetration;
    color += bottomColor * bottomFactor;
    
    // Final Intensity
    let dayVisibility = mix(0.1, 1.0, intensity * 0.5);
    let visibilityFactor = mix(1.0, dayVisibility, isDay);
    
    let finalIntensity = structure * latFactor * visibilityFactor * intensity * 10.0;
    
    return color * finalIntensity;
}

fn sampleSkyViewBilinear(uv: vec2<f32>) -> vec3<f32> {
    let dim = vec2<f32>(textureDimensions(skyViewTexture));
    let pixel = uv * dim - 0.5;
    let p0 = floor(pixel);
    let f = fract(pixel);
    
    let x0 = i32(p0.x) % i32(dim.x);
    let x1 = (i32(p0.x) + 1) % i32(dim.x);
    let x0_wrap = select(x0 + i32(dim.x), x0, x0 >= 0);
    let x1_wrap = select(x1 + i32(dim.x), x1, x1 >= 0);
    
    let y0 = clamp(i32(p0.y), 0, i32(dim.y) - 1);
    let y1 = clamp(i32(p0.y) + 1, 0, i32(dim.y) - 1);
    
    let c00 = textureLoad(skyViewTexture, vec2<i32>(x0_wrap, y0), 0).rgb;
    let c10 = textureLoad(skyViewTexture, vec2<i32>(x1_wrap, y0), 0).rgb;
    let c01 = textureLoad(skyViewTexture, vec2<i32>(x0_wrap, y1), 0).rgb;
    let c11 = textureLoad(skyViewTexture, vec2<i32>(x1_wrap, y1), 0).rgb;
    
    let c0 = mix(c00, c10, f.x);
    let c1 = mix(c01, c11, f.x);
    return mix(c0, c1, f.y);
}

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
    let rayDir = normalize(input.vPosition);
    
    // Map rayDir to UV (simplified spherical mapping matching skyview.wgsl)
    let azimuth = atan2(rayDir.x, rayDir.z); // -pi to pi
    let elevation = asin(clamp(rayDir.y, -1.0, 1.0)); // -pi/2 to pi/2
    
    let u = fract(azimuth / (2.0 * 3.14159265));
    var v: f32;
    if (elevation < 0.0) {
        v = 0.5 - 0.5 * pow(max(0.0, -elevation / (3.14159265 * 0.5)), 0.83333333);
    } else {
        v = 0.5 + 0.5 * pow(max(0.0, elevation / (3.14159265 * 0.5)), 0.83333333);
    }
    
    var color = sampleSkyViewBilinear(vec2<f32>(u, v));
    
    // Per-pixel animated jitter for ray-march and aurora noise grid breaking
    let jitterCoord = (input.vClipPos.xy / input.vClipPos.w) * vec2<f32>(1920.0, 1080.0);
    let rayJitter = animatedIGN(jitterCoord, uniforms.time);
    
    // Raymarch aurora
    if (uniforms.magneticInteraction > 0.0 || uniforms.effectIntensity > 0.0) {
        let planetRadius = uniforms.radii.x;
        let rayOrigin = vec3<f32>(uniforms.cameraPosition.x, uniforms.cameraPosition.y + planetRadius, uniforms.cameraPosition.z);
        
        let atmoIntersection = raySphereIntersect(rayOrigin, rayDir, planetRadius + 600000.0);
        if (atmoIntersection.y > 0.0) {
            var tMin = max(0.0, atmoIntersection.x);
            var tMax = atmoIntersection.y;
            
            let planetIntersection = raySphereIntersect(rayOrigin, rayDir, planetRadius + 80000.0);
            if (planetIntersection.x > 0.0) {
                tMax = min(tMax, planetIntersection.x);
            }
            
            if (tMax > tMin) {
                let numSamples = 16u;
                let dt = (tMax - tMin) / f32(numSamples);
                var tCurrent = tMin + dt * rayJitter;
                var totalAurora = vec3<f32>(0.0);
                
                for (var i = 0u; i < numSamples; i = i + 1u) {
                    let samplePos = rayOrigin + rayDir * tCurrent;
                    totalAurora += evaluateAurora(samplePos, rayDir, rayJitter) * dt * 0.00001; // scale down dt
                    tCurrent += dt;
                }
                
                // Apply atmospheric transmittance to the aurora light
                let r = length(rayOrigin);
                let mu = dot(normalize(rayOrigin), rayDir);
                let transmittance = getTransmittance(r, mu);
                
                color += totalAurora * uniforms.sunColor * transmittance;
            }
        }
    }
    
    // Tone mapping
    let mappedColor = vec3<f32>(1.0) - exp(-color * uniforms.cameraExposure);
    
    // Dithering
    let ditherNoise = animatedIGN(jitterCoord, uniforms.time * 6.0);
    let ditheredColor = mappedColor + vec3<f32>((ditherNoise - 0.5) / 255.0);
    
    fragmentOutputs.color = vec4<f32>(ditheredColor, 1.0);
    return fragmentOutputs;
}
`;
