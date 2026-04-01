import { Scene, MeshBuilder, ShaderMaterial, Vector3, Vector2, ShaderLanguage, ReflectionProbe, StandardMaterial, Texture, Color3, Color4, RenderTargetTexture } from '@babylonjs/core';
import { skyVertexGLSL, skyFragmentGLSL } from './shaders/sky.glsl';
import { skyVertexWGSL, skyFragmentWGSL } from './shaders/sky.wgsl';

export class AlienSky {
    private realtimeMaterial: ShaderMaterial;
    private cacheMaterial: StandardMaterial;
    private probe: ReflectionProbe;
    private skySphereRealtime: any;
    private skySphereCache: any;
    private scene: Scene;

    private _useCache: boolean = false;
    private _cubemapVerification: boolean = false;
    private _probeJustRendered: boolean = false;

    // Parameters
    private _timeOfDay: number = 0.5;
    private _haziness: number = 0.5;
    private _sunPosition: Vector3 = new Vector3(0, 1, 0);
    private _azimuth: number = 0;
    private _elevation: number = Math.PI / 2;
    private _rayleighColorControl: Vector2 = new Vector2(0.5, 0.5);
    private _mieColorControl: Vector2 = new Vector2(0.5, 0.5);
    private _sunIntensity: number = 20.0;
    private _cameraExposure: number = 1.0;

    constructor(scene: Scene, isWebGPU: boolean = false) {
        this.scene = scene;
        this.skySphereRealtime = MeshBuilder.CreateSphere("alienSkyRealtime", { diameter: 10000, segments: 128 }, scene);
        this.skySphereCache = MeshBuilder.CreateSphere("alienSkyCache", { diameter: 10000, segments: 128 }, scene);
        
        // Ensure the sky is always rendered behind everything else
        this.skySphereRealtime.applyFog = false;
        this.skySphereRealtime.alwaysSelectAsActiveMesh = true;
        this.skySphereCache.applyFog = false;
        this.skySphereCache.alwaysSelectAsActiveMesh = true;

        if (isWebGPU) {
            this.realtimeMaterial = new ShaderMaterial("skyMaterialWGSL", scene, {
                vertexSource: skyVertexWGSL,
                fragmentSource: skyFragmentWGSL
            }, {
                attributes: ["position"],
                uniforms: ["worldViewProjection", "cameraPosition", "sunPosition", "rayleighCoeff", "mieCoeff", "haziness", "sunIntensity", "cameraExposure", "isVerification"],
                shaderLanguage: ShaderLanguage.WGSL
            });
        } else {
            this.realtimeMaterial = new ShaderMaterial("skyMaterialGLSL", scene, {
                vertexSource: skyVertexGLSL,
                fragmentSource: skyFragmentGLSL
            }, {
                attributes: ["position"],
                uniforms: ["worldViewProjection", "cameraPosition", "sunPosition", "rayleighCoeff", "mieCoeff", "haziness", "sunIntensity", "cameraExposure", "isVerification"]
            });
        }

        this.realtimeMaterial.backFaceCulling = false;

        // --- CUBEMAP CACHE SETUP ---
        this.probe = new ReflectionProbe("skyProbe", 1024, scene, false, false);
        
        if (this.probe.renderList) {
            this.probe.renderList.push(this.skySphereRealtime);
        }
        this.probe.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
        
        this.cacheMaterial = new StandardMaterial("skyCacheMat", scene);
        this.cacheMaterial.backFaceCulling = false;
        this.cacheMaterial.disableLighting = true;
        this.cacheMaterial.emissiveColor = new Color3(0, 0, 0);
        this.cacheMaterial.diffuseColor = new Color3(0, 0, 0);
        this.cacheMaterial.specularColor = new Color3(0, 0, 0);
        
        // Use reflectionTexture with SKYBOX_MODE for a sky sphere
        this.cacheMaterial.reflectionTexture = this.probe.cubeTexture;
        this.cacheMaterial.reflectionTexture.coordinatesMode = Texture.SKYBOX_MODE;

        this.probe.cubeTexture.onAfterRenderObservable.add(() => {
            this._probeJustRendered = true;
        });

        this.skySphereRealtime.material = this.realtimeMaterial;
        this.skySphereCache.material = this.cacheMaterial;
        
        this.skySphereRealtime.isVisible = true;
        this.skySphereCache.isVisible = false;

        this.realtimeMaterial.setFloat("isVerification", 0.0);

        this.updateUniforms();
        
        // Update camera position uniform every frame
        scene.onBeforeRenderObservable.add(() => {
            if (scene.activeCamera) {
                this.realtimeMaterial.setVector3("cameraPosition", scene.activeCamera.position);
                this.skySphereRealtime.position = scene.activeCamera.position;
                this.skySphereCache.position = scene.activeCamera.position;
            }
            
            if (this._probeJustRendered) {
                this._probeJustRendered = false;
                if (this._useCache) {
                    this.skySphereCache.isVisible = true;
                    this.skySphereRealtime.isVisible = false;
                }
            }
        });
    }

    public set useCache(value: boolean) {
        this._useCache = value;
        if (value) {
            this.updateCache();
        } else {
            this.skySphereCache.isVisible = false;
            this.skySphereRealtime.isVisible = true;
            this._probeJustRendered = false; // Cancel any pending swap
            this.realtimeMaterial.setFloat("isVerification", this._cubemapVerification ? 1.0 : 0.0);
        }
    }

    public get useCache(): boolean {
        return this._useCache;
    }

    public set cubemapVerification(value: boolean) {
        this._cubemapVerification = value;
        if (!this._useCache) {
            this.realtimeMaterial.setFloat("isVerification", value ? 1.0 : 0.0);
        }
    }

    public get cubemapVerification(): boolean {
        return this._cubemapVerification;
    }

    public updateCache() {
        if (this.probe && this.probe.cubeTexture) {
            this._probeJustRendered = false; // Cancel any pending swap
            
            // Hide cache sphere to prevent reading from the cubemap while it's being written
            this.skySphereCache.isVisible = false;
            this.skySphereRealtime.isVisible = true;

            this.realtimeMaterial.setFloat("isVerification", this._cubemapVerification ? 1.0 : 0.0);
            
            if (this.scene.activeCamera) {
                this.probe.position = this.scene.activeCamera.position;
            }
            
            this.probe.cubeTexture.resetRefreshCounter();
        }
    }

    public set timeOfDay(value: number) {
        this._timeOfDay = Math.max(0, Math.min(1, value));
        // Calculate sun position based on time of day
        // 0 = midnight, 0.25 = sunrise, 0.5 = noon, 0.75 = sunset, 1 = midnight
        this._elevation = (this._timeOfDay - 0.25) * Math.PI * 2;
        this.updateSunPositionFromAngles();
    }

    public get timeOfDay(): number {
        return this._timeOfDay;
    }

    public set azimuth(value: number) {
        this._azimuth = value;
        this.updateSunPositionFromAngles();
    }

    public get azimuth(): number {
        return this._azimuth;
    }

    public set elevation(value: number) {
        this._elevation = value;
        this.updateSunPositionFromAngles();
    }

    public get elevation(): number {
        return this._elevation;
    }

    private updateSunPositionFromAngles() {
        const x = Math.cos(this._elevation) * Math.sin(this._azimuth);
        const y = Math.sin(this._elevation);
        const z = Math.cos(this._elevation) * Math.cos(this._azimuth);
        this._sunPosition = new Vector3(x, y, z).normalize();
        this.updateUniforms();
    }

    public set haziness(value: number) {
        this._haziness = Math.max(0, Math.min(1, value));
        this.updateUniforms();
    }

    public get haziness(): number {
        return this._haziness;
    }

    public set sunPosition(value: Vector3) {
        this._sunPosition = value.normalizeToNew();
        this._elevation = Math.asin(this._sunPosition.y);
        this._azimuth = Math.atan2(this._sunPosition.x, this._sunPosition.z);
        this.updateUniforms();
    }

    public get sunPosition(): Vector3 {
        return this._sunPosition;
    }

    public set rayleighColorControl(value: Vector2) {
        this._rayleighColorControl = new Vector2(Math.max(0, Math.min(1, value.x)), Math.max(0, Math.min(1, value.y)));
        this.updateUniforms();
    }

    public get rayleighColorControl(): Vector2 {
        return this._rayleighColorControl;
    }

    public set mieColorControl(value: Vector2) {
        this._mieColorControl = new Vector2(Math.max(0, Math.min(1, value.x)), Math.max(0, Math.min(1, value.y)));
        this.updateUniforms();
    }

    public get mieColorControl(): Vector2 {
        return this._mieColorControl;
    }

    public set sunIntensity(value: number) {
        this._sunIntensity = Math.max(0, value);
        this.updateUniforms();
    }

    public get sunIntensity(): number {
        return this._sunIntensity;
    }

    public set cameraExposure(value: number) {
        this._cameraExposure = Math.max(0, value);
        this.updateUniforms();
    }

    public get cameraExposure(): number {
        return this._cameraExposure;
    }

    private updateUniforms() {
        this.realtimeMaterial.setVector3("sunPosition", this._sunPosition);
        
        // Base Earth Rayleigh: vec3(5.5e-6, 13.0e-6, 22.4e-6)
        // We use rayleighColorControl to shift these values.
        
        const baseX = 5.5e-6;
        const baseY = 13.0e-6;
        const baseZ = 22.4e-6;
        
        const shiftX = (this._rayleighColorControl.x - 0.5) * 2.0; // -1 to 1
        const intensity = this._rayleighColorControl.y * 2.0; // 0 to 2
        
        const r = Math.max(0.1e-6, baseX * (1.0 - shiftX * intensity));
        const g = Math.max(0.1e-6, baseY * (1.0 + Math.abs(shiftX) * intensity));
        const b = Math.max(0.1e-6, baseZ * (1.0 + shiftX * intensity));
        
        this.realtimeMaterial.setVector3("rayleighCoeff", new Vector3(r, g, b));
        
        // Base Mie: 21e-6
        // Haziness increases Mie scattering
        const baseMie = 21e-6 * (1.0 + this._haziness * 10.0);
        
        const shiftMieX = (this._mieColorControl.x - 0.5) * 2.0;
        const intensityMie = this._mieColorControl.y * 2.0;
        
        const mieR = Math.max(0.1e-6, baseMie * (1.0 - shiftMieX * intensityMie));
        const mieG = Math.max(0.1e-6, baseMie * (1.0 + Math.abs(shiftMieX) * intensityMie));
        const mieB = Math.max(0.1e-6, baseMie * (1.0 + shiftMieX * intensityMie));

        this.realtimeMaterial.setVector3("mieCoeff", new Vector3(mieR, mieG, mieB));
        
        this.realtimeMaterial.setFloat("haziness", this._haziness);
        this.realtimeMaterial.setFloat("sunIntensity", this._sunIntensity);
        this.realtimeMaterial.setFloat("cameraExposure", this._cameraExposure);
    }
    
    public dispose() {
        this.skySphereRealtime.dispose();
        this.skySphereCache.dispose();
        this.realtimeMaterial.dispose();
        if (this.cacheMaterial) this.cacheMaterial.dispose();
        if (this.probe) this.probe.dispose();
    }
}
