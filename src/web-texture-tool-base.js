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

import {ImageLoader} from './image-loader.js';
import {WorkerLoader} from './workers/worker-loader.js';

/**
 * Texture Format
 *
 * @typedef {string} WebTextureFormat
 */
const WebTextureFormat = [
  // Uncompressed formats
  'rgba8unorm',
  'bgra8unorm',

  // Compressed formats
  'bc3-rgba-unorm',
  'bc7-rgba-unorm',

  // Not official WebGPU texture format strings, but formats that WebGL supports.
  'rgb8unorm',
  'rgb565unorm',
  'rgba4unorm',
  'etc1-rgb-unorm',
  'etc2-rgba8unorm',
  'bc1-rgb-unorm',
  'bc2-rgba-unorm',
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

/**
 * Associates a set of extensions with a specifc loader.
 */
class ExtensionHandler {
  /**
   * Creates an ExtensionHandler.
   *
   * @param {Array<string>} extensions - List of extensions that this loader can handle.
   * @param {Function} callback - Callback which returns an instance of the loader.
   */
  constructor(extensions, callback) {
    this.extensions = extensions;
    this.callback = callback;
    this.loader = null;
  }

  /**
   * Gets the loader associated with this extension set. Creates an instance by calling the callback if one hasn't been
   * instantiated previously.
   *
   * @returns {object} Texture Loader instance.
   */
  getLoader() {
    if (!this.loader) {
      this.loader = this.callback();
    }
    return this.loader;
  }
}

const EXTENSION_HANDLERS = [
  new ExtensionHandler(ImageLoader.supportedExtensions(), () => new ImageLoader()),
  new ExtensionHandler(['basis'], () => new WorkerLoader('basis/basis-worker.js')),
  new ExtensionHandler(['ktx2'], () => new WorkerLoader('ktx/ktx-worker.js')),
  new ExtensionHandler(['dds'], () => new WorkerLoader('dds-worker.js')),
  new ExtensionHandler(['tga'], () => new WorkerLoader('tga-worker.js')),
];

const CLIENT = Symbol('wtt/WebTextureClient');
const LOADERS = Symbol('wtt/WebTextureLoaders');

const TMP_ANCHOR = document.createElement('a');

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
   */
  constructor(client) {
    this[CLIENT] = client;
    this[LOADERS] = {};

    // Map every available extension to it's associated handler
    for (const extensionHandler of EXTENSION_HANDLERS) {
      for (const extension of extensionHandler.extensions) {
        this[LOADERS][extension] = extensionHandler;
      }
    }

    // Register one last "fallback" extension. Anything that we receive that has an unrecognized extension will try to
    // load with the ImageTextureLoader.
    this[LOADERS]['*'] = EXTENSION_HANDLERS[0];
  }

  /** Loads a texture from the given URL
   *
   * @param {string} url - URL of the file to load.
   * @param {string} textureOptions - Options for how the loaded texture should be handled.
   * @returns {Promise<WebTextureResult>} - Promise which resolves to the completed WebTextureResult.
   */
  async loadTextureFromUrl(url, textureOptions) {
    if (!this[CLIENT]) {
      throw new Error('Cannot create new textures after object has been destroyed.');
    }

    const options = Object.assign({}, DEFAULT_URL_OPTIONS, textureOptions);

    // Use this to resolve to a full URL.
    TMP_ANCHOR.href = url;

    // If an explicit extension wasn't provided, examine the URL to determine one.
    if (!options.extension) {
      // Isolate just the pathname from the given URL, then split the extension off of that.
      const extIndex = TMP_ANCHOR.pathname.lastIndexOf('.');
      options.extension = extIndex > -1 ? TMP_ANCHOR.pathname.substring(extIndex+1).toLowerCase() : '*';
    }

    const extensionHandler = this[LOADERS][options.extension];
    if (!extensionHandler) {
      extensionHandler = this[LOADERS]['*'];
    }

    // Get the appropriate loader for the extension. Will instantiate the loader instance the first time it's
    // used.
    const loader = extensionHandler.getLoader();
    if (!loader) {
      throw new Error(`Failed to get loader for extension "${options.extension}"`);
    }

    return loader.loadTextureFromUrl(this[CLIENT], TMP_ANCHOR.href, options);
  }

  /**
   * Creates a 1x1 texture with the specified color.
   *
   * @param {number} r - Red channel value
   * @param {number} g - Green channel value
   * @param {number} b - Blue channel value
   * @param {number} [a=1.0] - Alpha channel value
   * @returns {WebTextureResult} - Completed WebTextureResult
   */
  createTextureFromColor(r, g, b, a = 1.0) {
    if (!this[CLIENT]) {
      throw new Error('Cannot create new textures after object has been destroyed.');
    }
    const data = new Uint8Array([r * 255, g * 255, b * 255, a * 255]);
    return this[CLIENT].textureFromLevelData(
        data, [{level: 0, width: 1, height: 1, offset: 0, size: 4}], 'rgba8unorm', false);
  }

  /**
   * Sets whether or not compressed formats should be loaded.
   * If `false` and a compressed texture can be transcoded to an uncompressed format it will be, otherwise it will be
   * rejected.
   *
   * @param {boolean} value - `true` if compressed formats should be loaded.
   */
  set allowCompressedFormats(value) {
    this[CLIENT].allowCompressedFormats = !!value;
  }

  /**
   * Returns whether or not compressed formats should be loaded.
   *
   * @returns {boolean} `true` if compressed formats should be loaded.
   */
  get allowCompressedFormats() {
    return this[CLIENT].allowCompressedFormats;
  }

  /**
   * Destroys the texture tool and stops any in-progress texture loads that have been started.
   *
   * @returns {void}
   */
  destroy() {
    if (this[CLIENT]) {
      this[CLIENT].destroy();
      this[CLIENT] = null;

      // TODO: Should this happen?
      // Would have to make sure every instance had it's own copies of the loaders.
      // Shut down every loader that this class has initialized.
      /*
      for (const extensionHandler of this[LOADERS]) { // Doesn't work
        if (extensionHandler.loader) {
          extensionHandler.loader.destroy();
          extensionHandler.loader = null;
        }
      }
      */
    }
  }
}
