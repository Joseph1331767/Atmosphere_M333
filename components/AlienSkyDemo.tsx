'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Engine, Scene, Vector3, Vector2, Color4, ArcRotateCamera, WebGPUEngine } from '@babylonjs/core';
import { AlienSky } from '@/lib/AlienSky';
import { AlienSkyV2 } from '@/lib/AlienSkyV2';

type SkyMode = 'legacy' | 'v2-webgpu' | 'v2-webgl';

export default function AlienSkyDemo() {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [alienSky, setAlienSky] = useState<AlienSky | AlienSkyV2 | null>(null);
    const [skyMode, setSkyMode] = useState<SkyMode>('legacy');
    const [inputMode, setInputMode] = useState<'angles' | 'vector'>('angles');
    const [azimuth, setAzimuth] = useState(0);
    const [elevation, setElevation] = useState(Math.PI / 4);
    const [sunX, setSunX] = useState(0);
    const [sunY, setSunY] = useState(0.707);
    const [sunZ, setSunZ] = useState(0.707);
    const [haziness, setHaziness] = useState(0.2);
    const [rayleighColorX, setRayleighColorX] = useState(0.5);
    const [rayleighColorY, setRayleighColorY] = useState(0.5);
    const [mieColorX, setMieColorX] = useState(0.5);
    const [mieColorY, setMieColorY] = useState(0.5);
    const [sunIntensity, setSunIntensity] = useState(20.0);
    const [cameraExposure, setCameraExposure] = useState(1.0);
    const [sunColorR, setSunColorR] = useState(1.0);
    const [sunColorG, setSunColorG] = useState(1.0);
    const [sunColorB, setSunColorB] = useState(1.0);
    const [sunEmittance, setSunEmittance] = useState(1.0);
    const [magneticInteraction, setMagneticInteraction] = useState(0.0);
    const [effectIntensity, setEffectIntensity] = useState(0.5);
    const [engineType, setEngineType] = useState<string>('Initializing...');
    const [useCache, setUseCache] = useState(false);
    const [cubemapVerification, setCubemapVerification] = useState(false);
    const [fps, setFps] = useState(0);

    const engineRef = useRef<Engine | WebGPUEngine | null>(null);
    const sceneRef = useRef<Scene | null>(null);

    useEffect(() => {
        if (!canvasRef.current) return;

        let engine: Engine | WebGPUEngine;
        let scene: Scene;

        const initEngine = async () => {
            try {
                // Try WebGPU first
                if (navigator.gpu) {
                    const webgpuEngine = new WebGPUEngine(canvasRef.current!);
                    await webgpuEngine.initAsync();
                    engine = webgpuEngine;
                    setEngineType('WebGPU (WGSL)');
                } else {
                    throw new Error("WebGPU not supported");
                }
            } catch (e) {
                console.warn("Falling back to WebGL", e);
                engine = new Engine(canvasRef.current!, true);
                setEngineType('WebGL (GLSL)');
            }

            engineRef.current = engine;
            scene = new Scene(engine);
            sceneRef.current = scene;
            scene.clearColor = new Color4(0, 0, 0, 1);

            const camera = new ArcRotateCamera("camera", Math.PI / 2, Math.PI / 2, 10, Vector3.Zero(), scene);
            camera.attachControl(canvasRef.current, true);
            camera.minZ = 0.1;
            camera.maxZ = 20000;

            engine.runRenderLoop(() => {
                scene.render();
                setFps(Math.round(engine.getFps()));
            });

            window.addEventListener('resize', () => {
                engine.resize();
            });

            // Initialize the first sky
            initSky(skyMode);
        };

        initEngine();

        return () => {
            if (engineRef.current) {
                engineRef.current.dispose();
            }
        };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const initSky = (mode: SkyMode) => {
        if (!sceneRef.current || !engineRef.current) return;
        
        if (alienSky) {
            alienSky.dispose();
        }

        let sky: AlienSky | AlienSkyV2;
        const isWebGPU = engineRef.current instanceof WebGPUEngine;

        if (mode === 'legacy') {
            sky = new AlienSky(sceneRef.current, isWebGPU);
        } else if (mode === 'v2-webgpu') {
            sky = new AlienSkyV2(sceneRef.current, 'webgpu');
        } else {
            sky = new AlienSkyV2(sceneRef.current, 'webgl');
        }

        setAlienSky(sky);

        // Apply current values
        sky.azimuth = azimuth;
        sky.elevation = elevation;
        sky.haziness = haziness;
        sky.rayleighColorControl = new Vector2(rayleighColorX, rayleighColorY);
        sky.mieColorControl = new Vector2(mieColorX, mieColorY);
        sky.sunIntensity = sunIntensity;
        sky.cameraExposure = cameraExposure;
        if (sky instanceof AlienSky) {
            sky.useCache = useCache;
            sky.cubemapVerification = cubemapVerification;
        }
    };

    // Handle mode switch
    useEffect(() => {
        if (sceneRef.current) {
            initSky(skyMode);
        }
    }, [skyMode]); // eslint-disable-line react-hooks/exhaustive-deps

    const handleAngleChange = (az: number, el: number) => {
        setAzimuth(az);
        setElevation(el);
        if (alienSky) {
            alienSky.azimuth = az;
            alienSky.elevation = el;
            
            // For V2, we need to update sunPosition directly if it doesn't have the angle setters fully implemented yet
            if (alienSky instanceof AlienSkyV2) {
                const x = Math.cos(el) * Math.sin(az);
                const y = Math.sin(el);
                const z = Math.cos(el) * Math.cos(az);
                alienSky.sunPosition = new Vector3(x, y, z);
            }
            
            setSunX(alienSky.sunPosition.x);
            setSunY(alienSky.sunPosition.y);
            setSunZ(alienSky.sunPosition.z);
        }
    };

    const handleVectorChange = (x: number, y: number, z: number) => {
        setSunX(x);
        setSunY(y);
        setSunZ(z);
        if (alienSky) {
            alienSky.sunPosition = new Vector3(x, y, z);
            setAzimuth(alienSky.azimuth);
            setElevation(alienSky.elevation);
        }
    };

    // Update sky when state changes
    useEffect(() => {
        if (alienSky) {
            alienSky.haziness = haziness;
        }
    }, [haziness, alienSky]);

    useEffect(() => {
        if (alienSky) {
            alienSky.rayleighColorControl = new Vector2(rayleighColorX, rayleighColorY);
        }
    }, [rayleighColorX, rayleighColorY, alienSky]);

    useEffect(() => {
        if (alienSky) {
            alienSky.mieColorControl = new Vector2(mieColorX, mieColorY);
        }
    }, [mieColorX, mieColorY, alienSky]);

    useEffect(() => {
        if (alienSky) {
            alienSky.sunIntensity = sunIntensity;
        }
    }, [sunIntensity, alienSky]);

    useEffect(() => {
        if (alienSky) {
            alienSky.cameraExposure = cameraExposure;
        }
    }, [cameraExposure, alienSky]);

    useEffect(() => {
        if (alienSky && alienSky instanceof AlienSkyV2) {
            alienSky.sunColor = new Vector3(sunColorR, sunColorG, sunColorB);
            alienSky.sunEmittance = sunEmittance;
            alienSky.magneticInteraction = magneticInteraction;
            alienSky.effectIntensity = effectIntensity;
        }
    }, [sunColorR, sunColorG, sunColorB, sunEmittance, magneticInteraction, effectIntensity, alienSky]);

    useEffect(() => {
        if (alienSky && alienSky instanceof AlienSky) {
            alienSky.useCache = useCache;
        }
    }, [useCache, alienSky]);

    useEffect(() => {
        if (alienSky && alienSky instanceof AlienSky) {
            alienSky.cubemapVerification = cubemapVerification;
        }
    }, [cubemapVerification, alienSky]);

    const handleUpdateCache = () => {
        if (alienSky) {
            alienSky.updateCache();
        }
    };

    return (
        <div className="relative w-full h-screen overflow-hidden bg-black">
            <canvas ref={canvasRef} className="w-full h-full outline-none" />
            
            <div className="absolute top-4 left-4 bg-black/80 text-white p-6 rounded-xl border border-white/10 backdrop-blur-md w-80 shadow-2xl max-h-[95vh] overflow-y-auto">
                <div className="flex justify-between items-start mb-1">
                    <h1 className="text-xl font-bold">Alien Sky Research</h1>
                    <div className="text-right">
                        <div className="text-2xl font-mono font-bold text-green-400">{fps}</div>
                        <div className="text-[10px] text-gray-500 uppercase tracking-wider">FPS</div>
                    </div>
                </div>
                <p className="text-xs text-gray-400 mb-6 font-mono">Engine: {engineType}</p>
                
                {/* Mode Switcher */}
                <div className="mb-6 bg-gray-800/50 p-3 rounded-lg border border-gray-700">
                    <label className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-2 block">Architecture Mode</label>
                    <select 
                        value={skyMode}
                        onChange={(e) => setSkyMode(e.target.value as SkyMode)}
                        className="w-full bg-gray-900 border border-gray-600 rounded p-2 text-sm text-white focus:outline-none focus:border-blue-500"
                    >
                        <option value="legacy">Legacy (Single Scattering)</option>
                        <option value="v2-webgpu">V2 WebGPU (Compute Shaders)</option>
                        <option value="v2-webgl">V2 WebGL (RTT Fallback)</option>
                    </select>
                </div>

                <div className="space-y-6">
                    {/* Cache Toggle (Only for Legacy) */}
                    {skyMode === 'legacy' && (
                        <div className="bg-gray-800/50 p-3 rounded-lg border border-gray-700">
                            <div className="flex items-center justify-between mb-2">
                                <label className="text-sm font-medium text-gray-200">Cubemap Cache</label>
                                <button 
                                    onClick={() => setUseCache(!useCache)}
                                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${useCache ? 'bg-blue-500' : 'bg-gray-600'}`}
                                >
                                    <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${useCache ? 'translate-x-5' : 'translate-x-1'}`} />
                                </button>
                            </div>
                            <div className="flex justify-between items-center">
                                <span className="text-[10px] text-gray-400">
                                    {useCache ? 'Cache Active (Zero Math)' : 'Real-time Vertex Math'}
                                </span>
                                <button 
                                    onClick={handleUpdateCache}
                                    disabled={!useCache}
                                    className={`text-[10px] px-2 py-1 rounded ${useCache ? 'bg-blue-600 hover:bg-blue-500 text-white' : 'bg-gray-700 text-gray-500 cursor-not-allowed'}`}
                                >
                                    Force Update
                                </button>
                            </div>
                            <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-700">
                                <label className="text-xs font-medium text-gray-400">Inject Debug Artifact</label>
                                <button 
                                    onClick={() => setCubemapVerification(!cubemapVerification)}
                                    className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors focus:outline-none ${cubemapVerification ? 'bg-purple-500' : 'bg-gray-600'}`}
                                >
                                    <span className={`inline-block h-2 w-2 transform rounded-full bg-white transition-transform ${cubemapVerification ? 'translate-x-3' : 'translate-x-1'}`} />
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Input Mode Toggle */}
                    <div className="flex space-x-2 mb-4">
                        <button 
                            className={`flex-1 py-1.5 text-xs font-medium rounded transition-colors ${inputMode === 'angles' ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}
                            onClick={() => setInputMode('angles')}
                        >
                            Bi-Angle
                        </button>
                        <button 
                            className={`flex-1 py-1.5 text-xs font-medium rounded transition-colors ${inputMode === 'vector' ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}
                            onClick={() => setInputMode('vector')}
                        >
                            Vector
                        </button>
                    </div>

                    {inputMode === 'angles' ? (
                        <>
                            <div>
                                <div className="flex justify-between mb-2">
                                    <label className="text-sm font-medium text-gray-300">Sun Azimuth</label>
                                    <span className="text-xs text-gray-500 font-mono">{(azimuth * 180 / Math.PI).toFixed(1)}°</span>
                                </div>
                                <input 
                                    type="range" min="0" max={Math.PI * 2} step="0.01" 
                                    value={azimuth} onChange={(e) => handleAngleChange(parseFloat(e.target.value), elevation)}
                                    className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-orange-500"
                                />
                            </div>
                            <div>
                                <div className="flex justify-between mb-2">
                                    <label className="text-sm font-medium text-gray-300">Sun Elevation</label>
                                    <span className="text-xs text-gray-500 font-mono">{(elevation * 180 / Math.PI).toFixed(1)}°</span>
                                </div>
                                <input 
                                    type="range" min="0" max={Math.PI * 2} step="0.01" 
                                    value={elevation} onChange={(e) => handleAngleChange(azimuth, parseFloat(e.target.value))}
                                    className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-orange-500"
                                />
                            </div>
                        </>
                    ) : (
                        <>
                            <div>
                                <div className="flex justify-between mb-2">
                                    <label className="text-sm font-medium text-gray-300">Sun Dir X</label>
                                    <span className="text-xs text-gray-500 font-mono">{sunX.toFixed(2)}</span>
                                </div>
                                <input 
                                    type="range" min="-1" max="1" step="0.01" 
                                    value={sunX} onChange={(e) => handleVectorChange(parseFloat(e.target.value), sunY, sunZ)}
                                    className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-green-500"
                                />
                            </div>
                            <div>
                                <div className="flex justify-between mb-2">
                                    <label className="text-sm font-medium text-gray-300">Sun Dir Y (Up)</label>
                                    <span className="text-xs text-gray-500 font-mono">{sunY.toFixed(2)}</span>
                                </div>
                                <input 
                                    type="range" min="-1" max="1" step="0.01" 
                                    value={sunY} onChange={(e) => handleVectorChange(sunX, parseFloat(e.target.value), sunZ)}
                                    className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-green-500"
                                />
                            </div>
                            <div>
                                <div className="flex justify-between mb-2">
                                    <label className="text-sm font-medium text-gray-300">Sun Dir Z</label>
                                    <span className="text-xs text-gray-500 font-mono">{sunZ.toFixed(2)}</span>
                                </div>
                                <input 
                                    type="range" min="-1" max="1" step="0.01" 
                                    value={sunZ} onChange={(e) => handleVectorChange(sunX, sunY, parseFloat(e.target.value))}
                                    className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-green-500"
                                />
                            </div>
                        </>
                    )}

                    <div>
                        <div className="flex justify-between mb-2">
                            <label className="text-sm font-medium text-gray-300">Haziness (Mie)</label>
                            <span className="text-xs text-gray-500 font-mono">{haziness.toFixed(2)}</span>
                        </div>
                        <input 
                            type="range" min="0" max="1" step="0.01" 
                            value={haziness} onChange={(e) => setHaziness(parseFloat(e.target.value))}
                            className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-gray-400"
                        />
                    </div>

                    {/* High Particle Atmospheric Effects Group */}
                    <div className="bg-blue-900/20 p-4 rounded-lg border border-blue-500/30 space-y-4">
                        <label className="text-[10px] font-bold text-blue-400 uppercase tracking-widest block mb-2">Atmospheric Particle Effects</label>
                        
                        <div>
                            <div className="flex justify-between mb-2">
                                <label className="text-sm font-medium text-gray-300">Sun Color (RGB)</label>
                            </div>
                            <div className="flex space-x-2">
                                <input type="range" min="0" max="1" step="0.01" value={sunColorR} onChange={(e) => setSunColorR(parseFloat(e.target.value))} className="w-1/3 h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-red-500" />
                                <input type="range" min="0" max="1" step="0.01" value={sunColorG} onChange={(e) => setSunColorG(parseFloat(e.target.value))} className="w-1/3 h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-green-500" />
                                <input type="range" min="0" max="1" step="0.01" value={sunColorB} onChange={(e) => setSunColorB(parseFloat(e.target.value))} className="w-1/3 h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500" />
                            </div>
                        </div>

                        <div>
                            <div className="flex justify-between mb-2">
                                <label className="text-sm font-medium text-gray-300">Particle Emittance</label>
                                <span className="text-xs text-gray-500 font-mono">{sunEmittance.toFixed(2)}</span>
                            </div>
                            <input type="range" min="0" max="5" step="0.1" value={sunEmittance} onChange={(e) => setSunEmittance(parseFloat(e.target.value))} className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-orange-400" />
                        </div>

                        <div>
                            <div className="flex justify-between mb-2">
                                <label className="text-sm font-medium text-gray-300">Magnetic Interaction</label>
                                <span className="text-xs text-gray-500 font-mono">{magneticInteraction.toFixed(2)}</span>
                            </div>
                            <input type="range" min="0" max="2" step="0.01" value={magneticInteraction} onChange={(e) => setMagneticInteraction(parseFloat(e.target.value))} className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-teal-500" />
                        </div>

                        <div>
                            <div className="flex justify-between mb-2">
                                <label className="text-sm font-medium text-gray-300">Effect Intensity</label>
                                <span className="text-xs text-gray-500 font-mono">{effectIntensity.toFixed(2)}</span>
                            </div>
                            <input type="range" min="0" max="2" step="0.01" value={effectIntensity} onChange={(e) => setEffectIntensity(parseFloat(e.target.value))} className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-purple-400" />
                        </div>
                    </div>

                    <div>
                        <div className="flex justify-between mb-2">
                            <label className="text-sm font-medium text-gray-300">Rayleigh Hue</label>
                            <span className="text-xs text-gray-500 font-mono">{rayleighColorX.toFixed(2)}</span>
                        </div>
                        <input 
                            type="range" min="0" max="1" step="0.01" 
                            value={rayleighColorX} onChange={(e) => setRayleighColorX(parseFloat(e.target.value))}
                            className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-purple-500"
                        />
                    </div>

                    <div>
                        <div className="flex justify-between mb-2">
                            <label className="text-sm font-medium text-gray-300">Rayleigh Intensity</label>
                            <span className="text-xs text-gray-500 font-mono">{rayleighColorY.toFixed(2)}</span>
                        </div>
                        <input 
                            type="range" min="0" max="1" step="0.01" 
                            value={rayleighColorY} onChange={(e) => setRayleighColorY(parseFloat(e.target.value))}
                            className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-pink-500"
                        />
                    </div>

                    <div>
                        <div className="flex justify-between mb-2">
                            <label className="text-sm font-medium text-gray-300">Mie Hue</label>
                            <span className="text-xs text-gray-500 font-mono">{mieColorX.toFixed(2)}</span>
                        </div>
                        <input 
                            type="range" min="0" max="1" step="0.01" 
                            value={mieColorX} onChange={(e) => setMieColorX(parseFloat(e.target.value))}
                            className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
                        />
                    </div>

                    <div>
                        <div className="flex justify-between mb-2">
                            <label className="text-sm font-medium text-gray-300">Mie Intensity</label>
                            <span className="text-xs text-gray-500 font-mono">{mieColorY.toFixed(2)}</span>
                        </div>
                        <input 
                            type="range" min="0" max="1" step="0.01" 
                            value={mieColorY} onChange={(e) => setMieColorY(parseFloat(e.target.value))}
                            className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-cyan-500"
                        />
                    </div>

                    <div>
                        <div className="flex justify-between mb-2">
                            <label className="text-sm font-medium text-gray-300">Sun Intensity</label>
                            <span className="text-xs text-gray-500 font-mono">{sunIntensity.toFixed(1)}</span>
                        </div>
                        <input 
                            type="range" min="0" max="100" step="0.1" 
                            value={sunIntensity} onChange={(e) => setSunIntensity(parseFloat(e.target.value))}
                            className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-yellow-500"
                        />
                    </div>

                    <div>
                        <div className="flex justify-between mb-2">
                            <label className="text-sm font-medium text-gray-300">Camera Exposure</label>
                            <span className="text-xs text-gray-500 font-mono">{cameraExposure.toFixed(2)}</span>
                        </div>
                        <input 
                            type="range" min="0.1" max="5" step="0.01" 
                            value={cameraExposure} onChange={(e) => setCameraExposure(parseFloat(e.target.value))}
                            className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-white"
                        />
                    </div>
                </div>
                
                <div className="mt-8 pt-4 border-t border-white/10">
                    <p className="text-[10px] text-gray-500 leading-relaxed">
                        Drag on the canvas to look around. The sky uses a single-scattering atmospheric model (Nishita) implemented in WGSL/GLSL.
                    </p>
                </div>
            </div>
        </div>
    );
}
