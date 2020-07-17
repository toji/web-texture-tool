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
 * Handles file loading (and if necessary, transcoding) in a worker to avoid blocking the main thread.
 *
 * @file Loader for DirectDraw Surface (DDS) texture files
 * @module DDSLoader
 */

/**
 * Parses a DDS file from the given arrayBuffer and uploads it into the currently bound texture
 *
 * @param {WebGLRenderingContext} gl WebGL rendering context
 * @param {WebGLCompressedTextureS3TC} ext WEBGL_compressed_texture_s3tc extension object
 * @param {TypedArray} arrayBuffer Array Buffer containing the DDS files data
 * @param {boolean} [loadMipmaps] If false only the top mipmap level will be loaded, otherwise all available mipmaps will be uploaded
 *
 * @returns {number} Number of mipmaps uploaded, 0 if there was an error
 */
function uploadDDSLevels(gl, ext, arrayBuffer, loadMipmaps) {
    var header = new Int32Array(arrayBuffer, 0, headerLengthInt),
        fourCC, blockBytes, internalFormat,
        width, height, dataLength, dataOffset,
        rgb565Data, byteArray, mipmapCount, i;

    if(header[off_magic] != DDS_MAGIC) {
        console.error("Invalid magic number in DDS header");
        return 0;
    }

    if(!header[off_pfFlags] & DDPF_FOURCC) {
        console.error("Unsupported format, must contain a FourCC code");
        return 0;
    }

    fourCC = header[off_pfFourCC];
    switch(fourCC) {
        case FOURCC_DXT1:
            blockBytes = 8;
            internalFormat = ext ? ext.COMPRESSED_RGB_S3TC_DXT1_EXT : null;
            break;

        case FOURCC_DXT3:
            blockBytes = 16;
            internalFormat = ext ? ext.COMPRESSED_RGBA_S3TC_DXT3_EXT : null;
            break;

        case FOURCC_DXT5:
            blockBytes = 16;
            internalFormat = ext ? ext.COMPRESSED_RGBA_S3TC_DXT5_EXT : null;
            break;

        default:
            console.error("Unsupported FourCC code:", int32ToFourCC(fourCC));
            return {mipmaps: 0, width: 0, height: 0 };
    }

    mipmapCount = 1;
    if(header[off_flags] & DDSD_MIPMAPCOUNT && loadMipmaps !== false) {
        mipmapCount = Math.max(1, header[off_mipmapCount]);
    }

    width = header[off_width];
    height = header[off_height];
    dataOffset = header[off_size] + 4;

    var texWidth = width;
    var texHeight = height;

    if(ext) {
        for(i = 0; i < mipmapCount; ++i) {
            dataLength = Math.max( 4, width )/4 * Math.max( 4, height )/4 * blockBytes;
            byteArray = new Uint8Array(arrayBuffer, dataOffset, dataLength);
            gl.compressedTexImage2D(gl.TEXTURE_2D, i, internalFormat, width, height, 0, byteArray);
            dataOffset += dataLength;
            width *= 0.5;
            height *= 0.5;
        }
    } else {
        if(fourCC == FOURCC_DXT1) {
            dataLength = Math.max( 4, width )/4 * Math.max( 4, height )/4 * blockBytes;
            byteArray = new Uint16Array(arrayBuffer);
            rgb565Data = dxtToRgb565(byteArray, dataOffset / 2, width, height);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, width, height, 0, gl.RGB, gl.UNSIGNED_SHORT_5_6_5, rgb565Data);
            if(loadMipmaps) {
                gl.generateMipmap(gl.TEXTURE_2D);
            }
        } else {
            console.error("No manual decoder for", int32ToFourCC(fourCC), "and no native support");
            return {mipmaps: 0, width: 0, height: 0 };
        }
    }

    return {mipmaps: mipmapCount, width: texWidth, height: texHeight };
}

/**
 * Creates a texture from the DDS file at the given URL. Simple shortcut for the most common use case
 *
 * @param {WebGLRenderingContext} gl WebGL rendering context
 * @param {WebGLCompressedTextureS3TC} ext WEBGL_compressed_texture_s3tc extension object
 * @param {string} src URL to DDS file to be loaded
 * @param {function} [callback] callback to be fired when the texture has finished loading
 *
 * @returns {WebGLTexture} New texture that will receive the DDS image data
 */
function loadDDSTextureEx(gl, ext, src, texture, loadMipmaps, callback) {
    var xhr = new XMLHttpRequest();

    xhr.open('GET', src, true);
    xhr.responseType = "arraybuffer";
    xhr.onload = function() {
        if(this.status == 200) {
            gl.bindTexture(gl.TEXTURE_2D, texture);
            var data = uploadDDSLevels(gl, ext, this.response, loadMipmaps);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, data.mipmaps > 1 ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
        }

        if(callback) {
            callback(texture, data.width, data.height);
        }
    };
    xhr.send(null);

    return texture;
}

/**
 * Creates a texture from the DDS file at the given URL. Simple shortcut for the most common use case
 *
 * @param {WebGLRenderingContext} gl WebGL rendering context
 * @param {WebGLCompressedTextureS3TC} ext WEBGL_compressed_texture_s3tc extension object
 * @param {string} src URL to DDS file to be loaded
 * @param {function} [callback] callback to be fired when the texture has finished loading
 *
 * @returns {WebGLTexture} New texture that will receive the DDS image data
 */
function loadDDSTexture(gl, ext, src, callback) {
    var texture = gl.createTexture();
    loadDDSTextureEx(gl, ext, src, texture, true, callback);
    return texture;
}

export class DDSLoader {
  constructor() {
    this.pendingTextures = {};
    this.nextPendingTextureId = 1;

    // Load the worker script.
    const workerPath = import.meta.url.replace('basis-loader.js', 'basis/basis-worker.js');
    this.worker = new Worker(workerPath);
    this.worker.onmessage = (msg) => { this.onWorkerMessage(msg); }
  }

  supportedExtensions() {
    return ['dds'];
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

/*return {
    dxtToRgb565: dxtToRgb565,
    uploadDDSLevels: uploadDDSLevels,
    loadDDSTextureEx: loadDDSTextureEx,
    loadDDSTexture: loadDDSTexture
};*/
