export const skyVertexGLSL = `
precision highp float;
attribute vec3 position;
uniform mat4 worldViewProjection;
uniform vec3 cameraPosition;
uniform vec3 sunPosition;
uniform vec3 rayleighCoeff;
uniform vec3 mieCoeff;

varying vec3 vPosition;
varying vec3 vTotalR;
varying vec3 vTotalM;

const float PLANET_RADIUS = 6371000.0;
const float ATMOSPHERE_RADIUS = 6471000.0;
const float RAYLEIGH_SCALE_HEIGHT = 8000.0;
const float MIE_SCALE_HEIGHT = 1200.0;

vec2 raySphereIntersect(vec3 r0, vec3 rd, float sr) {
    float a = dot(rd, rd);
    float b = 2.0 * dot(rd, r0);
    float c = dot(r0, r0) - (sr * sr);
    float d = (b * b) - 4.0 * a * c;
    if (d < 0.0) return vec2(1e5, -1e5);
    return vec2(
        (-b - sqrt(d)) / (2.0 * a),
        (-b + sqrt(d)) / (2.0 * a)
    );
}

void main() {
    gl_Position = worldViewProjection * vec4(position, 1.0);
    vPosition = position;

    vec3 rayOrigin = vec3(0.0, PLANET_RADIUS + 100.0, 0.0);
    vec3 rayDir = normalize(position);
    vec3 sunDir = normalize(sunPosition);

    vec2 atmoIntersection = raySphereIntersect(rayOrigin, rayDir, ATMOSPHERE_RADIUS);
    if (atmoIntersection.x > atmoIntersection.y) {
        vTotalR = vec3(0.0);
        vTotalM = vec3(0.0);
        return;
    }

    float tMin = max(0.0, atmoIntersection.x);
    float tMax = atmoIntersection.y;
    vec2 planetIntersection = raySphereIntersect(rayOrigin, rayDir, PLANET_RADIUS);
    float tEnd = tMax;
    if (planetIntersection.x > 0.0) {
        tEnd = min(tMax, planetIntersection.x);
    }

    int numSamples = 32;
    int numSamplesLight = 8;
    float segmentLength = (tEnd - tMin) / float(numSamples);
    
    float opticalDepthR = 0.0;
    float opticalDepthM = 0.0;
    vec3 totalR = vec3(0.0);
    vec3 totalM = vec3(0.0);

    float tCurrent = tMin + segmentLength * 0.5;

    for (int i = 0; i < 32; i++) {
        vec3 samplePos = rayOrigin + rayDir * tCurrent;
        float height = length(samplePos) - PLANET_RADIUS;

        float hr = exp(-height / RAYLEIGH_SCALE_HEIGHT) * segmentLength;
        float hm = exp(-height / MIE_SCALE_HEIGHT) * segmentLength;

        opticalDepthR += hr;
        opticalDepthM += hm;

        vec2 lightIntersection = raySphereIntersect(samplePos, sunDir, ATMOSPHERE_RADIUS);
        float lightSegmentLength = lightIntersection.y / float(numSamplesLight);
        float opticalDepthLightR = 0.0;
        float opticalDepthLightM = 0.0;
        float tCurrentLight = lightSegmentLength * 0.5;
        
        float sampleRadius = length(samplePos);
        vec3 upDir = samplePos / sampleRadius;
        float cosAlpha = dot(sunDir, -upDir);
        float alpha = acos(clamp(cosAlpha, -1.0, 1.0));
        float theta_horizon = asin(clamp(PLANET_RADIUS / sampleRadius, 0.0, 1.0));
        
        float theta_sun = 0.02; // Softness of the Earth's shadow
        float shadow = smoothstep(theta_horizon - theta_sun, theta_horizon + theta_sun, alpha);

        if (shadow > 0.0) {
            for (int j = 0; j < 8; j++) {
                vec3 lightSamplePos = samplePos + sunDir * tCurrentLight;
                float lightHeight = length(lightSamplePos) - PLANET_RADIUS;
                if (lightHeight < 0.0) break;
                opticalDepthLightR += exp(-lightHeight / RAYLEIGH_SCALE_HEIGHT) * lightSegmentLength;
                opticalDepthLightM += exp(-lightHeight / MIE_SCALE_HEIGHT) * lightSegmentLength;
                tCurrentLight += lightSegmentLength;
            }

            vec3 tau = rayleighCoeff * (opticalDepthR + opticalDepthLightR) + mieCoeff * 1.1 * (opticalDepthM + opticalDepthLightM);
            vec3 attenuation = exp(-tau) * shadow;

            totalR += hr * attenuation;
            totalM += hm * attenuation;
        }

        tCurrent += segmentLength;
    }

    vTotalR = totalR;
    vTotalM = totalM;
}
`;

export const skyFragmentGLSL = `
precision highp float;
varying vec3 vPosition;
varying vec3 vTotalR;
varying vec3 vTotalM;

uniform vec3 sunPosition;
uniform vec3 rayleighCoeff;
uniform vec3 mieCoeff;
uniform float haziness;
uniform float sunIntensity;
uniform float cameraExposure;
uniform float isVerification;

float phaseRayleigh(float cosTheta) {
    return 3.0 / (16.0 * 3.14159265) * (1.0 + cosTheta * cosTheta);
}

float phaseMie(float cosTheta, float g) {
    float g2 = g * g;
    float num = 3.0 * (1.0 - g2) * (1.0 + cosTheta * cosTheta);
    float den = 8.0 * 3.14159265 * (2.0 + g2) * pow(1.0 + g2 - 2.0 * g * cosTheta, 1.5);
    return num / den;
}

float interleavedGradientNoise(vec2 n) {
    return fract(52.9829189 * fract(dot(n, vec2(0.06711056, 0.00583715))));
}

void main() {
    if (isVerification > 0.5) {
        gl_FragColor = vec4(1.0, 0.0, 1.0, 1.0);
        return;
    }

    vec3 rayDir = normalize(vPosition);
    vec3 sunDir = normalize(sunPosition);
    float mu = dot(rayDir, sunDir);

    float phaseR = phaseRayleigh(mu);
    float phaseM = phaseMie(mu, 0.76);

    vec3 color = (vTotalR * rayleighCoeff * phaseR + vTotalM * mieCoeff * phaseM) * sunIntensity;
    
    // Tone mapping (Exposure)
    vec3 mappedColor = vec3(1.0) - exp(-color * cameraExposure);

    // Screen-space dithering to eliminate 8-bit color banding
    float ditherNoise = interleavedGradientNoise(gl_FragCoord.xy);
    mappedColor += (ditherNoise - 0.5) / 255.0;

    gl_FragColor = vec4(mappedColor, 1.0);
}
`;
