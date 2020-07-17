# Web Texture Tool

A low-frills library for loading a large variety of image formats into WebGL or WebGPU textures as efficiently as
possible.

# Basic Usage

First, an appropriate instance of `WebTextureTool` must be created. If your application is using WebGL, an instance of
the extended `WebGLTextureTool` class should be constructed, passing the WebGL context:

```js
import { WebGLTextureTool } from "web-texture-tool/webgl-texture-tool.js"

// Get a WebGL context
const canvas = document.createElement('canvas');
const gl = canvas.getContext('webgl');

const wtt = new WebGLTextureTool(gl);
```

Alternately, a `WebGPUTextureTool` can be created for use with WebGPU devices:

```js
import { WebGPUTextureTool } from "web-texture-loader/webgpu-texture-tool.js"

// Get a WebGPU device
const adapter = await navigator.gpu.requestAdapter();
const device = await adapter.requestDevice();

const wtt = new WebGPUTextureTool(device);
```

These classes have identical interfaces aside from the constructor.

Once you have an instance, loading most textures is as easy as calling `textureFromUrl`:

```js
const result = await wtt.textureFromUrl('textures/checkerboard.jpg');
```

The method returns a promise which resolves to a `WebTextureResult` object, which contains:

 - `texture`, a WebGLTexture or WebGPU Texture
 - `width`, `height`, and `depth` of the texture in pixels
 - `type`, such as `2d` or `cube-map`
 - `format`, such as `'rgb'` or `'rgba'`
 - `mipLevels`

Texture dimensions, type, and format should be treated as immutable, as they will be allocated that way with any APIs
that allow or enforce it.

# Additional Loaders

By default the library only loads image formats supported natively by most browsers:

  - JPEG
  - PNG
  - GIF
  - BMP
  - WEBP

But support for other formats can easily be added as needed by specifying additional loaders to the `create()` method,
like so:

```js
import { WebTextureTool } from "web-texture-tool/web-texture-tool.js"
import { BasisLoader } from "web-texture-tool/basis-loader.js"

// Get a WebGL context
const canvas = document.createElement('canvas');
const gl = canvas.getContext('webgl');

const wtt = WebTextureTool.create(gl, {
  loaders: [ new BasisLoader() ]
});
```
