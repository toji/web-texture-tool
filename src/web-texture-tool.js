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
 * This library offers a unified way of loading textures for both WebGL and WebGPU from various file formats, and in all
 * cases attempts to handle the loading as efficently as possible. Every effort made to prevent texture loading from
 * blocking the main thread, since that can often be one of the primary causes of jank during page startup or while
 * streaming in new assets.
 *
 * @file Library for loading various image sources as textures for WebGL or WebGPU
 * @module WebTextureTool
 */

/**
 * Texture Format
 *
 * @typedef {string} WebTextureFormat
 */
const WebTextureFormat = [
  // Uncompressed formats
  'rgb8unorm',
  'rgba8unorm',

  // Compressed formats
  'bc3-rgba-unorm',
  'bc7-rgba-unorm',

  // Not official WebGPU texture format strings, but formats that WebGL supports.
  'rgb565unorm',
  'rgba4unorm',
  'etc1-rgb-unorm',
  'etc2-rgba8unorm',
  'bc1-rgb-unorm',
  'astc-4x4-rgba-unorm',
  'pvrtc1-4bpp-rgb-unorm',
  'pvrtc1-4bpp-rgba-unorm',
];

/**
 * Data and description for a single level of a texture.
 *
 * @typedef {object} WebTextureLevelData
 * @property {module:External.ArrayBufferView} data - Buffer containing the data for the texture level.
 * @property {number} width - Width of the texture level in pixels.
 * @property {number} height - Height of the texture level in pixels.
 */

/**
 * Texture result from calling one of the WebTextureTool methods
 *
 * @property {(module:External.WebGLTexture|module:External.GPUTexture)} texture - WebGL or WebGPU texture object.
 * @property {number} width of mip level 0 in pixels.
 * @property {number} height of mip level 0 in pixels.
 * @property {number} depth of mip level 0 in pixels.
 * @property {number} mipLevels - Number of mip levels the texture contains.
 * @property {WebTextureFormat} format - Format of the texture.
 */
export class WebTextureResult {
  /**
   * Create an instance of a WebTextureResult.
   *
   * @param {(module:External.WebGLTexture|module:External.GPUTexture)} texture - WebGL or WebGPU texture object.
   * @param {number} width of mip level 0 in pixels.
   * @param {number} height of mip level 0 in pixels.
   * @param {number} depth of mip level 0 in pixels.
   * @param {number} mipLevels - Number of mip levels the texture contains.
   * @param {WebTextureFormat} format - Format of the texture.
   */
  constructor(texture, width, height, depth, mipLevels, format) {
    this.texture = texture;
    this.width = width;
    this.height = height;
    this.depth = depth;
    this.mipLevels = mipLevels;
    this.format = format;
  }
}

const IMAGE_TEXTURE_EXTENSIONS = {
  jpg: {format: 'rgb8unorm'},
  jpeg: {format: 'rgb8unorm'},
  png: {format: 'rgba8unorm'},
  apng: {format: 'rgba8unorm'},
  gif: {format: 'rgba8unorm'},
  bmp: {format: 'rgb8unorm'},
  webp: {format: 'rgba8unorm'},
  ico: {format: 'rgba8unorm'},
  cur: {format: 'rgba8unorm'},
  svg: {format: 'rgba8unorm'},
};
const IMAGE_BITMAP_SUPPORTED = (typeof createImageBitmap !== 'undefined');

/**
 * Loader which handles any image types supported directly by the browser.
 */
class ImageTextureLoader {
  /**
   * Creates a ImageTextureLoader instance.
   * Should only be called by the WebTextureTool constructor.
   */
  constructor() {
  }

  /**
   * Which file extensions this loader supports.
   *
   * @returns {Array<string>} - An array of the file extensions this loader supports.
   */
  supportedExtensions() {
    return Object.keys(IMAGE_TEXTURE_EXTENSIONS);
  }

  /**
   * Load a supported file as a texture from the given URL.
   *
   * @param {object} client - The WebTextureClient which will upload the texture data to the GPU.
   * @param {string} url - An absolute URL that the texture file should be loaded from.
   * @param {object} options - Options for how the loaded texture should be handled.
   * @returns {Promise<WebTextureResult>} - The WebTextureResult obtained from passing the parsed file data to the
   * client.
   */
  async loadTextureFromUrl(client, url, options) {
    const format = IMAGE_TEXTURE_EXTENSIONS[options.extension].format;

    if (IMAGE_BITMAP_SUPPORTED) {
      const response = await fetch(url);
      const imageBitmap = await createImageBitmap(await response.blob());
      return client.textureFromImageBitmap(imageBitmap, format, options.mipmaps);
    } else {
      return new Promise((resolve, reject) => {
        const imageElement = new Image();
        imageElement.addEventListener('load', () => {
          resolve(client.textureFromImageElement(imageElement, format, options.mipmaps));
        });
        imageElement.addEventListener('error', function(err) {
          reject(err);
        });
        imageElement.src = url;
      });
    };
  }
}

const CLIENT = Symbol('wtt/WebTextureClient');
const LOADERS = Symbol('wtt/WebTextureLoaders');

const TMP_ANCHOR = document.createElement('a');

const DEFAULT_TOOL_OPTIONS = {
  loaders: null,
};

const DEFAULT_URL_OPTIONS = {
  extension: null,
  mipmaps: true,
};

/**
 * Base texture tool class.
 * Must not be used directly, create an instance of WebGLTextureTool or WebGPUTextureTool instead.
 */
export class WebTextureTool {
  /**
   * WebTextureTool constructor. Must not be called by applications directly.
   * Create an instance of WebGLTextureTool or WebGPUTextureTool as needed instead.
   *
   * @param {object} client - The WebTextureClient which will upload the texture data to the GPU.
   * @param {object} toolOptions - Options to initialize this WebTextureTool instance with.
   */
  constructor(client, toolOptions) {
    const options = Object.assign({}, DEFAULT_TOOL_OPTIONS, toolOptions);
    this[CLIENT] = client;
    this[LOADERS] = {};

    // The ImageTextureLoader is always available, handles any image formats that are supported by the web's <img> tag.
    const imageLoader = new ImageTextureLoader();
    for (const extension of imageLoader.supportedExtensions()) {
      this[LOADERS][extension] = imageLoader;
    }

    // Loops through any additional loaders that were provided and register their extension handlers.
    if (options.loaders) {
      for (const loader of options.loaders) {
        for (const extension of loader.supportedExtensions()) {
          this[LOADERS][extension] = loader;
        }
      }
    }

    // Register one last "fallback" extension. Anything that we receive that has an unrecognized extension will try to
    // load with the ImageTextureLoader.
    this[LOADERS]['*'] = imageLoader;
  }

  /** Loads a texture from the given URL
   *
   * @param {string} url - URL of the file to load.
   * @param {string} textureOptions - Options for how the loaded texture should be handled.
   * @returns {Promise<WebTextureResult>} - Promise which resolves to the completed WebTextureResult.
   */
  async loadTextureFromUrl(url, textureOptions) {
    const options = Object.assign({}, DEFAULT_URL_OPTIONS, textureOptions);

    // Use this to resolve to a full URL.
    TMP_ANCHOR.href = url;

    // If an explicit extension wasn't provided, examine the URL to determine one.
    if (!options.extension) {
      // Isolate just the pathname from the given URL, then split the extension off of that.
      const extIndex = TMP_ANCHOR.pathname.lastIndexOf('.');
      options.extension = extIndex > -1 ? TMP_ANCHOR.pathname.substring(extIndex+1).toLowerCase() : '*';
    }

    const loader = this[LOADERS][options.extension];
    if (!loader) {
      throw new Error(`No loader found for extension "${options.extension}"`);
    }

    return loader.loadTextureFromUrl(this[CLIENT], TMP_ANCHOR.href, options);
  }

  /** Creates a 1x1 texture with the specified color.
   *
   * @param {number} r - Red channel value
   * @param {number} g - Green channel value
   * @param {number} b - Blue channel value
   * @param {number} [a=1.0] - Alpha channel value
   * @returns {WebTextureResult} - Completed WebTextureResult
   */
  createTextureFromColor(r, g, b, a = 1.0) {
    const data = new Uint8Array([r * 255, g * 255, b * 255, a * 255]);
    return this[CLIENT].textureFromLevelData([{data, width: 1, height: 1}], 'rgba8unorm', false);
  }
}
