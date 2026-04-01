import { Scene, Vector3, Vector2, MeshBuilder, WebGPUEngine } from '@babylonjs/core';
import { AlienSkyWebGPUBackend } from './AlienSkyWebGPUBackend';
import { AlienSkyWebGLBackend } from './AlienSkyWebGLBackend';

export type AlienSkyV2Mode = 'webgpu' | 'webgl';

export class AlienSkyV2 {
    private _scene: Scene;
    private _mode: AlienSkyV2Mode;
    private _backend: AlienSkyWebGPUBackend | AlienSkyWebGLBackend;
    private _skySphere: any;

    // Parameters
    private _sunPosition: Vector3 = new Vector3(0, 1, 0);
    public rayleighScattering: Vector3 = new Vector3(5.8e-6, 13.5e-6, 33.1e-6);
    public mieScattering: Vector3 = new Vector3(3.9e-6, 3.9e-6, 3.9e-6);
    public planetRadius: number = 6371000.0;
    public atmosphereRadius: number = 6471000.0;

    // Legacy compat properties (for the UI)
    public azimuth: number = 0;
    public elevation: number = 0;
    public haziness: number = 0.2;
    public rayleighColorControl: Vector2 = new Vector2(0.5, 0.5);
    public mieColorControl: Vector2 = new Vector2(0.5, 0.5);
    public sunIntensity: number = 20.0;
    public cameraExposure: number = 1.0;
    public useCache: boolean = false;
    public cubemapVerification: boolean = false;

    // New V2 Properties
    public sunColor: Vector3 = new Vector3(1.0, 1.0, 1.0);
    public sunEmittance: number = 1.0;
    public magneticInteraction: number = 0.0;
    public effectIntensity: number = 0.5;

    constructor(scene: Scene, mode: AlienSkyV2Mode) {
        this._scene = scene;
        this._mode = mode;

        if (mode === 'webgpu' && scene.getEngine() instanceof WebGPUEngine) {
            this._backend = new AlienSkyWebGPUBackend(scene, this);
        } else {
            this._backend = new AlienSkyWebGLBackend(scene, this);
        }

        this._skySphere = MeshBuilder.CreateSphere("skySphereV2", { diameter: 10000, segments: 32 }, scene);
        this._skySphere.material = this._backend.getSkyMaterial();
        this._skySphere.infiniteDistance = true;
        this._skySphere.alwaysSelectAsActiveMesh = true;
        this._skySphere.applyFog = false;
    }

    get sunPosition(): Vector3 {
        return this._sunPosition;
    }

    set sunPosition(value: Vector3) {
        this._sunPosition = value;
    }

    public updateCache() {
        // No-op for V2 right now
    }

    public dispose() {
        this._skySphere.dispose();
        this._backend.dispose();
    }
}
