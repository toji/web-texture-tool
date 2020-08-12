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

import {WebGLTextureTool} from '../src/web-texture-tool.js';

import * as Util from './gl-utils.js';

const attributes = {
  position: 0,
  texCoord: 1,
};

const vertexSrc = `
  attribute vec3 position;
  attribute vec2 texCoord;

  varying vec2 v_texCoord;

  uniform mat4 modelView;
  uniform mat4 projection;

  void main() {
    v_texCoord = texCoord;
    gl_Position = projection * modelView * vec4(position, 1.0);
  }
`;

const fragmentSrc = `
  precision mediump float;

  varying vec2 v_texCoord;

  uniform sampler2D baseColor;

  void main() {
    gl_FragColor = texture2D(baseColor, v_texCoord);
  }
`;

export class WebGLRenderer {
  constructor(useWebGL2 = true) {
    this.canvas = document.createElement('canvas');
    this.contextId = useWebGL2 ? 'webgl2' : 'webgl';
  }

  async initialize() {
    const gl = this.canvas.getContext(this.contextId);
    if (!gl) {
      throw new Error(`Requested context type "${this.contextId}" is not supported.`);
    }
    this.gl = gl;

    this.textureTool = new WebGLTextureTool(gl);

    gl.clearColor(0.0, 0.0, 0.0, 1.0);

    this.program = new Util.Program(this.gl, vertexSrc, fragmentSrc, attributes);

    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);

    this.vertBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1.0, 1.0, 0.0,    0.0, 1.0,
      1.0, 1.0, 0.0,    1.0, 1.0,
      1.0, -1.0, 0.0,    1.0, 0.0,
      -1.0, -1.0, 0.0,    0.0, 0.0,
    ]), gl.STATIC_DRAW);

    this.indexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([
      0, 1, 2,
      0, 2, 3
    ]), gl.STATIC_DRAW);

    gl.enableVertexAttribArray(attributes.position);
    gl.enableVertexAttribArray(attributes.texCoord);
    gl.vertexAttribPointer(attributes.position, 3, gl.FLOAT, false, 20, 0);
    gl.vertexAttribPointer(attributes.texCoord, 2, gl.FLOAT, false, 20, 12);

    gl.bindVertexArray(null);
  }

  onCanvasResize(width, height) {
    this.gl.viewport(0, 0, width, height);
  }

  initializeTile(tile) {
    tile.texture = null;
  }

  loadTextureFromUrl(tile, url) {
    return this.textureTool.loadTextureFromUrl(url).then((result) => {
      const gl = this.gl;

      gl.bindTexture(gl.TEXTURE_2D, result.texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, result.mipLevels > 1 ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);

      tile.texture = result.texture;
      return result;
    }).catch((err) => {
      // If an error occurs plug in a solid color texture to fill it's place.
      const result = this.textureTool.createTextureFromColor(0.75, 0.0, 0.0);

      tile.texture = result.texture;
      return result;
    });
  }

  onFrame(projectionMat, tiles) {
    const gl = this.gl;

    gl.clear(gl.COLOR_BUFFER_BIT);

    this.program.use();
    gl.uniformMatrix4fv(this.program.uniform.projection, false, projectionMat);

    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(this.program.uniform.baseColor, 0);

    gl.bindVertexArray(this.vao);

    for (let tile of tiles) {
      if (tile.texture) {
        gl.uniformMatrix4fv(this.program.uniform.modelView, false, tile.modelView);
        gl.bindTexture(gl.TEXTURE_2D, tile.texture);
        gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
      }
    }

    gl.bindVertexArray(null);
  }

  destroy() {
    if (this.textureTool) {
      this.textureTool.destroy();
    }
  }
}