import { Scene, ShaderMaterial, Vector3 } from '@babylonjs/core';

export class AlienSkyWebGLBackend {
    private _scene: Scene;
    private _parent: any;
    private _renderMaterial: ShaderMaterial;

    constructor(scene: Scene, parent: any) {
        this._scene = scene;
        this._parent = parent;

        // For Phase 1 WebGL, we'll just create a dummy material so it doesn't crash
        // We will implement the RTT fallback in Phase 2
        this._renderMaterial = new ShaderMaterial("skyRenderMaterialGL", scene, {
            vertexSource: [
                "precision highp float;",
                "attribute vec3 position;",
                "uniform mat4 worldViewProjection;",
                "varying vec3 vPosition;",
                "void main() {",
                "    gl_Position = worldViewProjection * vec4(position, 1.0);",
                "    vPosition = position;",
                "}"
            ].join("\n"),
            fragmentSource: [
                "precision highp float;",
                "varying vec3 vPosition;",
                "void main() {",
                "    vec3 dir = normalize(vPosition);",
                "    gl_FragColor = vec4(dir * 0.5 + 0.5, 1.0);",
                "}"
            ].join("\n")
        }, {
            attributes: ["position"],
            uniforms: ["worldViewProjection"]
        });
        this._renderMaterial.backFaceCulling = false;
    }

    public getSkyMaterial() {
        return this._renderMaterial;
    }

    public dispose() {
        this._renderMaterial.dispose();
    }
}
