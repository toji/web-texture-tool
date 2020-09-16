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

import {WebGPUTextureTool} from '../src/web-texture-tool.js';

import glslangModule from '../src/third-party/glslang/glslang.js'; // https://unpkg.com/@webgpu/glslang@0.0.7/web/glslang.js

const SAMPLE_COUNT = 4;

const vertexSrc = `#version 450
  const vec2 pos[4] = vec2[4](vec2(-1.0f, -1.0f), vec2(1.0f, -1.0f), vec2(-1.0f, 1.0f), vec2(1.0f, 1.0f));
  const vec2 tex[4] = vec2[4](vec2(0.0f, 1.0f), vec2(1.0f, 1.0f), vec2(0.0f, 0.0f), vec2(1.0f, 0.0f));
  layout(location=0) out vec2 vTex;

  layout(std140, set=1, binding=0) uniform FrameUniforms {
    mat4 projectionMatrix;
  };

  layout(std140, set=0, binding=0) uniform TileUniforms {
    mat4 modelViewMatrix;
  };

  void main() {
    vTex = tex[gl_VertexIndex];
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos[gl_VertexIndex], 0.0, 1.0);
  }
`;

const backgroundVertexSrc = `#version 450
  const vec2 pos[4] = vec2[4](vec2(-1.0f, 1.0f), vec2(1.0f, 1.0f), vec2(-1.0f, -1.0f), vec2(1.0f, -1.0f));
  const vec2 tex[4] = vec2[4](vec2(0.0f, 1.0f), vec2(1.0f, 1.0f), vec2(0.0f, 0.0f), vec2(1.0f, 0.0f));
  layout(location=0) out vec2 vTex;

  void main() {
    vTex = tex[gl_VertexIndex];
    gl_Position = vec4(pos[gl_VertexIndex], 0.0, 1.0);
  }
`;

const fragmentSrc = `#version 450
  layout(set=0, binding=1) uniform sampler imgSampler;
  layout(set=0, binding=2) uniform texture2D img;

  layout(location=0) in vec2 vTex;
  layout(location=0) out vec4 outColor;
  void main() {
    outColor = texture(sampler2D(img, imgSampler), vTex);
  }
`;

export class WebGPURenderer {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.context = this.canvas.getContext('gpupresent');
    this.mipmaps = true;
  }

  async initialize() {
    this.adapter = await navigator.gpu.requestAdapter({
      powerPreference: "high-performance"
    });
    let extensions = [];

    if (this.adapter.extensions.indexOf('texture-compression-bc') != -1) {
      // This is the extension string the spec says SHOULD be used.
      extensions.push('texture-compression-bc');
    } else if (this.adapter.extensions.indexOf('textureCompressionBC') != -1) {
      // TODO: This is the string Chrome is exposing, but it's not the one in the spec.
      extensions.push('textureCompressionBC');
    }

    this.device = await this.adapter.requestDevice({extensions});
    // TODO: This shouldn't be necessary long-term.
    if (!this.device.extensions) {
      this.device.extensions = extensions;
    }
    this.textureTool = new WebGPUTextureTool(this.device);

    // Swap chain setup
    this.swapChainFormat = await this.context.getSwapChainPreferredFormat(this.device);
    this.swapChain = this.context.configureSwapChain({
      device: this.device,
      format: this.swapChainFormat
    });

    this.colorAttachment = {
      // attachment is acquired and set in onCanvasResize.
      attachment: undefined,
      // attachment is acquired and set in onFrame.
      resolveTarget: undefined,
      loadValue: {r: 0.0, g: 0.0, b: 0.0, a: 1.0},
    };

    this.renderPassDescriptor = {
      colorAttachments: [this.colorAttachment],
    };

    this.onCanvasResize(this.canvas.width, this.canvas.height);

    // Shader compiler (won't be needed in the future)
    const glslang = await glslangModule();

    // Tile rendering setup
    this.tilePipeline = this.device.createRenderPipeline({
      vertexStage: {
        module: this.device.createShaderModule({ code: glslang.compileGLSL(vertexSrc, 'vertex') }),
        entryPoint: 'main'
      },
      fragmentStage: {
        module: this.device.createShaderModule({ code: glslang.compileGLSL(fragmentSrc, 'fragment') }),
        entryPoint: 'main'
      },
      primitiveTopology: 'triangle-strip',
      vertexState: {
        indexFormat: 'uint32'
      },
      colorStates: [{
        format: this.swapChainFormat,
        colorBlend: {
          srcFactor: 'src-alpha',
          dstFactor: 'one-minus-src-alpha',
        },
        alphaBlend: {
          srcFactor: 'zero',
          dstFactor: 'one'
        }
      }],
      sampleCount: SAMPLE_COUNT,
    });

    this.tileSampler = this.device.createSampler({ minFilter: 'linear', magFilter: 'linear', mipmapFilter: 'linear' });

    this.frameUniformsBuffer = this.device.createBuffer({
      size: 16 * Float32Array.BYTES_PER_ELEMENT, // Enough for one matrix
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.UNIFORM,
    });

    this.frameUniformBindGroup = this.device.createBindGroup({
      layout: this.tilePipeline.getBindGroupLayout(1),
      entries: [{
        binding: 0,
        resource: {
          buffer: this.frameUniformsBuffer,
        },
      }],
    });

    // Background rendering setup
    this.backgroundPipeline = this.device.createRenderPipeline({
      vertexStage: {
        module: this.device.createShaderModule({ code: glslang.compileGLSL(backgroundVertexSrc, 'vertex') }),
        entryPoint: 'main'
      },
      fragmentStage: {
        module: this.device.createShaderModule({ code: glslang.compileGLSL(fragmentSrc, 'fragment') }),
        entryPoint: 'main'
      },
      primitiveTopology: 'triangle-strip',
      vertexState: {
        indexFormat: 'uint32'
      },
      colorStates: [{
        format: this.swapChainFormat,
      }],
      sampleCount: SAMPLE_COUNT,
    });

    const checkerboard = await this.textureTool.loadTextureFromUrl('textures/checkerboard.png');

    this.backgroundBindGroup = this.device.createBindGroup({
      layout: this.backgroundPipeline.getBindGroupLayout(0),
      entries: [{
        binding: 1,
        resource: this.tileSampler,
      }, {
        binding: 2,
        resource: checkerboard.texture.createView(),
      }],
    });
  }

  onCanvasResize(width, height) {
    if (!this.device) return;

    const msaaColorTexture = this.device.createTexture({
      size: { width, height, depth: 1 },
      sampleCount: SAMPLE_COUNT,
      format: this.swapChainFormat,
      usage: GPUTextureUsage.OUTPUT_ATTACHMENT,
    });
    this.colorAttachment.attachment = msaaColorTexture.createView();
  }

  initializeTile(tile) {
    tile.texture = null;
    tile.bindGroup = null;

    tile.uniformBuffer = this.device.createBuffer({
      size: 16 * Float32Array.BYTES_PER_ELEMENT, // Enough for one matrix
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.UNIFORM,
    });
  }

  loadTextureFromUrl(tile, url) {
    return this.textureTool.loadTextureFromUrl(url, {mipmaps: this.mipmaps}).then((result) => {
      const bindGroup = this.device.createBindGroup({
        layout: this.tilePipeline.getBindGroupLayout(0),
        entries: [{
          binding: 0,
          resource: {
            buffer: tile.uniformBuffer,
          },
        },{
          binding: 1,
          resource: this.tileSampler,
        }, {
          binding: 2,
          resource: result.texture.createView({dimension: '2d', arrayLayerCount: 1}),
        }],
      });

      tile.bindGroup = bindGroup;
      tile.texture = result.texture;

      return result;
    }).catch((err) => {
      console.warn('Texture failed to load from URL: ', err);

      // If an error occurs plug in a solid color texture to fill it's place.
      const result = this.textureTool.createTextureFromColor(0.75, 0.0, 0.0);

      const bindGroup = this.device.createBindGroup({
        layout: this.tilePipeline.getBindGroupLayout(0),
        entries: [{
          binding: 0,
          resource: {
            buffer: tile.uniformBuffer,
          },
        },{
          binding: 1,
          resource: this.tileSampler,
        }, {
          binding: 2,
          resource: result.texture.createView(),
        }],
      });

      tile.bindGroup = bindGroup;
      tile.texture = result.texture;

      return result;
    });
  }

  loadTextureFromFile(tile, file) {
    return this.textureTool.loadTextureFromBlob(file, {filename: file.name, mipmaps: this.mipmaps}).then((result) => {
      const bindGroup = this.device.createBindGroup({
        layout: this.tilePipeline.getBindGroupLayout(0),
        entries: [{
          binding: 0,
          resource: {
            buffer: tile.uniformBuffer,
          },
        },{
          binding: 1,
          resource: this.tileSampler,
        }, {
          binding: 2,
          resource: result.texture.createView({dimension: '2d', arrayLayerCount: 1}),
        }],
      });

      tile.bindGroup = bindGroup;
      tile.texture = result.texture;

      return result;
    }).catch((err) => {
      console.warn('Texture failed to load from File: ', err);

      // If an error occurs plug in a solid color texture to fill it's place.
      const result = this.textureTool.createTextureFromColor(0.75, 0.0, 0.0);

      const bindGroup = this.device.createBindGroup({
        layout: this.tilePipeline.getBindGroupLayout(0),
        entries: [{
          binding: 0,
          resource: {
            buffer: tile.uniformBuffer,
          },
        },{
          binding: 1,
          resource: this.tileSampler,
        }, {
          binding: 2,
          resource: result.texture.createView(),
        }],
      });

      tile.bindGroup = bindGroup;
      tile.texture = result.texture;

      return result;
    });
  }

  onFrame(projectionMat, tiles) {
    // Update the FrameUniforms buffer with the values that are used by every
    // program and don't change for the duration of the frame.
    this.device.defaultQueue.writeBuffer(this.frameUniformsBuffer, 0, projectionMat);

    this.colorAttachment.resolveTarget = this.swapChain.getCurrentTexture().createView();

    const commandEncoder = this.device.createCommandEncoder({});

    const passEncoder = commandEncoder.beginRenderPass(this.renderPassDescriptor);

    // Draw a checkered background (mostly so we can see alpha effects).
    passEncoder.setPipeline(this.backgroundPipeline);
    passEncoder.setBindGroup(0, this.backgroundBindGroup);
    passEncoder.draw(4, 1, 0, 0);

    // Draw each tile.
    passEncoder.setPipeline(this.tilePipeline);
    passEncoder.setBindGroup(1, this.frameUniformBindGroup);
    for (let tile of tiles) {
      if (tile.texture) {
        this.device.defaultQueue.writeBuffer(tile.uniformBuffer, 0, tile.modelView);
        passEncoder.setBindGroup(0, tile.bindGroup);
        passEncoder.draw(4, 1, 0, 0);
      }
    }

    passEncoder.endPass();
    this.device.defaultQueue.submit([commandEncoder.finish()]);
  }

  destroy() {
    if (this.textureTool) {
      this.textureTool.destroy();
    }
  }
}
