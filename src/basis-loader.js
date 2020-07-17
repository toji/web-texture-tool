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
 * Based on similar loader code I contributed to https://github.com/BinomialLLC/basis_universal
 * Edited to meet the abstraction needs of this library. Handles texture transcoding in a worker to avoid blocking the
 * main thread.
 *
 * @file Loader for Basis Universal texture files
 * @module BasisLoader
 */

/**
 * Tracks required data for fulfilling a texture request once it has been transcoded.
 */
class PendingTextureRequest {
  /**
   * Creates a PendingTextureRequest instance.
   *
   * @param {object} client - The WebTextureClient that will upload the transcoded data.
   * @param {*} mipmaps - True if mipmaps are desired.
   * @param {*} resolve - Success callback.
   * @param {*} reject - Failure callback.
   */
  constructor(client, mipmaps, resolve, reject) {
    this.client = client;
    this.mipmaps = mipmaps;
    this.resolve = resolve;
    this.reject = reject;
  }
};

/**
 * Loader which handles Basis Universal files.
 */
export class BasisLoader {
  /**
   * Creates a BasisLoader instance.
   */
  constructor() {
    this.pendingTextures = {};
    this.nextPendingTextureId = 1;

    // Load the worker script.
    const workerPath = import.meta.url.replace('basis-loader.js', 'basis/basis-worker.js');
    this.worker = new Worker(workerPath);
    this.worker.onmessage = (msg) => {
      this.onWorkerMessage(msg);
    };
  }

  /**
   * Which file extensions this loader supports.
   *
   * @returns {Array<string>} - An array of the file extensions this loader supports.
   */
  supportedExtensions() {
    return ['basis'];
  }

  /**
   * Prepares the transcoded level data and passes it to the given client.
   *
   * @param {PendingTextureRequest} pendingTexture - Pending texture request.
   * @param {module:WebTextureTool.WebTextureFormat} format - Format the texture was transcoded to.
   * @param {module:External.ArrayBufferView} buffer - Buffer which contains all transcoded mip level data, packed.
   * @param {Array<object>} mipLevels - Description of size and offset of each mip level in buffer.
   * @returns {Promise<module:WebTextureTool.WebTextureResult>} - Completed texture.
   */
  finishTexture(pendingTexture, format, buffer, mipLevels) {
    const levels = [];
    for (const mipLevel of mipLevels) {
      const level = {
        width: mipLevel.width,
        height: mipLevel.height,
      };

      switch (format) {
        case 'rgb565unorm':
        case 'rgba4unorm':
          level.data = new Uint16Array(buffer, mipLevel.offset, mipLevel.size / 2);
          break;
        default:
          level.data = new Uint8Array(buffer, mipLevel.offset, mipLevel.size);
          break;
      }
      levels[mipLevel.level] = level;
    }

    return pendingTexture.client.textureFromLevelData(levels, format, pendingTexture.mipmaps);
  }

  /**
   * Called when the worker either finished transcoding a file or encounters an error.
   *
   * @param {object} msg - Message contents from the worker
   * @returns {void}
   */
  onWorkerMessage(msg) {
    // Find the pending texture associated with the data we just received
    // from the worker.
    const pendingTexture = this.pendingTextures[msg.data.id];
    if (!pendingTexture) {
      if (msg.data.error) {
        console.error(`Basis transcode failed: ${msg.data.error}`);
      }
      console.error(`Invalid pending texture ID: ${msg.data.id}`);
      return;
    }

    // Remove the pending texture from the waiting list.
    delete this.pendingTextures[msg.data.id];

    // If the worker indicated an error has occured handle it now.
    if (msg.data.error) {
      console.error(`Basis transcode failed: ${msg.data.error}`);
      pendingTexture.reject(`${msg.data.error}`);
      return;
    }

    // Upload the image data returned by the worker.
    const result = this.finishTexture(pendingTexture, msg.data.format, msg.data.buffer, msg.data.mipLevels);
    pendingTexture.resolve(result);
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
    const pendingTextureId = this.nextPendingTextureId++;

    this.worker.postMessage({
      id: pendingTextureId,
      url: url,
      supportedFormats: client.supportedFormats(),
      mipmaps: options.mipmaps,
    });

    return new Promise((resolve, reject) => {
      this.pendingTextures[pendingTextureId] = new PendingTextureRequest(client, options.mipmaps, resolve, reject);
    });
  }
}
