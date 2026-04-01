export const skyVertexWGSL = `
attribute position: vec3<f32>;
varying vPosition: vec3<f32>;
varying vClipPos: vec4<f32>;
varying vTotalR: vec3<f32>;
varying vTotalM: vec3<f32>;

uniform worldViewProjection: mat4x4<f32>;
uniform cameraPosition: vec3<f32>;
uniform sunPosition: vec3<f32>;
uniform rayleighCoeff: vec3<f32>;
uniform mieCoeff: vec3<f32>;
uniform haziness: f32;
uniform sunIntensity: f32;
uniform cameraExposure: f32;

const PLANET_RADIUS: f32 = 6371000.0;
const ATMOSPHERE_RADIUS: f32 = 6471000.0;
const RAYLEIGH_SCALE_HEIGHT: f32 = 8000.0;
const MIE_SCALE_HEIGHT: f32 = 1200.0;

fn raySphereIntersect(r0: vec3<f32>, rd: vec3<f32>, sr: f32) -> vec2<f32> {
    let a = dot(rd, rd);
    let b = 2.0 * dot(rd, r0);
    let c = dot(r0, r0) - (sr * sr);
    let d = (b * b) - 4.0 * a * c;
    if (d < 0.0) {
        return vec2<f32>(1e5, -1e5);
    }
    return vec2<f32>(
        (-b - sqrt(d)) / (2.0 * a),
        (-b + sqrt(d)) / (2.0 * a)
    );
}

@vertex
fn main(input: VertexInputs) -> FragmentInputs {
    vertexOutputs.position = uniforms.worldViewProjection * vec4<f32>(input.position, 1.0);
    vertexOutputs.vPosition = input.position;
    vertexOutputs.vClipPos = vertexOutputs.position;

    let rayOrigin = vec3<f32>(0.0, PLANET_RADIUS + 100.0, 0.0);
    let rayDir = normalize(input.position);
    let sunDir = normalize(uniforms.sunPosition);

    let atmoIntersection = raySphereIntersect(rayOrigin, rayDir, ATMOSPHERE_RADIUS);
    if (atmoIntersection.x > atmoIntersection.y) {
        vertexOutputs.vTotalR = vec3<f32>(0.0);
        vertexOutputs.vTotalM = vec3<f32>(0.0);
        return vertexOutputs;
    }

    let tMin = max(0.0, atmoIntersection.x);
    let tMax = atmoIntersection.y;
    let planetIntersection = raySphereIntersect(rayOrigin, rayDir, PLANET_RADIUS);
    var tEnd = tMax;
    if (planetIntersection.x > 0.0) {
        tEnd = min(tMax, planetIntersection.x);
    }

    let numSamples = 32u;
    let numSamplesLight = 8u;
    let segmentLength = (tEnd - tMin) / f32(numSamples);
    
    var opticalDepthR = 0.0;
    var opticalDepthM = 0.0;
    var totalR = vec3<f32>(0.0);
    var totalM = vec3<f32>(0.0);

    var tCurrent = tMin + segmentLength * 0.5;

    for (var i = 0u; i < numSamples; i = i + 1u) {
        let samplePos = rayOrigin + rayDir * tCurrent;
        let height = length(samplePos) - PLANET_RADIUS;

        let hr = exp(-height / RAYLEIGH_SCALE_HEIGHT) * segmentLength;
        let hm = exp(-height / MIE_SCALE_HEIGHT) * segmentLength;

        opticalDepthR = opticalDepthR + hr;
        opticalDepthM = opticalDepthM + hm;

        let lightIntersection = raySphereIntersect(samplePos, sunDir, ATMOSPHERE_RADIUS);
        let lightSegmentLength = lightIntersection.y / f32(numSamplesLight);
        var opticalDepthLightR = 0.0;
        var opticalDepthLightM = 0.0;
        var tCurrentLight = lightSegmentLength * 0.5;
        
        let sampleRadius = length(samplePos);
        let upDir = samplePos / sampleRadius;
        let cosAlpha = dot(sunDir, -upDir);
        let alpha = acos(clamp(cosAlpha, -1.0, 1.0));
        let theta_horizon = asin(clamp(PLANET_RADIUS / sampleRadius, 0.0, 1.0));
        
        let theta_sun = 0.02; // Softness of the Earth's shadow
        let shadow = smoothstep(theta_horizon - theta_sun, theta_horizon + theta_sun, alpha);

        if (shadow > 0.0) {
            for (var j = 0u; j < numSamplesLight; j = j + 1u) {
                let lightSamplePos = samplePos + sunDir * tCurrentLight;
                let lightHeight = length(lightSamplePos) - PLANET_RADIUS;
                if (lightHeight < 0.0) {
                    break;
                }
                opticalDepthLightR = opticalDepthLightR + exp(-lightHeight / RAYLEIGH_SCALE_HEIGHT) * lightSegmentLength;
                opticalDepthLightM = opticalDepthLightM + exp(-lightHeight / MIE_SCALE_HEIGHT) * lightSegmentLength;
                tCurrentLight = tCurrentLight + lightSegmentLength;
            }

            let tau = uniforms.rayleighCoeff * (opticalDepthR + opticalDepthLightR) + uniforms.mieCoeff * 1.1 * (opticalDepthM + opticalDepthLightM);
            let attenuation = exp(-tau) * shadow;

            totalR = totalR + hr * attenuation;
            totalM = totalM + hm * attenuation;
        }

        tCurrent = tCurrent + segmentLength;
    }

    vertexOutputs.vTotalR = totalR;
    vertexOutputs.vTotalM = totalM;
}
`;

export const skyFragmentWGSL = `
varying vPosition: vec3<f32>;
varying vClipPos: vec4<f32>;
varying vTotalR: vec3<f32>;
varying vTotalM: vec3<f32>;

uniform worldViewProjection: mat4x4<f32>;
uniform cameraPosition: vec3<f32>;
uniform sunPosition: vec3<f32>;
uniform rayleighCoeff: vec3<f32>;
uniform mieCoeff: vec3<f32>;
uniform haziness: f32;
uniform sunIntensity: f32;
uniform cameraExposure: f32;
uniform isVerification: f32;

fn phaseRayleigh(cosTheta: f32) -> f32 {
    return 3.0 / (16.0 * 3.14159265) * (1.0 + cosTheta * cosTheta);
}

fn phaseMie(cosTheta: f32, g: f32) -> f32 {
    let g2 = g * g;
    let num = 3.0 * (1.0 - g2) * (1.0 + cosTheta * cosTheta);
    let den = 8.0 * 3.14159265 * (2.0 + g2) * pow(1.0 + g2 - 2.0 * g * cosTheta, 1.5);
    return num / den;
}

fn interleavedGradientNoise(n: vec2<f32>) -> f32 {
    return fract(52.9829189 * fract(dot(n, vec2<f32>(0.06711056, 0.00583715))));
}

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
    if (uniforms.isVerification > 0.5) {
        fragmentOutputs.color = vec4<f32>(1.0, 0.0, 1.0, 1.0);
        return fragmentOutputs;
    }

    let rayDir = normalize(input.vPosition);
    let sunDir = normalize(uniforms.sunPosition);
    let mu = dot(rayDir, sunDir);

    let phaseR = phaseRayleigh(mu);
    let phaseM = phaseMie(mu, 0.76);

    let color = (input.vTotalR * uniforms.rayleighCoeff * phaseR + input.vTotalM * uniforms.mieCoeff * phaseM) * uniforms.sunIntensity;
    
    // Tone mapping (Exposure)
    let mappedColor = vec3<f32>(1.0) - exp(-color * uniforms.cameraExposure);

    // Screen-space dithering to eliminate 8-bit color banding
    let screenPos = input.vClipPos.xy / input.vClipPos.w;
    let ditherCoord = screenPos * vec2<f32>(1920.0, 1080.0);
    let ditherNoise = interleavedGradientNoise(ditherCoord);
    let ditheredColor = mappedColor + vec3<f32>((ditherNoise - 0.5) / 255.0);

    fragmentOutputs.color = vec4<f32>(ditheredColor, 1.0);
}
`;


