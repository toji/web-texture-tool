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

/**
 * Supports loading textures for WebGPU, as well as providing common utilities that are not part of the core WebGPU API
 * such as mipmap generation.
 *
 * @file WebGPU client for the Web Texture Tool
 * @module WebGPUTextureTool
 */

import {WebTextureTool, WebTextureResult} from './web-texture-tool.js';

// TODO: Replace shaders with WGSL, which won't require a separate compile
import glslangModule from 'https://unpkg.com/@webgpu/glslang@0.0.7/web/glslang.js';

const IMAGE_BITMAP_SUPPORTED = (typeof createImageBitmap !== 'undefined');

const EXTENSION_FORMATS = {
  'texture-compression-bc': [
    'bc1-rgba-unorm',
    'bc2-rgba-unorm',
    'bc3-rgba-unorm',
    'bc7-rgba-unorm',
  ],
  'textureCompressionBC': [  // Non-standard
    'bc1-rgba-unorm',
    'bc2-rgba-unorm',
    'bc3-rgba-unorm',
    'bc7-rgba-unorm',
  ]
};

const FORMAT_BLOCK_SIZE = {
  'rgba8unorm': { byteLength: 4, width: 1, height: 1, canGenerateMipmaps: true },
  'bc1-rgba-unorm': { byteLength: 8, width: 4, height: 4 },
  'bc2-rgba-unorm': { byteLength: 16, width: 4, height: 4 },
  'bc3-rgba-unorm': { byteLength: 16, width: 4, height: 4 },
  'bc7-rgba-unorm': { byteLength: 16, width: 4, height: 4 },
};

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

/**
 * Texture Client that interfaces with WebGPU.
 */
class WebGPUTextureClient {
  /**
   * Creates a WebTextureClient instance which uses WebGPU.
   * Should not be called outside of the WebGLTextureTool constructor.
   *
   * @param {module:External.GPUDevice} device - WebGPU device to use.
   */
  constructor(device) {
    this.device = device;
    this.allowCompressedFormats = true;

    this.uncompressedFormatList = [
      'rgba8unorm',
    ];

    this.supportedFormatList = [
      'rgba8unorm',
    ];

    // Add any other formats that are exposed by extensions.
    if (device.extensions) {
      for (const extension of device.extensions) {
        const formats = EXTENSION_FORMATS[extension];
        if (formats) {
          this.supportedFormatList.push(...formats);
        }
      }
    }

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

  /**
   * Returns a list of the WebTextureFormats that this client can support.
   *
   * @returns {Array<module:WebTextureTool.WebTextureFormat>} - List of supported WebTextureFormats.
   */
  supportedFormats() {
    if (this.allowCompressedFormats) {
      return this.supportedFormatList;
    } else {
      return this.uncompressedFormatList;
    }
  }

  /**
   * Creates a GPUTexture from the given ImageBitmap.
   *
   * @param {module:External.ImageBitmap} imageBitmap - ImageBitmap source for the texture.
   * @param {module:WebTextureTool.WebTextureFormat} format - Format to store the texture as on the GPU. Must be an
   * uncompressed format.
   * @param {boolean} generateMipmaps - True if mipmaps are desired.
   * @returns {module:WebTextureTool.WebTextureResult} - Completed texture and metadata.
   */
  async textureFromImageBitmap(imageBitmap, format, generateMipmaps) {
    if (!this.device) { return null; }
    const mipLevelCount = generateMipmaps ? calculateMipLevels(imageBitmap.width, imageBitmap.height) : 1;
    const textureDescriptor = {
      size: {width: imageBitmap.width, height: imageBitmap.height, depth: 1},
      format,
      usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.SAMPLED,
      mipLevelCount,
    };
    const texture = this.device.createTexture(textureDescriptor);

    this.device.defaultQueue.copyImageBitmapToTexture({imageBitmap}, {texture}, textureDescriptor.size);

    if (generateMipmaps) {
      await this.generateMipmap(texture, textureDescriptor);
    }

    return new WebTextureResult(texture, imageBitmap.width, imageBitmap.height, 1, 1, format);
  }

  /**
   * Creates a GPUTexture from the given HTMLImageElement.
   * Note that WebGPU cannot consume image elements directly, so this method will attempt to create an ImageBitmap and
   * pass that to textureFromImageBitmap instead.
   *
   * @param {module:External.HTMLImageElement} image - image source for the texture.
   * @param {module:WebTextureTool.WebTextureFormat} format - Format to store the texture as on the GPU. Must be an
   * uncompressed format.
   * @param {boolean} generateMipmaps - True if mipmaps are desired.
   * @returns {module:WebTextureTool.WebTextureResult} - Completed texture and metadata.
   */
  async textureFromImageElement(image, format, generateMipmaps) {
    if (!this.device) { return null; }
    if (!IMAGE_BITMAP_SUPPORTED) {
      throw new Error('Must support ImageBitmap to use WebGPU. (How did you even get to this error?)');
    }
    const imageBitmap = await createImageBitmap(image);
    return this.textureFromImageBitmap(imageBitmap, format, generateMipmaps);
  }

  /**
   * Creates a GPUTexture from the given texture level data.
   *
   * @param {Array<module:WebTextureTool.WebTextureLevelData>} levels - An array of data and descriptions for each mip
   * level of the texture.
   * @param {module:WebTextureTool.WebTextureFormat} format - Format to store the data is provided in. May be a
   * compressed format.
   * @param {boolean} generateMipmaps - True if mipmaps generation is desired. Only applies if a single level is given.
   * @returns {module:WebTextureTool.WebTextureResult} - Completed texture and metadata.
   */
  textureFromLevelData(buffer, mipLevels, format, generateMipmaps) {
    if (!this.device) { return null; }

    const blockSize = FORMAT_BLOCK_SIZE[format];
    if (!blockSize) {
      throw new Error(`No block size information for format "${format}"`);
    }

    generateMipmaps = generateMipmaps && blockSize.canGenerateMipmaps;

    const topLevel = mipLevels[0];
    for (const mipLevel of mipLevels) {
      if (mipLevel.level < topLevel.level) {
        topLevel = mipLevel;
      }
    }

    const mipLevelCount = mipLevels.length > 1 ? mipLevels.length :
                            (generateMipmaps ? calculateMipLevels(topLevel.width, topLevel.height) : 1);

    let usage = GPUTextureUsage.COPY_DST | GPUTextureUsage.SAMPLED;
    if (generateMipmaps) {
      usage |= GPUTextureUsage.OUTPUT_ATTACHMENT;
    }

    const textureDescriptor = {
      size: {width: topLevel.width, height: topLevel.height, depth: 1},
      format,
      usage,
      mipLevelCount: mipLevelCount,
    };
    const texture = this.device.createTexture(textureDescriptor);

    // Pre-compute how much big the copy buffer will need to be to hold every available mip level of the texture.
    let textureBufferSize = 0;
    const levelCopyRanges = [];

    for (const mipLevel of mipLevels) {
      const bytesPerImageRow = Math.ceil(mipLevel.width / blockSize.width) * blockSize.byteLength;
      const blockRows = Math.ceil(mipLevel.height / blockSize.height);

      // *SIGH* bytesPerRow has to be a multiple of 256.
      const bytesPerRow = Math.ceil(bytesPerImageRow / 256) * 256;
      const bufferSize = Math.max(mipLevel.size, bytesPerRow * blockRows);

      levelCopyRanges[mipLevel.level] = {
        bytesPerImageRow,
        blockRows,
        bytesPerRow,
        canFastCopy: bytesPerRow == bytesPerImageRow || blockRows == 1,
        textureDataOffset: textureBufferSize,
        textureDataSize: bufferSize,
      };

      textureBufferSize += bufferSize;
    }

    // Allocate a data buffer large enough to hold every mip level.
    const textureDataBuffer = this.device.createBuffer({
      size: textureBufferSize,
      usage: GPUBufferUsage.COPY_SRC,
      mappedAtCreation: true
    });
    const textureDataArray = textureDataBuffer.getMappedRange();

    const commandEncoder = this.device.createCommandEncoder({});

    for (const mipLevel of mipLevels) {
      const levelRange = levelCopyRanges[mipLevel.level];

      const textureBytes = new Uint8Array(textureDataArray, levelRange.textureDataOffset, levelRange.textureDataSize);

      if (levelRange.canFastCopy) {
        // Fast path: Everything lines up and we can just blast the image data into the buffer in one go.
        textureBytes.set(new Uint8Array(buffer, mipLevel.offset, mipLevel.size));

        // TODO: This should work just as well, once https://dawn-review.googlesource.com/c/dawn/+/26320 is fixed.
        // Could be that the mapped buffer approach is more efficient, though? Worth testing.
        /*this.device.defaultQueue.writeTexture(
          {texture: texture},
          new Uint8Array(buffer, mipLevel.offset, mipLevel.size),
          {offset: levelRange.textureDataOffset, bytesPerRow: levelRange.bytesPerRow},
          textureDescriptor.size);*/
      } else {
        // Slow path: Otherwise we need to loop through the texture and copy it's content's row by row.
        for (let i = 0; i < levelRange.blockRows; ++i) {
          textureBytes.set(
            new Uint8Array(buffer, mipLevel.offset + (levelRange.bytesPerImageRow*i), levelRange.bytesPerImageRow),
            levelRange.bytesPerRow*i);
        }
      }

      commandEncoder.copyBufferToTexture({
        buffer: textureDataBuffer,
        bytesPerRow: levelRange.bytesPerRow,
      }, {
        texture: texture,
        mipLevel: mipLevel.level
      }, {
        // Copy width and height must be a multiple of the format block size;
        width: Math.ceil(mipLevel.width / blockSize.width) * blockSize.width,
        height: Math.ceil(mipLevel.height / blockSize.height) * blockSize.height,
        depth: 1
      });
    }

    textureDataBuffer.unmap();

    this.device.defaultQueue.submit([commandEncoder.finish()]);

    textureDataBuffer.destroy();

    if (generateMipmaps) {
      // WARNING! THIS IS CURRENTLY ASYNC!
      // That won't be the case once proper WGLS support is available.
      this.generateMipmap(texture, textureDescriptor);
    }

    return new WebTextureResult(texture, topLevel.width, topLevel.height, 1, mipLevelCount, format);
  }

  /**
   * Generates mipmaps for the given GPUTexture from the data in level 0.
   *
   * @param {module:External.GPUTexture} texture - Texture to generate mipmaps for.
   * @param {object} textureDescriptor - GPUTextureDescriptor the texture was created with.
   * @returns {module:External.GPUTexture} - The originally passed texture
   */
  async generateMipmap(texture, textureDescriptor) {
    await this.mipmapReady;

    if (!this.device) { return null; }

    const textureSize = {
      width: textureDescriptor.size.width,
      height: textureDescriptor.size.height,
      depth: textureDescriptor.size.depth,
    };

    const commandEncoder = this.device.createCommandEncoder({});
    const bindGroupLayout = this.mipmapPipeline.getBindGroupLayout(0);

    let srcView = texture.createView({
      baseMipLevel: 0,
      mipLevelCount: 1
    });

    for (let i = 1; i < textureDescriptor.mipLevelCount; ++i) {
      const dstView = texture.createView({
        baseMipLevel: i,
        mipLevelCount: 1
      });

      const passEncoder = commandEncoder.beginRenderPass({
        colorAttachments: [{
          attachment: dstView,
          loadValue: 'load',
        }],
      });

      const bindGroup = this.device.createBindGroup({
        layout: bindGroupLayout,
        entries: [{
          binding: 0,
          resource: this.mipmapSampler,
        }, {
          binding: 1,
          resource: srcView,
        }],
      });

      passEncoder.setPipeline(this.mipmapPipeline);
      passEncoder.setBindGroup(0, bindGroup);
      passEncoder.draw(4, 1, 0, 0);
      passEncoder.endPass();

      srcView = dstView;

      textureSize.width = Math.ceil(textureSize.width / 2);
      textureSize.height = Math.ceil(textureSize.height / 2);
    }
    this.device.defaultQueue.submit([commandEncoder.finish()]);

    return texture;
  }

  destroy() {
    this.device = null;
  }
}

/**
 * Variant of WebTextureTool which produces WebGPU textures.
 */
export class WebGPUTextureTool extends WebTextureTool {
  /**
   * Creates a WebTextureTool instance which produces WebGPU textures.
   *
   * @param {module:External.GPUDevice} device - WebGPU device to create textures with.
   * @param {object} toolOptions - Options to initialize this WebTextureTool instance with.
   */
  constructor(device, toolOptions) {
    super(new WebGPUTextureClient(device), toolOptions);
  }
}
