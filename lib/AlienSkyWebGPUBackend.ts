import { Scene, ComputeShader, RawTexture, Constants, ShaderMaterial, UniformBuffer, Vector2, Vector3, Vector4, ShaderLanguage } from '@babylonjs/core';
import { transmittanceComputeWGSL } from './shaders/transmittance.wgsl';
import { skyViewComputeWGSL } from './shaders/skyview.wgsl';
import { multiScatteringComputeWGSL } from './shaders/multiscattering.wgsl';
import { renderFragmentWGSL, renderVertexWGSL } from './shaders/render.wgsl';

export class AlienSkyWebGPUBackend {
    private _scene: Scene;
    private _parent: any;
    private _transmittanceTexture: RawTexture;
    private _multiScatteringTexture: RawTexture;
    private _skyViewTexture: RawTexture;
    private _transmittanceCompute: ComputeShader;
    private _multiScatteringCompute: ComputeShader;
    private _skyViewCompute: ComputeShader;
    private _renderMaterial: ShaderMaterial;
    private _ubo: UniformBuffer;

    constructor(scene: Scene, parent: any) {
        this._scene = scene;
        this._parent = parent;

        // 1. Create Storage Textures
        this._transmittanceTexture = RawTexture.CreateRGBATexture(
            new Uint16Array(512 * 128 * 4),
            512,
            128,
            scene,
            false,
            false,
            Constants.TEXTURE_BILINEAR_SAMPLINGMODE,
            Constants.TEXTURETYPE_HALF_FLOAT,
            Constants.TEXTURE_CREATIONFLAG_STORAGE
        );
        this._transmittanceTexture.name = "transmittanceLUT";
        
        this._multiScatteringTexture = RawTexture.CreateRGBATexture(
            new Uint16Array(64 * 64 * 4),
            64,
            64,
            scene,
            false,
            false,
            Constants.TEXTURE_BILINEAR_SAMPLINGMODE,
            Constants.TEXTURETYPE_HALF_FLOAT,
            Constants.TEXTURE_CREATIONFLAG_STORAGE
        );
        this._multiScatteringTexture.name = "multiScatteringLUT";
        
        this._skyViewTexture = RawTexture.CreateRGBATexture(
            new Uint16Array(1024 * 512 * 4),
            1024,
            512,
            scene,
            false,
            false,
            Constants.TEXTURE_BILINEAR_SAMPLINGMODE,
            Constants.TEXTURETYPE_HALF_FLOAT,
            Constants.TEXTURE_CREATIONFLAG_STORAGE
        );
        this._skyViewTexture.name = "skyViewLUT";

        // 2. Setup Uniform Buffer
        this._ubo = new UniformBuffer(scene.getEngine());
        this._ubo.addUniform("radii", 4);
        this._ubo.addUniform("rayleigh", 4);
        this._ubo.addUniform("mie", 4);
        this._ubo.addUniform("mieExt", 4);
        this._ubo.addUniform("absorption", 4);
        this._ubo.addUniform("sunDir", 4);
        this._ubo.addUniform("cameraPos", 4);
        this._ubo.addUniform("sunColor", 4);
        this._ubo.addUniform("magneticParams", 4);
        
        this._ubo.updateVector4("radii", new Vector4(this._parent.planetRadius, this._parent.atmosphereRadius, 0, 0));
        const shiftX = (this._parent.rayleighColorControl.x - 0.5) * 2.0;
        const intensity = this._parent.rayleighColorControl.y * 2.0;
        const r = Math.max(0.1e-6, this._parent.rayleighScattering.x * (1.0 - shiftX * intensity));
        const g = Math.max(0.1e-6, this._parent.rayleighScattering.y * (1.0 + Math.abs(shiftX) * intensity));
        const b = Math.max(0.1e-6, this._parent.rayleighScattering.z * (1.0 + shiftX * intensity));
        this._ubo.updateVector4("rayleigh", new Vector4(r, g, b, 0));

        const shiftMieX = (this._parent.mieColorControl.x - 0.5) * 2.0;
        const intensityMie = this._parent.mieColorControl.y * 2.0;
        const baseMie = this._parent.mieScattering.x * (1.0 + this._parent.haziness * 10.0);
        const mieR = Math.max(0.1e-6, baseMie * (1.0 - shiftMieX * intensityMie));
        const mieG = Math.max(0.1e-6, baseMie * (1.0 + Math.abs(shiftMieX) * intensityMie));
        const mieB = Math.max(0.1e-6, baseMie * (1.0 + shiftMieX * intensityMie));
        this._ubo.updateVector4("mie", new Vector4(mieR, mieG, mieB, 0));
        
        this._ubo.updateVector4("mieExt", new Vector4(mieR * 1.1, mieG * 1.1, mieB * 1.1, 0));
        this._ubo.updateVector4("absorption", new Vector4(0.65e-6, 1.88e-6, 0.085e-6, 0));
        this._ubo.updateVector4("sunDir", new Vector4(this._parent.sunPosition.x, this._parent.sunPosition.y, this._parent.sunPosition.z, this._parent.sunIntensity));
        this._ubo.updateVector4("cameraPos", new Vector4(0, 0, 0, 0));
        
        const sunColor = this._parent.sunColor || new Vector3(1, 1, 1);
        const sunEmittance = this._parent.sunEmittance !== undefined ? this._parent.sunEmittance : 1.0;
        this._ubo.updateVector4("sunColor", new Vector4(sunColor.x, sunColor.y, sunColor.z, sunEmittance));
        
        const magneticInteraction = this._parent.magneticInteraction || 0.0;
        const effectIntensity = this._parent.effectIntensity !== undefined ? this._parent.effectIntensity : 0.5;
        this._ubo.updateVector4("magneticParams", new Vector4(magneticInteraction, 0.0, effectIntensity, 0.0));
        
        this._ubo.update();

        // 3. Setup Compute Shaders
        this._transmittanceCompute = new ComputeShader("transmittanceCompute", scene.getEngine(), { computeSource: transmittanceComputeWGSL }, {
            bindingsMapping: {
                "transmittanceTexture": { group: 0, binding: 0 },
                "params": { group: 0, binding: 1 }
            }
        });
        this._transmittanceCompute.setStorageTexture("transmittanceTexture", this._transmittanceTexture);
        this._transmittanceCompute.setUniformBuffer("params", this._ubo);

        this._multiScatteringCompute = new ComputeShader("multiScatteringCompute", scene.getEngine(), { computeSource: multiScatteringComputeWGSL }, {
            bindingsMapping: {
                "multiScatteringTexture": { group: 0, binding: 0 },
                "transmittanceTexture": { group: 0, binding: 1 },
                "params": { group: 0, binding: 2 }
            }
        });
        this._multiScatteringCompute.setStorageTexture("multiScatteringTexture", this._multiScatteringTexture);
        this._multiScatteringCompute.setTexture("transmittanceTexture", this._transmittanceTexture, false);
        this._multiScatteringCompute.setUniformBuffer("params", this._ubo);

        this._skyViewCompute = new ComputeShader("skyViewCompute", scene.getEngine(), { computeSource: skyViewComputeWGSL }, {
            bindingsMapping: {
                "skyViewTexture": { group: 0, binding: 0 },
                "transmittanceTexture": { group: 0, binding: 1 },
                "params": { group: 0, binding: 2 },
                "multiScatteringTexture": { group: 0, binding: 3 }
            }
        });
        this._skyViewCompute.setStorageTexture("skyViewTexture", this._skyViewTexture);
        this._skyViewCompute.setTexture("transmittanceTexture", this._transmittanceTexture, false);
        this._skyViewCompute.setTexture("multiScatteringTexture", this._multiScatteringTexture, false);
        this._skyViewCompute.setUniformBuffer("params", this._ubo);

        // 4. Setup Render Material
        this._renderMaterial = new ShaderMaterial("skyRenderMaterialWGSL", scene, {
            vertexSource: renderVertexWGSL,
            fragmentSource: renderFragmentWGSL
        }, {
            attributes: ["position"],
            uniforms: ["worldViewProjection", "cameraPosition", "cameraExposure", "sunDirection", "time", "magneticInteraction", "effectIntensity", "sunEmittance", "sunColor", "radii"],
            shaderLanguage: ShaderLanguage.WGSL
        });
        this._renderMaterial.setTexture("skyViewTexture", this._skyViewTexture);
        this._renderMaterial.setTexture("transmittanceTexture", this._transmittanceTexture);
        this._renderMaterial.backFaceCulling = false;

        // 5. Hook up to render loop
        scene.onBeforeRenderObservable.add(this._onBeforeRender);
    }

    private _frameCount: number = 0;

    private _onBeforeRender = () => {
        this._frameCount++;
        
        // Update Uniforms
        this._ubo.updateVector4("radii", new Vector4(this._parent.planetRadius, this._parent.atmosphereRadius, 0, 0));
        const shiftX = (this._parent.rayleighColorControl.x - 0.5) * 2.0;
        const intensity = this._parent.rayleighColorControl.y * 2.0;
        const r = Math.max(0.1e-6, this._parent.rayleighScattering.x * (1.0 - shiftX * intensity));
        const g = Math.max(0.1e-6, this._parent.rayleighScattering.y * (1.0 + Math.abs(shiftX) * intensity));
        const b = Math.max(0.1e-6, this._parent.rayleighScattering.z * (1.0 + shiftX * intensity));
        this._ubo.updateVector4("rayleigh", new Vector4(r, g, b, 0));

        const shiftMieX = (this._parent.mieColorControl.x - 0.5) * 2.0;
        const intensityMie = this._parent.mieColorControl.y * 2.0;
        const baseMie = this._parent.mieScattering.x * (1.0 + this._parent.haziness * 10.0);
        const mieR = Math.max(0.1e-6, baseMie * (1.0 - shiftMieX * intensityMie));
        const mieG = Math.max(0.1e-6, baseMie * (1.0 + Math.abs(shiftMieX) * intensityMie));
        const mieB = Math.max(0.1e-6, baseMie * (1.0 + shiftMieX * intensityMie));
        this._ubo.updateVector4("mie", new Vector4(mieR, mieG, mieB, 0));
        
        this._ubo.updateVector4("mieExt", new Vector4(mieR * 1.1, mieG * 1.1, mieB * 1.1, 0));
        this._ubo.updateVector4("absorption", new Vector4(0.65e-6, 1.88e-6, 0.085e-6, 0)); // Ozone
        
        this._ubo.updateVector4("sunDir", new Vector4(this._parent.sunPosition.x, this._parent.sunPosition.y, this._parent.sunPosition.z, this._parent.sunIntensity));
        
        let camPos = this._scene.activeCamera ? this._scene.activeCamera.globalPosition : Vector3.Zero();
        this._ubo.updateVector4("cameraPos", new Vector4(camPos.x, camPos.y, camPos.z, 0));
        
        const sunColor = this._parent.sunColor || new Vector3(1, 1, 1);
        const sunEmittance = this._parent.sunEmittance !== undefined ? this._parent.sunEmittance : 1.0;
        this._ubo.updateVector4("sunColor", new Vector4(sunColor.x, sunColor.y, sunColor.z, sunEmittance));
        
        const magneticInteraction = this._parent.magneticInteraction || 0.0;
        const effectIntensity = this._parent.effectIntensity !== undefined ? this._parent.effectIntensity : 0.5;
        const time = performance.now() * 0.001;
        this._ubo.updateVector4("magneticParams", new Vector4(magneticInteraction, time, effectIntensity, 0.0));
        
        this._ubo.update();

        // Dispatch compute
        // Update LUTs every other frame to save performance since we doubled the resolution
        if (this._frameCount === 1 || this._frameCount % 2 === 0) {
            this._transmittanceCompute.dispatch(Math.ceil(512 / 8), Math.ceil(128 / 8), 1);
            this._multiScatteringCompute.dispatch(Math.ceil(64 / 8), Math.ceil(64 / 8), 1);
            this._skyViewCompute.dispatch(Math.ceil(1024 / 8), Math.ceil(512 / 8), 1);
        }

        // Update render uniforms
        this._renderMaterial.setFloat("cameraExposure", this._parent.cameraExposure);
        this._renderMaterial.setVector3("cameraPosition", camPos);
        this._renderMaterial.setVector3("sunDirection", this._parent.sunPosition.normalizeToNew());
        this._renderMaterial.setFloat("time", time);
        this._renderMaterial.setFloat("magneticInteraction", magneticInteraction);
        this._renderMaterial.setFloat("effectIntensity", effectIntensity);
        this._renderMaterial.setFloat("sunEmittance", sunEmittance);
        this._renderMaterial.setVector3("sunColor", sunColor);
        this._renderMaterial.setVector2("radii", new Vector2(this._parent.planetRadius, this._parent.atmosphereRadius));
    };

    public getSkyMaterial() {
        return this._renderMaterial;
    }

    public dispose() {
        this._scene.onBeforeRenderObservable.removeCallback(this._onBeforeRender);
        this._transmittanceTexture.dispose();
        this._multiScatteringTexture.dispose();
        this._skyViewTexture.dispose();
        this._renderMaterial.dispose();
        this._ubo.dispose();
    }
}
