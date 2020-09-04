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
      // Should return a WorkerTextureData instance
      const result = await onBufferReady(
        buffer, // An array buffer with the file data
        msg.data.supportedFormats, // The formats this device supports
        msg.data.mipmaps); // Wether or not mipmaps should be unpacked

      result.transfer(id);
    } catch(err) {
      TextureLoadFail(id, err.message);
    }
  };
}

class WorkerTextureData {
  constructor(format, width, height, imageData = null, imageDataOptions = {}) {
    this.format = format;
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);

    this.images = [];
    this.bufferSet = new Set();

    // Optionally, data for the first image's first mip level can be passed to the constructor to handle simple cases.
    if (imageData) {
      this.getImage(0).setMipLevel(0, imageData, imageDataOptions);
    }
  }

  getImage(index) {
    let image = this.images[index];
    if (!image) {
      image = new WorkerTextureImageData(this);
      this.images[index] = image;
    }
    return image;
  }

  transfer(id) {
    let imageList = [];
    for (const image of this.images) {
      imageList.push({
        mipLevels: image.mipLevels
      });
    }
    postMessage({
      id,
      format: this.format,
      width: this.width,
      height: this.height,
      images: imageList,
    }, this.bufferSet.values());
  }
}

class WorkerTextureImageData {
  constructor(textureData) {
    this.textureData = textureData;
    this.mipLevels = [];
  }

  setMipLevel(level, bufferOrTypedArray, options = {}) {
    if (this.mipLevels[level] != undefined) {
      throw new Error('Cannot define an image mip level twice.');
    }

    const width = Math.max(1, options.width || this.textureData.width >> level);
    const height = Math.max(1, options.height || this.textureData.height >> level);
    let byteOffset = options.byteOffset || 0;
    let byteLength = options.byteLength || 0;

    let buffer;
    if (bufferOrTypedArray instanceof ArrayBuffer) {
      buffer = bufferOrTypedArray;
      if (!byteLength) {
        byteLength = buffer.byteLength - byteOffset;
      }
    } else {
      buffer = bufferOrTypedArray.buffer;
      if (!byteLength) {
        byteLength = bufferOrTypedArray.byteLength - byteOffset;
      }
      byteOffset += bufferOrTypedArray.byteOffset;
    }

    this.textureData.bufferSet.add(buffer);

    this.mipLevels[level] = {
      level,
      width,
      height,
      buffer,
      byteOffset,
      byteLength,
    };
  }
}

// Not particularly fancy, but it works and makes reading C-style structs easier.
function createStructReader(layout) {
  const entries = Object.entries(layout);
  return function(target, buffer, bufferOffset = 0) {
    const dataView = new DataView(buffer, bufferOffset);
    let offset = 0;
    entries.forEach(([name, type]) => {
      if (typeof type == 'string') {
        switch (type) {
          case 'uint8': target[name] = dataView.getUint8(offset, true); offset += 1; break;
          case 'int8': target[name] = dataView.getInt8(offset, true); offset += 1; break;
          case 'uint16': target[name] = dataView.getUint16(offset, true); offset += 2; break;
          case 'int16': target[name] = dataView.getInt16(offset, true); offset += 2; break;
          case 'uint32': target[name] = dataView.getUint32(offset, true); offset += 4; break;
          case 'int32': target[name] = dataView.getInt32(offset, true); offset += 4; break;
          case 'uint64': target[name] = Number(dataView.getBigUint64(offset, true)); offset += 8; break;
          case 'int64': target[name] = Number(dataView.getBigUint64(offset, true)); offset += 8; break;
          case 'float':
          case 'float32': target[name] = dataView.getFloat32(offset, true); offset += 4; break;
          case 'double':
          case 'float64': target[name] = dataView.getFloat64(offset, true); offset += 8; break;
        }
      } if (typeof type == 'function') {
        target[name] = {};
        offset += type(target[name], buffer, offset);
      } else if (type.array != undefined) {
        const length = (typeof type.length == 'string') ? target[type.length] : type.length;
        if (typeof type.array == 'function') {
          target[name] = [];
          for (let i = 0; i < length; ++i) {
            const result = {};
            offset += type.array(result, buffer, offset+bufferOffset);
            target[name].push(result);
          }
        } else {
          // TODO: Handle mis-aligned offsets
          switch (type.array) {
            case 'uint8':
              target[name] = new Uint8Array(buffer, offset+bufferOffset, length);
              offset += length;
              break;
            case 'int8':
              target[name] = new Int8Array(buffer, offset+bufferOffset, length);
              offset += length;
              break;
            case 'uint16':
              target[name] = new Uint16Array(buffer, offset+bufferOffset, length);
              offset += length * 2;
              break;
            case 'int16':
              target[name] = new Int16Array(buffer, offset+bufferOffset, length);
              offset += length * 2;
              break;
            case 'uint32':
              target[name] = new Uint32Array(buffer, offset+bufferOffset, length);
              offset += length * 4;
              break;
            case 'int32':
              target[name] = new Int32Array(buffer, offset+bufferOffset, length);
              offset += length * 4;
              break;
            case 'uint64':
              target[name] = new BigUint64Array(buffer, offset+bufferOffset, length);
              offset += length * 8;
              break;
            case 'int64':
              target[name] = new BigInt64Array(buffer, offset+bufferOffset, length);
              offset += length * 8;
              break;
            case 'float':
            case 'float32':
              target[name] = new Float32Array(buffer, offset+bufferOffset, length);
              offset += length * 4;
              break;
            case 'double':
            case 'float64':
              target[name] = new Float64Array(buffer, offset+bufferOffset, length);
              offset += length * 8;
              break;
          }
        }
      } else if (type.align) {
        const alignOffset = (offset % type.align);
        if (alignOffset) {
          offset += type.align - alignOffset;
        }
      }
    });
    return offset;
  };
};