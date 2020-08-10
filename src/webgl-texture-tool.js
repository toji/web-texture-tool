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
 * Supports loading textures for both WebGL and WebGL 2.0
 *
 * @file WebGL client for the Web Texture Tool
 * @module WebGLTextureTool
 */

import {WebTextureTool, WebTextureResult} from './web-texture-tool.js';

// For access to WebGL enums without a context.
const GL = WebGLRenderingContext;

/**
 * A color, represented a dictionary of R, G, B, and A values.
 *
 * @typedef {object} WebGLMappedFormat
 * @property {number} format - WebGL enum for the texture format.
 * @property {number} type - WebGL enum for the texture data type.
 * @property {number} sizedFormat - WebGL enum for the sized texture format or compressed format.
 * @property {boolean} compressed - Whether or not this is a compressed format.
 */

// Mapping of formats used by Web Texture Tool (based off WebGPU formats) to the equivalent WebGL values.
const GL_FORMAT_MAP = {
  'rgb8unorm': {format: GL.RGB, type: GL.UNSIGNED_BYTE, sizedFormat: 0x8051}, // RGB8
  'rgba8unorm': {format: GL.RGBA, type: GL.UNSIGNED_BYTE, sizedFormat: 0x8058}, // RGBA8
  'rgb565unorm': {format: GL.RGB, type: GL.UNSIGNED_SHORT_5_6_5, sizedFormat: GL.RGB565},
  'rgba4unorm': {format: GL.RGBA, type: GL.UNSIGNED_SHORT_4_4_4_4, sizedFormat: GL.RGBA4},

  // Compressed formats enums from http://www.khronos.org/registry/webgl/extensions/
  'bc1-rgb-unorm': {compressed: true, texStorage: true, sizedFormat: 0x83F0}, // COMPRESSED_RGB_S3TC_DXT1_EXT
  'bc3-rgba-unorm': {compressed: true, texStorage: false, sizedFormat: 0x83F3}, // COMPRESSED_RGBA_S3TC_DXT5_EXT
  'bc7-rgba-unorm': {compressed: true, texStorage: true, sizedFormat: 0x8E8C}, // COMPRESSED_RGBA_BPTC_UNORM_EXT
  'etc1-rgb-unorm': {compressed: true, texStorage: false, sizedFormat: 0x8D64}, // COMPRESSED_RGB_ETC1_WEBGL
  'etc2-rgba8unorm': {compressed: true, texStorage: true, sizedFormat: 0x9278}, // COMPRESSED_RGBA8_ETC2_EAC
  'astc-4x4-rgba-unorm': {compressed: true, texStorage: true, sizedFormat: 0x93B0}, // COMPRESSED_RGBA_ASTC_4x4_KHR
  'pvrtc1-4bpp-rgb-unorm': {
    compressed: true, texStorage: false, sizedFormat: 0x8C00, // COMPRESSED_RGB_PVRTC_4BPPV1_IMG
  },
  'pvrtc1-4bpp-rgba-unorm': {
    compressed: true, texStorage: false, sizedFormat: 0x8C02, // COMPRESSED_RGBA_PVRTC_4BPPV1_IMG
  },
};

/**
 * Determines if the given value is a power of two.
 *
 * @param {number} n - Number to evaluate.
 * @returns {boolean} - True if the number is a power of two.
 */
function isPowerOfTwo(n) {
  return (n & (n - 1)) === 0;
}

/**
 * Determines the number of mip levels needed for a full mip chain given the width and height of texture level 0.
 *
 * @param {number} width of texture level 0.
 * @param {number} height of texture level 0.
 * @returns {number} - Ideal number of mip levels.
 */
function calculateMipLevels(width, height) {
  return Math.floor(Math.log2(Math.max(width, height))) + 1;
}

/**
 * Returns the associated WebGL values for the given mapping, if they exist.
 *
 * @param {module:WebTextureTool.WebTextureFormat} format - Texture format string.
 * @returns {WebGLMappedFormat} - WebGL values that correspond with the given format.
 */
function resolveFormat(format) {
  const glFormat = GL_FORMAT_MAP[format];
  if (!glFormat) {
    throw new Error(`No matching WebGL format for "${format}"`);
  }

  return glFormat;
}

/**
 * Variant of WebTextureClient that uses WebGL.
 */
class WebGLTextureClient {
  /**
   * Creates a WebTextureClient instance which uses WebGL.
   * Should not be called outside of the WebGLTextureTool constructor.
   *
   * @param {(module:External.WebGLRenderingContext|module:External.WebGL2RenderingContext)} gl - WebGL context to use.
   */
  constructor(gl) {
    this.gl = gl;
    this.isWebGL2 = this.gl instanceof WebGL2RenderingContext;

    // Compressed Texture Extensions
    this.extensions = {
      astc: gl.getExtension('WEBGL_compressed_texture_astc'),
      bptc: gl.getExtension('EXT_texture_compression_bptc'),
      etc1: gl.getExtension('WEBGL_compressed_texture_etc1'),
      etc2: gl.getExtension('WEBGL_compressed_texture_etc'),
      pvrtc: gl.getExtension('WEBGL_compressed_texture_pvrtc'),
      s3tc: gl.getExtension('WEBGL_compressed_texture_s3tc'),
    };

    this.supportedFormatList = [
      'rgb8unorm', 'rgba8unorm', 'rgb565unorm', 'rgba4unorm',
    ];

    if (this.extensions.astc) {
      this.supportedFormatList.push('astc-4x4-rgba-unorm');
    }
    if (this.extensions.bptc) {
      this.supportedFormatList.push('bc7-rgba-unorm');
    }
    if (this.extensions.etc1) {
      this.supportedFormatList.push('etc1-rgb-unorm');
    }
    if (this.extensions.etc2) {
      this.supportedFormatList.push('etc2-rgba8unorm');
    }
    if (this.extensions.pvrtc) {
      this.supportedFormatList.push('pvrtc1-4bpp-rgb-unorm', 'pvrtc1-4bpp-rgba-unorm');
    }
    if (this.extensions.s3tc) {
      this.supportedFormatList.push('bc1-rgb-unorm', 'bc3-rgba-unorm');
    }
  }

  /**
   * Returns a list of the WebTextureFormats that this client can support.
   *
   * @returns {Array<module:WebTextureTool.WebTextureFormat>} - List of supported WebTextureFormats.
   */
  supportedFormats() {
    return this.supportedFormatList;
  }

  /**
   * Creates a WebGLTexture from the given ImageBitmap.
   *
   * @param {module:External.ImageBitmap} imageBitmap - ImageBitmap source for the texture.
   * @param {module:WebTextureTool.WebTextureFormat} format - Format to store the texture as on the GPU. Must be an
   * uncompressed format.
   * @param {boolean} generateMipmaps - True if mipmaps are desired.
   * @returns {module:WebTextureTool.WebTextureResult} - Completed texture and metadata.
   */
  textureFromImageBitmap(imageBitmap, format, generateMipmaps) {
    const gl = this.gl;

    // For WebGL 1.0 only generate mipmaps if the texture is a power of two size.
    if (!this.isWebGL2 && generateMipmaps) {
      generateMipmaps = isPowerOfTwo(imageBitmap.width) && isPowerOfTwo(imageBitmap.height);
    }
    const mipLevels = generateMipmaps ? calculateMipLevels(imageBitmap.width, imageBitmap.height) : 1;

    const glFormat = resolveFormat(format);
    if (glFormat.compressed) {
      throw new Error(`Cannot create texture from image with compressed format "${format}"`);
    }

    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);

    if (this.isWebGL2) {
      gl.texStorage2D(gl.TEXTURE_2D, mipLevels, glFormat.sizedFormat, imageBitmap.width, imageBitmap.height);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, glFormat.format, glFormat.type, imageBitmap);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, glFormat.format, glFormat.format, glType, imageBitmap);
    }

    if (mipLevels > 1) {
      gl.generateMipmap(gl.TEXTURE_2D);
    }

    return new WebTextureResult(texture, imageBitmap.width, imageBitmap.height, 1, mipLevels, format);
  }

  /**
   * Creates a WebGLTexture from the given HTMLImageElement.
   *
   * @param {module:External.HTMLImageElement} image - image source for the texture.
   * @param {module:WebTextureTool.WebTextureFormat} format - Format to store the texture as on the GPU. Must be an
   * uncompressed format.
   * @param {boolean} generateMipmaps - True if mipmaps are desired.
   * @returns {module:WebTextureTool.WebTextureResult} - Completed texture and metadata.
   */
  textureFromImageElement(image, format, generateMipmaps) {
    // The methods called to createa a texture from an image element are exactly the same as the imageBitmap path.
    return this.textureFromImageBitmap(image, format, generateMipmaps);
  }

  /**
   * Creates a WebGLTexture from the given texture level data.
   *
   * @param {Array<module:WebTextureTool.WebTextureLevelData>} levels - An array of data and descriptions for each mip
   * level of the texture.
   * @param {module:WebTextureTool.WebTextureFormat} format - Format to store the data is provided in. May be a
   * compressed format.
   * @param {boolean} generateMipmaps - True if mipmaps generation is desired. Only applies if a single level is given.
   * @returns {module:WebTextureTool.WebTextureResult} - Completed texture and metadata.
   */
  textureFromLevelData(buffer, mipLevels, format, generateMipmaps) {
    const gl = this.gl;
    const glFormat = resolveFormat(format);

    const topLevel = mipLevels[0];
    const levelData = [];
    for (const mipLevel of mipLevels) {
      switch (format) {
        case 'rgb565unorm':
        case 'rgba4unorm':
          levelData[mipLevel.level] = new Uint16Array(buffer, mipLevel.offset, mipLevel.size / 2);
          break;
        default:
          levelData[mipLevel.level] = new Uint8Array(buffer, mipLevel.offset, mipLevel.size);
          break;
      }

      if (mipLevel.level < topLevel.level) {
        topLevel = mipLevel;
      }
    }

    // Can't automatically generate mipmaps for compressed formats.
    if (glFormat.compressed) {
      generateMipmaps = false;
    }

    // For WebGL 1.0 only generate mipmaps if the texture is a power of two size.
    if (!this.isWebGL2 && generateMipmaps) {
      generateMipmaps = isPowerOfTwo(topLevel.width) && isPowerOfTwo(topLevel.height);
    }
    const mipLevelCount = mipLevels.length > 1 ? mipLevels.length :
                                         (generateMipmaps ? calculateMipLevels(topLevel.width, topLevel.height) : 1);

    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);

    const useTexStorage = this.isWebGL2 && (!glFormat.compressed || glFormat.texStorage);

    if (useTexStorage) {
      gl.texStorage2D(gl.TEXTURE_2D, mipLevelCount, glFormat.sizedFormat, topLevel.width, topLevel.height);
    }

    for (const mipLevel of mipLevels) {
      if (glFormat.compressed) {
        if (useTexStorage) {
          gl.compressedTexSubImage2D(
              gl.TEXTURE_2D, mipLevel.level,
              0, 0, mipLevel.width, mipLevel.height,
              glFormat.sizedFormat,
              levelData[mipLevel.level]);
        } else {
          gl.compressedTexImage2D(
              gl.TEXTURE_2D, i, glFormat.sizedFormat,
              mipLevel.width, mipLevel.height, 0,
              levelData[mipLevel.level]);
        }
      } else {
        if (useTexStorage) {
          gl.texSubImage2D(
              gl.TEXTURE_2D, mipLevel.level,
              0, 0, mipLevel.width, mipLevel.height,
              glFormat.format, glFormat.type,
              levelData[mipLevel.level]);
        } else {
          gl.texImage2D(
              gl.TEXTURE_2D, mipLevel.level, glFormat.format,
              mipLevel.width, mipLevel.height, 0,
              glFormat.format, glFormat.type,
              levelData[mipLevel.level]);
        }
      }
    }

    if (generateMipmaps && mipLevels.length == 1) {
      gl.generateMipmap(gl.TEXTURE_2D);
    }

    return new WebTextureResult(texture, topLevel.width, topLevel.height, 1, mipLevelCount, format);
  }
}

/**
 * Variant of WebTextureTool which produces WebGL textures.
 */
export class WebGLTextureTool extends WebTextureTool {
  /**
   * Creates a WebTextureTool instance which produces WebGL textures.
   *
   * @param {(module:External.WebGLRenderingContext|module:External.WebGL2RenderingContext)} gl - WebGL context to use.
   * @param {object} toolOptions - Options to initialize this WebTextureTool instance with.
   */
  constructor(gl, toolOptions) {
    super(new WebGLTextureClient(gl), toolOptions);
  }
}
