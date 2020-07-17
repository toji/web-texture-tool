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
 * Loads Basis Universal files, handling the transcoding work in a worker.
 *
 * Based on similar loader code I contributed to https://github.com/BinomialLLC/basis_universal
 * Edited to meet the abstraction needs of this library.
 *
 * @module BasisLoader
 */

class PendingTextureRequest {
  constructor(client, url, mipmaps) {
    this.client = client;
    this.url = url;
    this.mipmaps = mipmaps;
    this.promise = new Promise((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
  }

  uploadImageData(format, buffer, mipLevels) {
    const client = this.client;

    const levels = [];
    for (let mipLevel of mipLevels) {
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

    return client.textureFromLevelData(levels, format, this.mipmaps);
  }
};

export class BasisLoader {
  constructor() {
    this.pendingTextures = {};
    this.nextPendingTextureId = 1;

    // Load the worker script.
    const workerPath = import.meta.url.replace('basis-loader.js', 'basis/basis-worker.js');
    this.worker = new Worker(workerPath);
    this.worker.onmessage = (msg) => { this.onWorkerMessage(msg); }
  }

  supportedExtensions() {
    return ['basis'];
  }

  onWorkerMessage(msg) {
    // Find the pending texture associated with the data we just received
    // from the worker.
    let pendingTexture = this.pendingTextures[msg.data.id];
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
    const result = pendingTexture.uploadImageData(
        msg.data.format,
        msg.data.buffer,
        msg.data.mipLevels);

    pendingTexture.resolve(result);
  }

  async loadTextureFromUrl(client, url, options) {
    let pendingTexture = new PendingTextureRequest(client, url, options.mipmaps);
    this.pendingTextures[this.nextPendingTextureId] = pendingTexture;
    this.worker.postMessage({
      id: this.nextPendingTextureId,
      url: url,
      supportedFormats: client.supportedFormats(),
      mipmaps: options.mipmaps,
    });

    this.nextPendingTextureId++;
    return pendingTexture.promise;
  }
}
