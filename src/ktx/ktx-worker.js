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
 * @file Web Worker for loading/transcoding KTX files
 * @module KTXLoader
 *
 * Loads the Khronos Standard KTX2 file format (spec: http://github.khronos.org/KTX-Specification/)
 * Basis transcoding is handled by Web Assembly code in msc_transcoder_wrapper.wasm, which is maintained at
 * https://github.com/KhronosGroup/KTX-Software
 */

importScripts('msc_transcoder_wrapper.js');

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

let BasisTranscoder = null;

// eslint-disable-next-line new-cap
const TRANSCODER_INITIALIZED = MSC_TRANSCODER().then((module) => {
  BasisTranscoder = module;
  module.initTranscoders();
});

const WTT_FORMAT_MAP = {
  // Compressed formats
  BC1_RGB: {format: 'bc1-rgb-unorm'},
  BC3_RGBA: {format: 'bc3-rgba-unorm'},
  BC7_RGBA: {format: 'bc7-rgba-unorm'},
  ETC1_RGB: {format: 'etc1-rgb-unorm'},
  ETC2_RGBA: {format: 'etc2-rgba8unorm'},
  ASTC_4x4_RGBA: {format: 'astc-4x4-rgba-unorm'},
  PVRTC1_4_RGB: {format: 'pvrtc1-4bpp-rgb-unorm'},
  PVRTC1_4_RGBA: {format: 'pvrtc1-4bpp-rgba-unorm'},

  // Uncompressed formats
  RGBA32: {format: 'rgba8unorm', uncompressed: true},
  RGB565: {format: 'rgb565unorm', uncompressed: true},
  RGBA4444: {format: 'rgba4unorm', uncompressed: true},
};

const KTX_IDENTIFIER = [
  /* «KTX 20»\r\n\x1A\n */
  0xAB, 0x4B, 0x54, 0x58, 0x20, 0x32, 0x30, 0xBB, 0x0D, 0x0A, 0x1A, 0x0A,
];

const ktxHeaderReader = createStructReader({
  identifier: {array: 'uint8', length: 12},
  vkFormat: 'uint32',
  typeSize: 'uint32',
  pixelWidth: 'uint32',
  pixelHeight: 'uint32',
  pixelDepth: 'uint32',
  layerCount: 'uint32',
  faceCount: 'uint32',
  levelCount: 'uint32',
  supercompressionScheme: 'uint32',

  // Index
  dfdByteOffset: 'uint32',
  dfdByteLength: 'uint32',
  kvdByteOffset: 'uint32',
  kvdByteLength: 'uint32',
  sgdByteOffset: 'uint64',
  sgdByteLength: 'uint64',

  levels: {length: 'levelCount', array: createStructReader({
    byteOffset: 'uint64',
    byteLength: 'uint64',
    uncompressedByteLength: 'uint64',
  })},
});

const basisLZGlobalDataReader = createStructReader({
  endpointCount: 'uint16',
  selectorCount: 'uint16',
  endpointsByteLength: 'uint32',
  selectorsByteLength: 'uint32',
  tablesByteLength: 'uint32',
  extendedByteLength: 'uint32',
});

const imageDescReader = createStructReader({
  imageFlags: 'uint32',
  rgbSliceByteOffset: 'uint32',
  rgbSliceByteLength: 'uint32',
  alphaSliceByteOffset: 'uint32',
  alphaSliceByteLength: 'uint32',
});

const keyValueReader = createStructReader({
  keyAndValueByteLength: 'uint32',
  keyAndValue: {array: 'uint8', length: 'keyAndValueByteLength'},
  valuePadding: {align: 4},
});

class KtxHeader {
  constructor(buffer) {
    ktxHeaderReader(this, buffer);

    this.valid = true;
    for (let i = 0; i < KTX_IDENTIFIER.length; ++i) {
      if (this.identifier[i] !== KTX_IDENTIFIER[i]) {
        this.valid = false;
        break;
      }
    }

    // Read key/value data
    this.keyValues = {};
    const utf8decoder = new TextDecoder('utf-8');
    let offset = this.kvdByteOffset;
    const kvdEndOffset = this.kvdByteOffset + this.kvdByteLength;
    while (offset != kvdEndOffset) {
      const keyValueData = {};
      offset += keyValueReader(keyValueData, buffer, offset);
      const nullIndex = keyValueData.keyAndValue.findIndex((element) => element === 0);
      const key = utf8decoder.decode(keyValueData.keyAndValue.slice(0, nullIndex));
      const value = keyValueData.keyAndValue.slice(nullIndex+1, keyValueData.keyAndValueByteLength);
      this.keyValues[key] = value;
    }

    this.layerPixelDepth = Math.max(this.pixelDepth, 1);
    for (let i = 1; i < this.levelCount; i++) {
      this.layerPixelDepth += Math.max(this.pixelDepth >> i, 1);
    }

    // Total image count for the file.
    this.imageCount = Math.max(this.layerCount, 1) * this.faceCount * this.layerPixelDepth;
    this.basisTexFormat = this.supercompressionScheme == 1 ? BasisTranscoder.TextureFormat.ETC1S : null;
  }
}

class BasisLZGlobalData {
  constructor(buffer, header) {
    let offset = header.sgdByteOffset;
    offset += basisLZGlobalDataReader(this, buffer, offset);

    this.imageDescs = [];
    for (let i = 0; i < header.imageCount; ++i) {
      const imageDesc = {};
      offset += imageDescReader(imageDesc, buffer, offset);
      this.imageDescs.push(imageDesc);
    }

    this.endpointsData = new Uint8Array(buffer, offset, this.endpointsByteLength);
    offset += this.endpointsByteLength;

    this.selectorsData = new Uint8Array(buffer, offset, this.selectorsByteLength);
    offset += this.selectorsByteLength;

    this.tablesData = new Uint8Array(buffer, offset, this.tablesByteLength);
    offset += this.tablesByteLength;

    this.extendedData = new Uint8Array(buffer, offset, this.extendedByteLength);
  }
}

// See http://richg42.blogspot.com/2018/05/basis-universal-gpu-texture-format.html for details.
// ETC1 Should be the highest quality, so use when available.
// If we don't support any appropriate compressed formats transcode to raw RGB(A) pixels. This is something of a last
// resort, because the GPU upload will be significantly slower and take a lot more memory, but at least it prevents you
// from needing to store a fallback JPG/PNG and the download size will still likely be smaller.
const alphaFormatPreference = [
  'ETC2_RGBA', 'BC7_RGBA', 'BC3_RGBA', 'ASTC_4x4_RGBA', 'PVRTC1_4_RGBA', 'RGBA32'];
const opaqueFormatPreference = [
  'ETC1_RGB', 'BC7_RGBA', 'BC1_RGB', 'ETC2_RGBA', 'ASTC_4x4_RGBA', 'PVRTC1_4_RGB', 'RGB565', 'RGBA32'];

function parseFile(id, buffer, supportedFormats, mipmaps) {
  const header = new KtxHeader(buffer);

  if (!header.valid) {
    fail(id, 'Invalid KTX header');
  }

  const hasAlpha = true;

  if (header.basisTexFormat == BasisTranscoder.TextureFormat.ETC1S) {
    const basisLZGlobalData = new BasisLZGlobalData(buffer, header);

    // Find a compatible format
    let targetFormat = undefined;
    const formats = hasAlpha ? alphaFormatPreference : opaqueFormatPreference;
    for (const format of formats) {
      if (supportedFormats[format]) {
        const basisFormat = BasisTranscoder.TranscodeTarget[format];
        if (BasisTranscoder.isFormatSupported(basisFormat, header.basisTexFormat)) {
          targetFormat = format;
          break;
        }
      }
    }

    if (targetFormat === undefined) {
      fail(id, 'No supported transcode formats');
      return;
    }

    if (!transcodeEtc1s(id, buffer, targetFormat, header, basisLZGlobalData, hasAlpha)) {
      return;
    }
  } else {
    fail(id, 'Not a basis ETC1S file.');
  }
}

function transcodeEtc1s(id, buffer, targetFormat, header, globalData, hasAlpha) {
  const transcoder = new BasisTranscoder.BasisLzEtc1sImageTranscoder();
  transcoder.decodePalettes(globalData.endpointCount, globalData.endpointsData, globalData.selectorCount,
      globalData.selectorsData);
  transcoder.decodeTables(globalData.tablesData);

  const mipLevels = [];
  const mipLevelData = [];
  let totalTranscodeSize = 0;

  const isVideo = false;

  const levelCount = Math.max(header.levelCount, 1);
  let levelWidth = header.pixelWidth;
  let levelHeight = Math.max(header.pixelHeight, 1);
  let levelDepth = Math.max(header.pixelDepth, 1);
  let curImageIndex = 0;
  for (let levelIndex = 0; levelIndex < levelCount; ++levelIndex) {
    const imageInfo = new BasisTranscoder.ImageInfo(
        BasisTranscoder.TextureFormat.ETC1S, levelWidth, levelHeight, levelIndex);
    const levelHeader = header.levels[levelIndex];

    const levelImageCount = Math.max(header.layerCount, 1) * header.faceCount * levelDepth;

    for (let levelImage = 0; levelImage < levelImageCount; ++levelImage) {
      // In KTX2 container locate the imageDesc for this image.
      const imageDesc = globalData.imageDescs[curImageIndex++];
      imageInfo.flags = imageDesc.imageFlags;
      imageInfo.rgbByteOffset = 0;
      imageInfo.rgbByteLength = imageDesc.rgbSliceByteLength;
      imageInfo.alphaByteOffset = imageDesc.alphaSliceByteOffset > 0 ? imageDesc.rgbSliceByteLength : 0;
      imageInfo.alphaByteLength = imageDesc.alphaSliceByteLength;
      // Determine the location in the ArrayBuffer of the start
      // of the deflated data for level.

      // Make a .subarray of the rgb slice data.
      const levelData = new Uint8Array(buffer,
          levelHeader.byteOffset + imageDesc.rgbSliceByteOffset,
          imageDesc.rgbSliceByteLength + imageDesc.alphaSliceByteLength);

      const basisFormat = BasisTranscoder.TranscodeTarget[targetFormat];
      const result = transcoder.transcodeImage(basisFormat, levelData, imageInfo, hasAlpha, isVideo);

      if ( result.transcodedImage === undefined ) {
        fail(id, `Image failed to transcode. (Level ${levelIndex}, Image ${levelImage})`);
        return false;
      }

      const imgData = result.transcodedImage.get_typed_memory_view();

      mipLevels.push({
        level: levelIndex,
        offset: totalTranscodeSize,
        size: imgData.byteLength,
        width: levelWidth,
        height: levelHeight,
      });

      totalTranscodeSize += imgData.byteLength;

      mipLevelData.push({
        transcodedImage: result.transcodedImage,
        imgData,
      });
    }

    levelWidth = Math.max(1, Math.ceil(levelWidth / 2));
    levelHeight = Math.max(1, Math.ceil(levelHeight / 2));
    levelDepth = Math.max(1, Math.ceil(levelDepth / 2));
  }

  // Copy all the transcoded data into one big array for transfer out of the worker.
  const transcodeData = new Uint8Array(totalTranscodeSize);
  for (let i = 0; i < mipLevels.length; ++i) {
    const mipLevel = mipLevels[i];
    transcodeData.set(mipLevelData[i].imgData, mipLevel.offset);

    // Do not call delete() until data has been uploaded
    // or otherwise copied.
    mipLevelData[i].transcodedImage.delete();
  }

  // Post the transcoded results back to the main thread.
  postMessage({
    id: id,
    buffer: transcodeData.buffer,
    format: WTT_FORMAT_MAP[targetFormat].format,
    mipLevels: mipLevels,
  }, [transcodeData.buffer]);

  return true;
}

/**
 * Notifies the main thread when transcoding a texture has failed to load for any reason.
 *
 * @param {number} id - Identifier for the texture being transcoded.
 * @param {string} errorMsg - Description of the error that occured
 * @returns {void}
 */
function fail(id, errorMsg) {
  postMessage({
    id: id,
    error: errorMsg,
  });
}

onmessage = (msg) => {
  // Each call to the worker must contain:
  const url = msg.data.url; // The URL of the basis image OR
  const buffer = msg.data.buffer; // An array buffer with the basis image data
  const id = msg.data.id; // A unique ID for the texture
  const mipmaps = msg.data.mipmaps; // Wether or not mipmaps should be unpacked

  // The formats this device supports
  const supportedFormats = {};
  // eslint-disable-next-line guard-for-in
  for (const targetFormat in WTT_FORMAT_MAP) {
    const wttFormat = WTT_FORMAT_MAP[targetFormat];
    supportedFormats[targetFormat] = msg.data.supportedFormats.indexOf(wttFormat.format) > -1;
  }

  if (url) {
    // Make the call to fetch the basis texture data
    fetch(url).then(function(response) {
      if (response.ok) {
        response.arrayBuffer().then((arrayBuffer) => {
          if (BasisTranscoder) {
            parseFile(id, arrayBuffer, supportedFormats, mipmaps);
          } else {
            TRANSCODER_INITIALIZED.then(() => {
              parseFile(id, arrayBuffer, supportedFormats, mipmaps);
            });
          }
        });
      } else {
        fail(id, `Fetch failed: ${response.status}, ${response.statusText}`);
      }
    });
  } else if (buffer) {
    parseFile(id, arrayBuffer, supportedFormats, mipmaps);
    if (BasisTranscoder) {
      parseFile(id, buffer, supportedFormats, mipmaps);
    } else {
      TRANSCODER_INITIALIZED.then(() => {
        parseFile(id, buffer, supportedFormats, mipmaps);
      });
    }
  } else {
    fail(id, `No url or buffer specified`);
  }
};
