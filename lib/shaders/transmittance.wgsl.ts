export const transmittanceComputeWGSL = `
@group(0) @binding(0) var transmittanceTexture: texture_storage_2d<rgba16float, write>;

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
@group(0) @binding(1) var<uniform> params: Params;

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

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let dim = textureDimensions(transmittanceTexture);
    if (global_id.x >= dim.x || global_id.y >= dim.y) {
        return;
    }

    let uv = vec2<f32>(f32(global_id.x) + 0.5, f32(global_id.y) + 0.5) / vec2<f32>(f32(dim.x), f32(dim.y));
    
    let planetRadius = params.radii.x;
    let atmosphereRadius = params.radii.y;

    // Map UV to altitude (r) and view zenith angle (mu)
    let r_actual = mix(planetRadius, atmosphereRadius, uv.y);
    let mu = mix(-1.0, 1.0, uv.x);
    
    let rayOrigin = vec3<f32>(0.0, r_actual, 0.0);
    let rayDir = vec3<f32>(sqrt(max(0.0, 1.0 - mu * mu)), mu, 0.0); // x=sin, y=cos
    
    // Intersect with atmosphere
    let atmoIntersection = raySphereIntersect(rayOrigin, rayDir, atmosphereRadius);
    var tMax = atmoIntersection.y;
    
    // Intersect with planet
    let planetIntersection = raySphereIntersect(rayOrigin, rayDir, planetRadius);
    if (planetIntersection.y > 0.0 && planetIntersection.x > -0.001) {
        textureStore(transmittanceTexture, global_id.xy, vec4<f32>(0.0, 0.0, 0.0, 1.0));
        return;
    }
    
    let numSamples = 64u;
    let dt = tMax / f32(numSamples);
    
    var opticalDepthR = 0.0;
    var opticalDepthM = 0.0;
    var opticalDepthO = 0.0;
    
    var tCurrent = dt * 0.5;
    
    for (var i = 0u; i < numSamples; i = i + 1u) {
        let samplePos = rayOrigin + rayDir * tCurrent;
        let height = length(samplePos) - planetRadius;
        
        let densityR = exp(-height / RAYLEIGH_SCALE_HEIGHT);
        let densityM = exp(-height / MIE_SCALE_HEIGHT);
        let densityO = max(0.0, 1.0 - abs(height - OZONE_CENTER_ALTITUDE) / OZONE_WIDTH);
        
        opticalDepthR += densityR * dt;
        opticalDepthM += densityM * dt;
        opticalDepthO += densityO * dt;
        
        tCurrent += dt;
    }
    
    let transmittance = exp(
        -(params.rayleigh.xyz * opticalDepthR + 
          params.mieExt.xyz * opticalDepthM + 
          params.absorption.xyz * opticalDepthO)
    );
    
    textureStore(transmittanceTexture, global_id.xy, vec4<f32>(transmittance, 1.0));
}
`;
