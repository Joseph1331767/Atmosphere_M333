export const multiScatteringComputeWGSL = `
@group(0) @binding(0) var multiScatteringTexture: texture_storage_2d<rgba16float, write>;
@group(0) @binding(1) var transmittanceTexture: texture_2d<f32>;

struct Params {
    radii: vec4<f32>,
    rayleigh: vec4<f32>,
    mie: vec4<f32>,
    mieExt: vec4<f32>,
    absorption: vec4<f32>,
    sunDir: vec4<f32>,
    cameraPos: vec4<f32>,
    sunColor: vec4<f32>,
    magneticParams: vec4<f32>,
}
@group(0) @binding(2) var<uniform> params: Params;

const RAYLEIGH_SCALE_HEIGHT: f32 = 8000.0;
const MIE_SCALE_HEIGHT: f32 = 1200.0;
const OZONE_CENTER_ALTITUDE: f32 = 25000.0;
const OZONE_WIDTH: f32 = 15000.0;
const PI: f32 = 3.14159265359;

fn raySphereIntersect(r0: vec3<f32>, rd: vec3<f32>, sr: f32) -> vec2<f32> {
    let a = dot(rd, rd);
    let b = 2.0 * dot(rd, r0);
    let c = dot(r0, r0) - (sr * sr);
    let d = (b * b) - 4.0 * a * c;
    if (d < 0.0) { return vec2<f32>(-1.0, -1.0); }
    return vec2<f32>((-b - sqrt(d)) / (2.0 * a), (-b + sqrt(d)) / (2.0 * a));
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
    let v = clamp((r - params.radii.x) / (params.radii.y - params.radii.x), 0.0, 1.0);
    return sampleTransmittanceBilinear(vec2<f32>(u, v));
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let dim = textureDimensions(multiScatteringTexture);
    if (global_id.x >= dim.x || global_id.y >= dim.y) { return; }

    let uv = vec2<f32>(f32(global_id.x) + 0.5, f32(global_id.y) + 0.5) / vec2<f32>(f32(dim.x), f32(dim.y));
    
    let planetRadius = params.radii.x;
    let atmosphereRadius = params.radii.y;
    
    let r = mix(planetRadius, atmosphereRadius, uv.y);
    let mu_s = mix(-1.0, 1.0, uv.x);
    let sunDir = vec3<f32>(sqrt(max(0.0, 1.0 - mu_s * mu_s)), mu_s, 0.0);
    
    let sqrtSamples = 8u;
    let numSamples = sqrtSamples * sqrtSamples;
    
    var lumTotal = vec3<f32>(0.0);
    var fmsTotal = vec3<f32>(0.0);
    
    for (var i = 0u; i < sqrtSamples; i++) {
        for (var j = 0u; j < sqrtSamples; j++) {
            let u = (f32(i) + 0.5) / f32(sqrtSamples);
            let v = (f32(j) + 0.5) / f32(sqrtSamples);
            
            let theta = acos(1.0 - 2.0 * u);
            let phi = 2.0 * PI * v;
            
            let rayDir = vec3<f32>(sin(theta) * cos(phi), cos(theta), sin(theta) * sin(phi));
            
            let atmoIntersection = raySphereIntersect(vec3<f32>(0.0, r, 0.0), rayDir, atmosphereRadius);
            let planetIntersection = raySphereIntersect(vec3<f32>(0.0, r, 0.0), rayDir, planetRadius);
            
            var tMax = atmoIntersection.y;
            if (planetIntersection.y > 0.0 && planetIntersection.x > -0.001) {
                tMax = planetIntersection.x;
            }
            
            let marchSamples = 40u;
            let dt = tMax / f32(marchSamples);
            var tCurrent = dt * 0.5;
            
            var opticalDepthR = 0.0;
            var opticalDepthM = 0.0;
            var opticalDepthO = 0.0;
            
            var lum = vec3<f32>(0.0);
            var fms = vec3<f32>(0.0);
            
            for (var k = 0u; k < marchSamples; k++) {
                let samplePos = vec3<f32>(0.0, r, 0.0) + rayDir * tCurrent;
                let height = length(samplePos) - planetRadius;
                
                let hr = exp(-height / RAYLEIGH_SCALE_HEIGHT) * dt;
                let hm = exp(-height / MIE_SCALE_HEIGHT) * dt;
                let ho = max(0.0, 1.0 - abs(height - OZONE_CENTER_ALTITUDE) / OZONE_WIDTH) * dt;
                
                opticalDepthR += hr;
                opticalDepthM += hm;
                opticalDepthO += ho;
                
                let tau = params.rayleigh.xyz * opticalDepthR + params.mieExt.xyz * opticalDepthM + params.absorption.xyz * opticalDepthO;
                let attenuation = exp(-tau);
                
                let r_sample = length(samplePos);
                let mu_sample = dot(samplePos / r_sample, sunDir);
                let transToSun = getTransmittance(r_sample, mu_sample);
                
                let scattering = params.rayleigh.xyz * hr + params.mie.xyz * hm;
                let phase = 1.0 / (4.0 * PI);
                
                lum += scattering * attenuation * transToSun * phase;
                fms += scattering * attenuation * phase;
                
                tCurrent += dt;
            }
            
            lumTotal += lum;
            fmsTotal += fms;
        }
    }
    
    let invSamples = 1.0 / f32(numSamples);
    lumTotal *= invSamples * 4.0 * PI;
    fmsTotal *= invSamples * 4.0 * PI;
    
    let multiScattering = lumTotal / max(vec3<f32>(1.0) - fmsTotal, vec3<f32>(0.001));
    
    textureStore(multiScatteringTexture, global_id.xy, vec4<f32>(multiScattering, 1.0));
}
`;
