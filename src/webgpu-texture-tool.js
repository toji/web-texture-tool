// Copyright 2020 Brandon Jones
//
// Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
// documentation files (the "Software"), to deal in the Software without restriction, including without limitation the
// rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to
// permit persons to whom the Software is furnished to do so, subject to the following conditions:

// The above copyright notice and this permission notice shall be included in all copies or substantial portions of the
// Software.

// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
// WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
// COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

import {WebTextureTool, WebTextureResult} from './web-texture-tool.js';

// TODO: Replace shaders with WGSL, which won't require a separate compile
import glslangModule from './third-party/glslang/glslang.js';

/**
 * A WebGPU device
 *
 * @external GPUDevice
 * @see {@link https://gpuweb.github.io/gpuweb/#gpu-device}
 */

const IMAGE_BITMAP_SUPPORTED = (typeof createImageBitmap !== 'undefined');

/**
 * Determines the number of mip levels needed for a full mip chain given the width and height of texture level 0.
 *
 * @param {number} width of texture level 0.
 * @param {number} height of texture level 0.
 * @returns {number} Ideal number of mip levels.
 */
function calculateMipLevels(width, height) {
  return Math.floor(Math.log2(Math.max(width, height))) + 1;
}

class WebGPUTextureClient {
  constructor(device) {
    this.device = device;

    this.supportedFormatList = [
      'rgb8unorm', 'rgba8unorm',
    ];

    this.mipmapPipeline = null;
    this.mipmapSampler = null;

    this.mipmapReady = glslangModule().then((glslang) => {
      // TODO: Convert to WGSL
      const mipmapVertexSource = `#version 450
        const vec2 pos[4] = vec2[4](vec2(-1.0f, 1.0f), vec2(1.0f, 1.0f), vec2(-1.0f, -1.0f), vec2(1.0f, -1.0f));
        const vec2 tex[4] = vec2[4](vec2(0.0f, 0.0f), vec2(1.0f, 0.0f), vec2(0.0f, 1.0f), vec2(1.0f, 1.0f));
        layout(location = 0) out vec2 vTex;
        void main() {
          vTex = tex[gl_VertexIndex];
          gl_Position = vec4(pos[gl_VertexIndex], 0.0, 1.0);
        }
      `;

      const mipmapFragmentSource = `#version 450
        layout(set = 0, binding = 0) uniform sampler imgSampler;
        layout(set = 0, binding = 1) uniform texture2D img;
        layout(location = 0) in vec2 vTex;
        layout(location = 0) out vec4 outColor;
        void main() {
          outColor = texture(sampler2D(img, imgSampler), vTex);
        }
      `;

      this.mipmapPipeline = device.createRenderPipeline({
        vertexStage: {
          module: device.createShaderModule({
            code: glslang.compileGLSL(mipmapVertexSource, 'vertex'),
          }),
          entryPoint: 'main',
        },
        fragmentStage: {
          module: device.createShaderModule({
            code: glslang.compileGLSL(mipmapFragmentSource, 'fragment'),
          }),
          entryPoint: 'main',
        },
        primitiveTopology: 'triangle-strip',
        colorStates: [{format: 'rgba8unorm'}],
      });

      this.mipmapSampler = device.createSampler({minFilter: 'linear'});
    });
  }

  supportedFormats() {
    return this.supportedFormatList;
  }

  async textureFromImageBitmap(imageBitmap, format, generateMipmaps) {
    const mipLevelCount = generateMipmaps ? calculateMipLevels(imageBitmap.width, imageBitmap.height) : 1;
    const textureDescriptor = {
      size: {width: imageBitmap.width, height: imageBitmap.height, depth: 1},
      format,
      usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.SAMPLED,
      mipLevelCount,
    };
    const texture = this.device.createTexture(textureDescriptor);

    this.device.defaultQueue.copyImageBitmapToTexture({imageBitmap}, {texture}, imageSize);

    if (generateMipmaps) {
      await this.generateMipmap(texture, textureDescriptor);
    }

    return new WebTextureResult(texture, imageBitmap.width, imageBitmap.height, 1, 1, format);
  }

  async textureFromImageElement(image, format, generateMipmaps) {
    if (!IMAGE_BITMAP_SUPPORTED) {
      throw new Error('Must support ImageBitmap to use WebGPU. (How did you even get to this error?)');
    }
    const imageBitmap = await createImageBitmap(image);
    return this.textureFromImageBitmap(imageBitmap, format, generateMipmaps);
  }

  textureFromLevelData(levels, format, generateMipmaps) {
    const level0 = levels[0];
    const mipLevelCount = generateMipmaps ? calculateMipLevels(level0.width, level0.height) : 1;
    const textureDescriptor = {
      size: {width: level0.width, height: level0.height, depth: 1},
      format,
      usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.SAMPLED,
      mipLevelCount,
    };
    const texture = this.device.createTexture(textureDescriptor);

    const [textureDataBuffer, textureDataArray] = this.device.createBufferMapped({
      // BUG? WTF is up with this?!? bytesPerRow has to be a multiple of 256?
      size: 256,
      usage: GPUBufferUsage.COPY_SRC,
    });
    new Uint8Array(textureDataArray).set(imageData);
    textureDataBuffer.unmap();

    const commandEncoder = this.device.createCommandEncoder({});
    commandEncoder.copyBufferToTexture({
      buffer: textureDataBuffer,
      bytesPerRow: 256,
      rowsPerImage: 0, // What is this for?
    }, {texture: texture}, textureDescriptor.size);
    this.device.defaultQueue.submit([commandEncoder.finish()]);

    if (generateMipmaps) {
      // WARNING! THIS IS CURRENTLY ASYNC!
      // That won't be the case once proper WGLS support is available.
      this.generateMipmap(texture, textureDescriptor);
    }

    return new WebTextureResult(texture, width, height, 1, 1, format);
  }

  async generateMipmap(texture, textureDescriptor) {
    await this.mipmapReady;

    // BUG: The fact that we have to create a second texture here is due to a bug in Chrome that doesn't allow you to
    // use a single texture as both a sampler and a output attachement at the same time. If we could do that this code
    // would use half as much GPU allocations and no copyTextureToTexture calls.
    const tmpTexture = this.device.createTexture({
      size: textureDescriptor.size,
      format: textureDescriptor.format,
      usage: GPUTextureUsage.COPY_SRC | GPUTextureUsage.SAMPLED | GPUTextureUsage.OUTPUT_ATTACHMENT,
      mipLevelCount: textureDescriptor.mipLevelCount,
    });

    const commandEncoder = this.device.createCommandEncoder({});

    const bindGroupLayout = this.mipmapPipeline.getBindGroupLayout(0);
    for (let i = 0; i < textureDescriptor.mipLevelCount; ++i) {
      const bindGroup = this.device.createBindGroup({
        layout: bindGroupLayout,
        entries: [{
          binding: 0,
          resource: this.mipmapSampler,
        }, {
          binding: 1,
          resource: texture.createView({
            baseMipLevel: Math.max(0, i-1),
            mipLevelCount: 1,
          }),
        }],
      });

      const passEncoder = commandEncoder.beginRenderPass({
        colorAttachments: [{
          attachment: tmpTexture.createView({
            baseMipLevel: i,
            mipLevelCount: 1,
          }),
          loadValue: 'load',
        }],
      });
      passEncoder.setPipeline(this.mipmapPipeline);
      passEncoder.setBindGroup(0, bindGroup);
      passEncoder.draw(4, 1, 0, 0);
      passEncoder.endPass();

      commandEncoder.copyTextureToTexture({
        texture: tmpTexture,
        mipLevel: i,
      }, {
        texture: texture,
        mipLevel: i,
      }, textureSize);

      textureSize.width = Math.ceil(textureSize.width / 2);
      textureSize.height = Math.ceil(textureSize.height / 2);
    }
    this.device.defaultQueue.submit([commandEncoder.finish()]);

    tmpTexture.destroy();

    return texture;
  }
}

/**
 * Variant of WebTextureTool which produces WebGPU textures.
 */
export class WebGPUTextureTool extends WebTextureTool {
  /**
   * Creates a WebTextureTool instance which produces WebGPU textures.
   *
   * @param {GPUDevice} device - WebGPU device to create textures with.
   */
  constructor(device, toolOptions) {
    super(new WebGPUTextureClient(device), toolOptions);
  }
}
