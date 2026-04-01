export const skyViewComputeWGSL = `
@group(0) @binding(0) var skyViewTexture: texture_storage_2d<rgba16float, write>;
@group(0) @binding(1) var transmittanceTexture: texture_2d<f32>;
@group(0) @binding(3) var multiScatteringTexture: texture_2d<f32>;

struct Params {
    radii: vec4<f32>, // x: planetRadius, y: atmosphereRadius
    rayleigh: vec4<f32>, // xyz: scattering
    mie: vec4<f32>, // xyz: scattering
    mieExt: vec4<f32>, // xyz: extinction
    absorption: vec4<f32>, // xyz: absorption
    sunDir: vec4<f32>, // xyz: sunDirection
    cameraPos: vec4<f32>, // xyz: cameraPosition
    sunColor: vec4<f32>, // rgb: color, a: emittance
    magneticParams: vec4<f32>, // x: interaction, y: time
}
@group(0) @binding(2) var<uniform> params: Params;

const RAYLEIGH_SCALE_HEIGHT: f32 = 8000.0;
const MIE_SCALE_HEIGHT: f32 = 1200.0;
const OZONE_CENTER_ALTITUDE: f32 = 25000.0;
const OZONE_WIDTH: f32 = 15000.0;

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

fn sampleMultiScatteringBilinear(uv: vec2<f32>) -> vec3<f32> {
    let dim = vec2<f32>(textureDimensions(multiScatteringTexture));
    let pixel = uv * dim - 0.5;
    let p0 = floor(pixel);
    let f = fract(pixel);
    
    let x0 = clamp(i32(p0.x), 0, i32(dim.x) - 1);
    let x1 = clamp(i32(p0.x) + 1, 0, i32(dim.x) - 1);
    let y0 = clamp(i32(p0.y), 0, i32(dim.y) - 1);
    let y1 = clamp(i32(p0.y) + 1, 0, i32(dim.y) - 1);
    
    let c00 = textureLoad(multiScatteringTexture, vec2<i32>(x0, y0), 0).rgb;
    let c10 = textureLoad(multiScatteringTexture, vec2<i32>(x1, y0), 0).rgb;
    let c01 = textureLoad(multiScatteringTexture, vec2<i32>(x0, y1), 0).rgb;
    let c11 = textureLoad(multiScatteringTexture, vec2<i32>(x1, y1), 0).rgb;
    
    let c0 = mix(c00, c10, f.x);
    let c1 = mix(c01, c11, f.x);
    return mix(c0, c1, f.y);
}

fn getMultiScattering(r: f32, mu_s: f32) -> vec3<f32> {
    let u = clamp(mu_s * 0.5 + 0.5, 0.0, 1.0);
    let v = clamp((r - params.radii.x) / (params.radii.y - params.radii.x), 0.0, 1.0);
    return sampleMultiScatteringBilinear(vec2<f32>(u, v));
}

fn phaseRayleigh(cosTheta: f32) -> f32 {
    return 3.0 / (16.0 * 3.14159265) * (1.0 + cosTheta * cosTheta);
}

fn phaseMie(cosTheta: f32, g: f32) -> f32 {
    let g2 = g * g;
    let num = 3.0 * (1.0 - g2) * (1.0 + cosTheta * cosTheta);
    let den = 8.0 * 3.14159265 * (2.0 + g2) * pow(1.0 + g2 - 2.0 * g * cosTheta, 1.5);
    return num / den;
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

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let dim = textureDimensions(skyViewTexture);
    if (global_id.x >= dim.x || global_id.y >= dim.y) {
        return;
    }

    let uv = vec2<f32>(f32(global_id.x) + 0.5, f32(global_id.y) + 0.5) / vec2<f32>(f32(dim.x), f32(dim.y));
    
    let planetRadius = params.radii.x;
    let atmosphereRadius = params.radii.y;
    let sunDir = normalize(params.sunDir.xyz);
    
    // Map UV to view direction (simplified for Phase 1)
    let azimuth = uv.x * 2.0 * 3.14159265;
    
    // Non-linear mapping for elevation to get more detail near horizon
    var elevation: f32;
    if (uv.y < 0.5) {
        let d = 1.0 - 2.0 * uv.y;
        elevation = -pow(d, 1.2) * 3.14159265 * 0.5;
    } else {
        let d = (uv.y - 0.5) * 2.0;
        elevation = pow(d, 1.2) * 3.14159265 * 0.5;
    }
    
    let rayDir = vec3<f32>(
        cos(elevation) * sin(azimuth),
        sin(elevation),
        cos(elevation) * cos(azimuth)
    );
    
    // For Phase 1, we just do a simplified single scattering integration here
    // to prove the pipeline works.
    let rayOrigin = vec3<f32>(params.cameraPos.x, params.cameraPos.y + planetRadius, params.cameraPos.z);
    
    let atmoIntersection = raySphereIntersect(rayOrigin, rayDir, atmosphereRadius);
    if (atmoIntersection.y < 0.0) {
        textureStore(skyViewTexture, global_id.xy, vec4<f32>(0.0, 0.0, 0.0, 1.0));
        return;
    }
    
    var tMax = atmoIntersection.y;
    let planetIntersection = raySphereIntersect(rayOrigin, rayDir, planetRadius);
    if (planetIntersection.x > 0.0) {
        tMax = min(tMax, planetIntersection.x);
    }
    
    let numSamples = 64u;
    let dt = tMax / f32(numSamples);
    
    var totalR = vec3<f32>(0.0);
    var totalM = vec3<f32>(0.0);
    var totalMS = vec3<f32>(0.0);
    var opticalDepthR = 0.0;
    var opticalDepthM = 0.0;
    var opticalDepthO = 0.0;
    
    var tCurrent = dt * 0.5;
    
    for (var i = 0u; i < numSamples; i = i + 1u) {
        let samplePos = rayOrigin + rayDir * tCurrent;
        let height = length(samplePos) - planetRadius;
        
        let hr = exp(-height / RAYLEIGH_SCALE_HEIGHT) * dt;
        let hm = exp(-height / MIE_SCALE_HEIGHT) * dt;
        let ho = max(0.0, 1.0 - abs(height - OZONE_CENTER_ALTITUDE) / OZONE_WIDTH) * dt;
        
        opticalDepthR += hr;
        opticalDepthM += hm;
        opticalDepthO += ho;
        
        // Sample transmittance to sun (simplified: just use the precomputed LUT)
        // Map samplePos to Transmittance LUT UV
        let r_sample = length(samplePos);
        let mu_sample = dot(samplePos / r_sample, sunDir);
        
        let u_trans = clamp(mu_sample * 0.5 + 0.5, 0.0, 1.0);
        let v_trans = clamp((r_sample - planetRadius) / (atmosphereRadius - planetRadius), 0.0, 1.0);
        
        let transToSun = sampleTransmittanceBilinear(vec2<f32>(u_trans, v_trans));
        
        let ms = getMultiScattering(r_sample, mu_sample);
        
        // Attenuation from camera to sample point
        let tau = params.rayleigh.xyz * opticalDepthR + params.mieExt.xyz * opticalDepthM + params.absorption.xyz * opticalDepthO;
        let attenuation = exp(-tau);
        
        let scattering = params.rayleigh.xyz * hr + params.mie.xyz * hm;
        
        totalR += hr * attenuation * transToSun;
        totalM += hm * attenuation * transToSun;
        totalMS += scattering * attenuation * ms;
        
        tCurrent += dt;
    }
    
    let mu = dot(rayDir, sunDir);
    let phaseR = phaseRayleigh(mu);
    let phaseM = phaseMie(mu, 0.76);
    
    let sunIntensity = params.sunDir.w;
    let sunColorRGB = params.sunColor.rgb;
    
    let singleScattering = (totalR * params.rayleigh.xyz * phaseR + totalM * params.mie.xyz * phaseM) * sunIntensity * sunColorRGB;
    let multiScattering = totalMS * sunIntensity * sunColorRGB;
    
    let color = singleScattering + multiScattering;
    
    textureStore(skyViewTexture, global_id.xy, vec4<f32>(color, 1.0));
}
`;
