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

importScripts('../worker-util.js');
importScripts('msc_transcoder_wrapper.js');

// eslint-disable-next-line new-cap
const BASIS_TRANSCODER = new Promise((resolve) => {
  // Turns out this isn't a "real" promise, so we can't use it with await later on. Hence the wrapper promise.
  MSC_TRANSCODER().then((module) => {
    module.initTranscoders();
    resolve(module);
  });
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
    this.basisTexFormat = this.supercompressionScheme == 1 ? 'ETC1S' : null;
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

async function parseFile(buffer, supportedFormats, mipmaps) {
  const BasisTranscoder = await BASIS_TRANSCODER;

  // The formats this device supports
  const supportedTranscodeFormats = {};
  // eslint-disable-next-line guard-for-in
  for (const targetFormat in WTT_FORMAT_MAP) {
    const wttFormat = WTT_FORMAT_MAP[targetFormat];
    supportedTranscodeFormats[targetFormat] = supportedFormats.indexOf(wttFormat.format) > -1;
  }

  const header = new KtxHeader(buffer);

  if (!header.valid) {
    throw new Error('Invalid KTX header');
  }

  const hasAlpha = true;

  if (header.basisTexFormat === 'ETC1S') {
    const basisLZGlobalData = new BasisLZGlobalData(buffer, header);

    // Find a compatible format
    let targetFormat = undefined;
    const formats = hasAlpha ? alphaFormatPreference : opaqueFormatPreference;
    for (const format of formats) {
      if (supportedTranscodeFormats[format]) {
        const basisFormat = BasisTranscoder.TranscodeTarget[format];
        if (BasisTranscoder.isFormatSupported(basisFormat, header.basisTexFormat)) {
          targetFormat = format;
          break;
        }
      }
    }

    if (targetFormat === undefined) {
      throw new Error('No supported transcode formats');
    }

    return transcodeEtc1s(BasisTranscoder, buffer, targetFormat, header, basisLZGlobalData, hasAlpha);
  } else {
    throw new Error('Only Basis ETC1S files supported currently.');
  }
}

function transcodeEtc1s(BasisTranscoder, buffer, targetFormat, header, globalData, hasAlpha) {
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

  const textureData = new WorkerTextureData(WTT_FORMAT_MAP[targetFormat].format, levelWidth, levelHeight);

  for (let levelIndex = 0; levelIndex < levelCount; ++levelIndex) {
    const imageInfo = new BasisTranscoder.ImageInfo(
        BasisTranscoder.TextureFormat.ETC1S, levelWidth, levelHeight, levelIndex);
    const levelHeader = header.levels[levelIndex];

    const levelImageCount = Math.max(header.layerCount, 1) * header.faceCount * levelDepth;

    for (let levelImage = 0; levelImage < levelImageCount; ++levelImage) {
      const textureImage = textureData.getImage(levelImage);

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
        throw new Error(`Image failed to transcode. (Level ${levelIndex}, Image ${levelImage})`);
      }

      const imgData = result.transcodedImage.get_typed_memory_view();
      const bufferData = new Uint8Array(imgData.byteLength);
      bufferData.set(imgData);
      textureImage.setMipLevel(levelIndex, bufferData);
      result.transcodedImage.delete();
    }

    levelWidth = Math.max(1, Math.ceil(levelWidth / 2));
    levelHeight = Math.max(1, Math.ceil(levelHeight / 2));
    levelDepth = Math.max(1, Math.ceil(levelDepth / 2));
  }

  return textureData;
}

onmessage = CreateTextureMessageHandler(parseFile);