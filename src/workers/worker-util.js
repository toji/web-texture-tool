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
 * @file Utilites common to all worker-based loaders
 * @module WorkerUtil
 */

 /**
 * Notifies the main thread when transcoding a texture has failed to load for any reason.
 *
 * @param {number} id - Identifier for the texture being transcoded.
 * @param {string} errorMsg - Description of the error that occured
 * @returns {void}
 */
function TextureLoadFail(id, errorMsg) {
  postMessage({
    id: id,
    error: errorMsg,
  });
}

function CreateTextureMessageHandler(onBufferReady) {
  return async (msg) => {
    const url = msg.data.url; // The URL of the basis image OR
    const id = msg.data.id; // A unique ID for the texture
    let buffer = msg.data.buffer; // An array buffer with the file data

    if (url) {
      // Make the call to fetch the file data
      const response = await fetch(url);
      if (!response.ok) {
        return TextureLoadFail(id, `Fetch failed: ${response.status}, ${response.statusText}`);
      }
      buffer = await response.arrayBuffer();
    }
    
    if (!buffer) {
      return TextureLoadFail(id, `No url or buffer specified`);
    }

    try {
      const result = await onBufferReady(
        buffer, // An array buffer with the file data
        msg.data.supportedFormats, // The formats this device supports
        msg.data.mipmaps); // Wether or not mipmaps should be unpacked

      postMessage({
        id,
        buffer: result.buffer,
        format: result.format,
        mipLevels: result.mipLevels,
      }, [result.buffer]);
    } catch(err) {
      TextureLoadFail(id, err.message);
    }
  };
}