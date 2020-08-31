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
 * @file Web Worker for loading TGA image files
 * @module DDSLoader
 *
 * This file format is bad, and if you are using it you should feel bad. I provide it here simply because it was a
 * common format for a lot of older games and I had the code lying around. Prefer pretty much anything else, please!
 */

importScripts('./worker-util.js');

function parseFile(buffer, supportedFormats, mipmaps) {
  const content = new Uint8Array(buffer);
  const contentOffset = 18 + content[0];
  const imagetype = content[2]; // 2 = rgb, only supported format for now
  const width = content[12] + (content[13] << 8);
  const height = content[14] + (content[15] << 8);
  const bpp = content[16]; // should be 8,16,24,32

  const bytesPerPixel = bpp / 8;
  const bytesPerRow = width * 4;

  if(!width || !height) {
    throw new Error('Invalid dimensions');
  }

  if (imagetype != 2) {
    throw new Error(`Unsupported TGA format: ${imagetype}`);
  }

  let data = new Uint8Array(width * height * 4);
  let i = contentOffset;

  // Really annoying row flipping required here.
  for(let y = height-1; y >= 0; --y) {
    for(let x = 0; x < width; ++x, i += bytesPerPixel) {
      j = (x * 4) + (y * bytesPerRow);
      data[j] = content[i+2];
      data[j+1] = content[i+1];
      data[j+2] = content[i+0];
      data[j+3] = (bpp === 32 ? content[i+3] : 255);
    }
  }

  return {
    buffer: data.buffer,
    format: 'rgba8unorm',
    mipLevels: [{
      level: 0,
      width,
      height,
      offset: 0,
      size: data.byteLength
    }],
  };
}

onmessage = CreateTextureMessageHandler(parseFile);