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
function StructReader(layout) {
  const entries = Object.entries(layout);
  return function(target, buffer, bufferOffset = 0) {
    const dataView = new DataView(buffer, bufferOffset);
    let offset = 0;
    entries.forEach(([name, type]) => {
      if (typeof type == 'string') {
        switch(type) {
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
      } else {
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
          switch(type.array) {
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
      }
    });
    return offset;
  }
};

let BasisTranscoder = null;

// eslint-disable-next-line new-cap
const TRANSCODER_INITIALIZED = MSC_TRANSCODER().then(module => {
  BasisTranscoder = module;
  module.initTranscoders();
});

// Copied from enum class transcoder_texture_format in basisu_transcoder.h with minor javascript-ification
/* eslint-disable */
const BASIS_FORMAT = {
  // Compressed formats

  // ETC1-2
  cTFETC1_RGB: 0,							// Opaque only, returns RGB or alpha data if cDecodeFlagsTranscodeAlphaDataToOpaqueFormats flag is specified
  cTFETC2_RGBA: 1,						// Opaque+alpha, ETC2_EAC_A8 block followed by a ETC1 block, alpha channel will be opaque for opaque .basis files

  // BC1-5, BC7 (desktop, some mobile devices)
  cTFBC1_RGB: 2,							// Opaque only, no punchthrough alpha support yet, transcodes alpha slice if cDecodeFlagsTranscodeAlphaDataToOpaqueFormats flag is specified
  cTFBC3_RGBA: 3, 						// Opaque+alpha, BC4 followed by a BC1 block, alpha channel will be opaque for opaque .basis files
  cTFBC4_R: 4,								// Red only, alpha slice is transcoded to output if cDecodeFlagsTranscodeAlphaDataToOpaqueFormats flag is specified
  cTFBC5_RG: 5,								// XY: Two BC4 blocks, X=R and Y=Alpha, .basis file should have alpha data (if not Y will be all 255's)
  cTFBC7_RGBA: 6,							// RGB or RGBA, mode 5 for ETC1S, modes (1,2,3,5,6,7) for UASTC

  // PVRTC1 4bpp (mobile, PowerVR devices)
  cTFPVRTC1_4_RGB: 8,					// Opaque only, RGB or alpha if cDecodeFlagsTranscodeAlphaDataToOpaqueFormats flag is specified, nearly lowest quality of any texture format.
  cTFPVRTC1_4_RGBA: 9,				// Opaque+alpha, most useful for simple opacity maps. If .basis file doesn't have alpha cTFPVRTC1_4_RGB will be used instead. Lowest quality of any supported texture format.

  // ASTC (mobile, Intel devices, hopefully all desktop GPU's one day)
  cTFASTC_4x4_RGBA: 10,				// Opaque+alpha, ASTC 4x4, alpha channel will be opaque for opaque .basis files. Transcoder uses RGB/RGBA/L/LA modes, void extent, and up to two ([0,47] and [0,255]) endpoint precisions.

  // Uncompressed (raw pixel) formats
  cTFRGBA32: 13,							// 32bpp RGBA image stored in raster (not block) order in memory, R is first byte, A is last byte.
  cTFRGB565: 14,							// 166pp RGB image stored in raster (not block) order in memory, R at bit position 11
  cTFBGR565: 15,							// 16bpp RGB image stored in raster (not block) order in memory, R at bit position 0
  cTFRGBA4444: 16,						// 16bpp RGBA image stored in raster (not block) order in memory, R at bit position 12, A at bit position 0

  cTFTotalTextureFormats: 22,
};
/* eslint-enable */

const WTT_FORMAT_MAP = {};
// Compressed formats
WTT_FORMAT_MAP[BASIS_FORMAT.cTFBC1_RGB] = {format: 'bc1-rgb-unorm'};
WTT_FORMAT_MAP[BASIS_FORMAT.cTFBC3_RGBA] = {format: 'bc3-rgba-unorm'};
WTT_FORMAT_MAP[BASIS_FORMAT.cTFBC7_RGBA] = {format: 'bc7-rgba-unorm'};
WTT_FORMAT_MAP[BASIS_FORMAT.cTFETC1_RGB] = {format: 'etc1-rgb-unorm'};
WTT_FORMAT_MAP[BASIS_FORMAT.cTFETC2_RGBA] = {format: 'etc2-rgba8unorm'};
WTT_FORMAT_MAP[BASIS_FORMAT.cTFASTC_4x4_RGBA] = {format: 'astc-4x4-rgba-unorm'};
WTT_FORMAT_MAP[BASIS_FORMAT.cTFPVRTC1_4_RGB] = {format: 'pvrtc1-4bpp-rgb-unorm'};
WTT_FORMAT_MAP[BASIS_FORMAT.cTFPVRTC1_4_RGBA] = {format: 'pvrtc1-4bpp-rgba-unorm'};

// Uncompressed formats
WTT_FORMAT_MAP[BASIS_FORMAT.cTFRGBA32] = {format: 'rgba8unorm', uncompressed: true};
WTT_FORMAT_MAP[BASIS_FORMAT.cTFRGB565] = {format: 'rgb565unorm', uncompressed: true};
WTT_FORMAT_MAP[BASIS_FORMAT.cTFRGBA4444] = {format: 'rgba4unorm', uncompressed: true};

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

/**
 * Notifies the main thread when transcoding a texture has failed to load for any reason and closes/deletes the open
 * basisFile.
 *
 * @param {number} id - Identifier for the texture being transcoded.
 * @param {object} basisFile - Open basis file to be closed
 * @param {string} errorMsg - Description of the error that occured
 * @returns {void}
 */
function basisFileFail(id, basisFile, errorMsg) {
  fail(id, errorMsg);
  basisFile.close();
  basisFile.delete();
}

// This utility currently only transcodes the first image in the file.
const IMAGE_INDEX = 0;

/**
 * Transcodes basis universal texture data into the optimal supported format and sends the resulting data back to the
 * main thread.
 *
 * @param {number} id - Identifier for the texture being transcoded.
 * @param {module:External.ArrayBufferView} arrayBuffer - Array buffer containing the data to transcode.
 * @param {Array<module:WebTextureTool.WebTextureFormat>} supportedFormats - Formats which the target API can support.
 * @param {boolean} mipmaps - True if all available mip levels should be transcoded.
 * @returns {void}
 */
function transcode(id, arrayBuffer, supportedFormats, mipmaps) {
  const basisData = new Uint8Array(arrayBuffer);

  const basisFile = new BasisFile(basisData);
  const images = basisFile.getNumImages();
  const hasAlpha = basisFile.getHasAlpha();
  let levels = basisFile.getNumLevels(IMAGE_INDEX);

  if (!images || !levels) {
    basisFileFail(id, basisFile, 'Invalid Basis data');
    return;
  }

  if (!basisFile.startTranscoding()) {
    basisFileFail(id, basisFile, 'startTranscoding failed');
    return;
  }

  let basisFormat = undefined;
  if (hasAlpha) {
    if (supportedFormats[BASIS_FORMAT.cTFETC2_RGBA]) {
      basisFormat = BASIS_FORMAT.cTFETC2_RGBA;
    } else if (supportedFormats[BASIS_FORMAT.cTFBC7_RGBA]) {
      basisFormat = BASIS_FORMAT.cTFBC7_RGBA;
    } else if (supportedFormats[BASIS_FORMAT.cTFBC3_RGBA]) {
      basisFormat = BASIS_FORMAT.cTFBC3_RGBA;
    } else if (supportedFormats[BASIS_FORMAT.cTFASTC_4x4_RGBA]) {
      basisFormat = BASIS_FORMAT.cTFASTC_4x4_RGBA;
    } else if (supportedFormats[BASIS_FORMAT.cTFPVRTC1_4_RGBA]) {
      basisFormat = BASIS_FORMAT.cTFPVRTC1_4_RGBA;
    } else {
      // If we don't support any appropriate compressed formats transcode to
      // raw pixels. This is something of a last resort, because the GPU
      // upload will be significantly slower and take a lot more memory, but
      // at least it prevents you from needing to store a fallback JPG/PNG and
      // the download size will still likely be smaller.
      basisFormat = BASIS_FORMAT.cTFRGBA32;
    }
  } else {
    if (supportedFormats[BASIS_FORMAT.cTFETC1_RGB]) {
      // Should be the highest quality, so use when available.
      // http://richg42.blogspot.com/2018/05/basis-universal-gpu-texture-format.html
      basisFormat = BASIS_FORMAT.cTFETC1_RGB;
    } else if (supportedFormats[BASIS_FORMAT.cTFBC7_RGBA]) {
      basisFormat = BASIS_FORMAT.cTFBC7_RGBA;
    } else if (supportedFormats[BASIS_FORMAT.cTFBC1_RGB]) {
      basisFormat = BASIS_FORMAT.cTFBC1_RGB;
    } else if (supportedFormats[BASIS_FORMAT.cTFETC2_RGBA]) {
      basisFormat = BASIS_FORMAT.cTFETC2_RGBA;
    } else if (supportedFormats[BASIS_FORMAT.cTFASTC_4x4_RGBA]) {
      basisFormat = BASIS_FORMAT.cTFASTC_4x4_RGBA;
    } else if (supportedFormats[BASIS_FORMAT.cTFPVRTC1_4_RGB]) {
      basisFormat = BASIS_FORMAT.cTFPVRTC1_4_RGB;
    } else if (supportedFormats[BASIS_FORMAT.cTFRGB565]) {
      // See note on uncompressed transcode above.
      basisFormat = BASIS_FORMAT.cTFRGB565;
    } else {
      // See note on uncompressed transcode above.
      basisFormat = BASIS_FORMAT.cTFRGBA32;
    }
  }

  if (basisFormat === undefined) {
    basisFileFail(id, basisFile, 'No supported transcode formats');
    return;
  }

  const wttFormat = WTT_FORMAT_MAP[basisFormat];

  // If we're not using compressed textures or we've been explicitly instructed to not unpack mipmaps only transcode a
  // single level.
  if (wttFormat.uncompressed || !mipmaps) {
    levels = 1;
  }

  // Gather information about each mip level to be transcoded.
  const mipLevels = [];
  let totalTranscodeSize = 0;

  for (let mipLevel = 0; mipLevel < levels; ++mipLevel) {
    const transcodeSize = basisFile.getImageTranscodedSizeInBytes(IMAGE_INDEX, mipLevel, basisFormat);
    mipLevels.push({
      level: mipLevel,
      offset: totalTranscodeSize,
      size: transcodeSize,
      width: basisFile.getImageWidth(IMAGE_INDEX, mipLevel),
      height: basisFile.getImageHeight(IMAGE_INDEX, mipLevel),
    });
    totalTranscodeSize += transcodeSize;
  }

  // Allocate a buffer large enough to hold all of the transcoded mip levels at once.
  const transcodeData = new Uint8Array(totalTranscodeSize);

  // Transcode each mip level into the appropriate section of the overall buffer.
  for (const mipLevel of mipLevels) {
    const levelData = new Uint8Array(transcodeData.buffer, mipLevel.offset, mipLevel.size);
    if (!basisFile.transcodeImage(levelData, IMAGE_INDEX, mipLevel.level, basisFormat, 1, 0)) {
      basisFileFail(id, basisFile, 'transcodeImage failed');
      return;
    }
  }

  basisFile.close();
  basisFile.delete();

  // Post the transcoded results back to the main thread.
  postMessage({
    id: id,
    buffer: transcodeData.buffer,
    format: wttFormat.format,
    mipLevels: mipLevels,
  }, [transcodeData.buffer]);
}

const KTX_IDENTIFIER = [
  /*«KTX 20»\r\n\x1A\n*/
  0xAB, 0x4B, 0x54, 0x58, 0x20, 0x32, 0x30, 0xBB, 0x0D, 0x0A, 0x1A, 0x0A,
];

const KtxHeaderReader = StructReader({
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

  levels: {length: 'levelCount', array: StructReader({
    byteOffset: 'uint64',
    byteLength: 'uint64',
    uncompressedByteLength: 'uint64'
  })},
});

class KtxHeader {
  constructor(buffer) {
    KtxHeaderReader(this, buffer);

    this.valid = true;
    for (let i = 0; i < KTX_IDENTIFIER.length; ++i) {
      if (this.identifier[i] !== KTX_IDENTIFIER[i]) {
        this.valid = false;
        break;
      }
    }

   /* const header32 = new Uint32Array(buffer, 12, 13);
    const header64 = new BigUint64Array(buffer, 64, 2);

    this.vkFormat = header32[0];
    this.typeSize = header32[1];
    this.pixelWidth = header32[2];
    this.pixelHeight = header32[3];
    this.pixelDepth = header32[4];
    this.layerCount = header32[5];
    this.faceCount = header32[6];
    this.levelCount = header32[7];
    this.supercompressionScheme = header32[8];

    // Index
    this.dfdByteOffset = header32[9];
    this.dfdByteLength = header32[10];
    this.kvdByteOffset = header32[11];
    this.kvdByteLength = header32[12];
    this.sgdByteOffset = header64[0];
    this.sgdByteLength = header64[1];

    // Level Index
    const levelData = new BigUint64Array(buffer, 80, this.levelCount * 3);
    this.levels = [];
    for (let i = 0; i < this.levelCount; ++i) {
      this.levels.push({
        byteOffset: levelData[i * 3],
        byteLength: levelData[i * 3 + 1],
        uncompressedByteLength: levelData[i * 3 + 2],
      });
    }*/

    this.layerPixelDepth = Math.max(this.pixelDepth, 1);
    for(let i = 1; i < this.levelCount; i++) {
      this.layerPixelDepth += Math.max(this.pixelDepth >> i, 1);
    }

    this.imageCount = Math.max(this.layerCount, 1) * this.faceCount * this.layerPixelDepth;

    this.basisTexFormat = this.supercompressionScheme == 1 ? "ETC1S" : null;    
  }
}

const BasisLZGlobalDataReader = StructReader({
  endpointCount: 'uint16',
  selectorCount: 'uint16',
  endpointsByteLength: 'uint32',
  selectorsByteLength: 'uint32',
  tablesByteLength: 'uint32',
  extendedByteLength: 'uint32',
});

const ImageDescReader = StructReader({
  imageFlags: 'uint32',
  rgbSliceByteOffset: 'uint32',
  rgbSliceByteLength: 'uint32',
  alphaSliceByteOffset: 'uint32',
  alphaSliceByteLength: 'uint32',
});

class BasisLZGlobalData {
  constructor(buffer, header) {
    let offset = header.sgdByteOffset;
    offset += BasisLZGlobalDataReader(this, buffer, offset);

    this.imageDescs = [];
    for (let i = 0; i < header.imageCount; ++i) {
      const imageDesc = {};
      offset += ImageDescReader(imageDesc, buffer, offset);
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

function parseFile(id, buffer, supportedFormats, mipmaps) {
  const header = new KtxHeader(buffer);

  if (!header.valid) {
    fail(id, 'Invalid KTX header');
  }

  if (header.basisTexFormat == "ETC1S") {
    const basisLZGlobalData = new BasisLZGlobalData(buffer, header);
    transcodeEtc1s(buffer, "rgba", header, basisLZGlobalData);
  }

  fail(id, 'Valid header');
}

function transcodeEtc1s(buffer, targetFormat, header, globalData) {
  const transcoder = new BasisTranscoder.BasisLzEtc1sImageTranscoder();
  transcoder.decodePalettes(globalData.endpointCount, globalData.endpointsData,
                            globalData.selectorCount, globalData.selectorsData);
  transcoder.decodeTables(globalData.tablesData);

  let curImageIndex = 0;
  for(let level = 0; level < header.levelCount; ++level) {
    const levelWidth = 1;
    const levelHeight = 1;
    const imageInfo = new BasisTranscoder.ImageInfo("ETC1S", levelWidth, levelHeight, level);
    
  }
}


onmessage = (msg) => {
  // Each call to the worker must contain:
  const url = msg.data.url; // The URL of the basis image OR
  const buffer = msg.data.buffer; // An array buffer with the basis image data
  const id = msg.data.id; // A unique ID for the texture
  const mipmaps = msg.data.mipmaps; // Wether or not mipmaps should be unpacked
  const extension = msg.data.extension; // The file extension to be used (may differ from what's in the URL)

  // The formats this device supports
  const supportedFormats = {};
  // eslint-disable-next-line guard-for-in
  for (const basisFormat in WTT_FORMAT_MAP) {
    const wttFormat = WTT_FORMAT_MAP[basisFormat];
    supportedFormats[basisFormat] = msg.data.supportedFormats.indexOf(wttFormat.format) > -1;
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
