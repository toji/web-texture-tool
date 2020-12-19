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
 * @file Loader which handles any image types supported directly by the browser.
 * @module ImageLoader
 */

const IMAGE_TEXTURE_EXTENSIONS = {
  jpg: {format: 'rgb8unorm', mimeType: 'image/jpeg'},
  jpeg: {format: 'rgb8unorm', mimeType: 'image/jpeg'},
  png: {format: 'rgba8unorm', mimeType: 'image/png'},
  apng: {format: 'rgba8unorm', mimeType: 'image/apng'},
  gif: {format: 'rgba8unorm', mimeType: 'image/gif'},
  bmp: {format: 'rgb8unorm', mimeType: 'image/bmp'},
  webp: {format: 'rgba8unorm', mimeType: 'image/webp'},
  ico: {format: 'rgba8unorm', mimeType: 'image/x-icon'},
  cur: {format: 'rgba8unorm', mimeType: 'image/x-icon'},
  svg: {format: 'rgba8unorm', mimeType: 'image/svg+xml'},
};
const IMAGE_BITMAP_SUPPORTED = (typeof createImageBitmap !== 'undefined');

/**
 * Loader which handles any image types supported directly by the browser.
 */
export class ImageLoader {
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
  static supportedExtensions() {
    return Object.keys(IMAGE_TEXTURE_EXTENSIONS);
  }

  /**
   * Load a supported file as a texture from the given URL.
   *
   * @param {object} client - The WebTextureClient which will upload the texture data to the GPU.
   * @param {string} url - An absolute URL that the texture file should be loaded from.
   * @param {object} options - Options for how the loaded texture should be handled.
   * @returns {Promise<module:WebTextureLoader.WebTextureResult>} - The WebTextureResult obtained from passing the
   * parsed file data to the client.
   */
  async loadTextureFromUrl(client, url, options) {
    let format = IMAGE_TEXTURE_EXTENSIONS[options.extension].format;

    if (client.supportedFormatList.indexOf(format) == -1) {
      // 'rgba8unorm' must be supported by all clients
      format = 'rgba8unorm';
    }

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

  /**
   * Load a supported file as a texture from the given Blob.
   *
   * @param {object} client - The WebTextureClient which will upload the texture data to the GPU.
   * @param {Blob} blob - Blob containing the texture file data.
   * @param {object} options - Options for how the loaded texture should be handled.
   * @returns {Promise<module:WebTextureLoader.WebTextureResult>} - The WebTextureResult obtained from passing the
   * parsed file data to the client.
   */
  async loadTextureFromBlob(client, blob, options) {
    let format = IMAGE_TEXTURE_EXTENSIONS[options.extension].format;

    if (client.supportedFormatList.indexOf(format) == -1) {
      // 'rgba8unorm' must be supported by all clients
      format = 'rgba8unorm';
    }

    if (IMAGE_BITMAP_SUPPORTED) {
      const imageBitmap = await createImageBitmap(blob);
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
        const url = window.URL.createObjectURL(blob);
        imageElement.src = url;
      });
    };
  }

  /**
   * Load a supported file as a texture from the given ArrayBuffer or ArrayBufferView.
   *
   * @param {object} client - The WebTextureClient which will upload the texture data to the GPU.
   * @param {ArrayBuffer|ArrayBufferView} buffer - Buffer containing the texture file data.
   * @param {object} options - Options for how the loaded texture should be handled.
   * @returns {Promise<module:WebTextureLoader.WebTextureResult>} - The WebTextureResult obtained from passing the
   * parsed file data to the client.
   */
  async loadTextureFromBuffer(client, buffer, options) {
    const mimeType = IMAGE_TEXTURE_EXTENSIONS[options.extension].mimeType;
    if (!mimeType) {
      throw new Error(`Unable to determine MIME type for extension "${options.extension}"`);
    }

    const blob = new Blob(buffer, {type: mimeType});
    return this.loadTextureFromBlob(client, blob, options);
  }

  /**
   * Destroy this loader.
   *
   * @returns {void}
   */
  destroy() {
    // Nothing to clean up here.
  }
}
